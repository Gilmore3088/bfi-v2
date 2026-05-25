"""Hamilton agent orchestrator.

Pulls data via ``data.py``, renders a deterministic Jinja2 skeleton,
asks Claude to fill the analytical sections, runs the editorial QA
gate, and persists the result to the ``reports`` table.

Contract (see TECHNICAL_ARCHITECT.md, section 3):
- Input: a report request (kind, target slug, optional peers)
- Output: ``reports`` row with status, markdown body, cost_cents,
  agent_events row
- User-triggered (no cron schedule)
- Idempotency: caller controls report_id; duplicate succeeded reports
  are not regenerated unless ``force=True``

Stub mode kicks in when ``ANTHROPIC_API_KEY`` is missing or when
psycopg2/DATABASE_URL is unavailable. In stub mode the agent renders
the template with placeholder LLM responses and logs "STUB: would call
Claude".
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from jinja2 import Environment, FileSystemLoader, StrictUndefined

from .data import (
    build_category_context,
    build_institution_context,
    build_peer_context,
    get_db_url,
)
from .prompts import (
    VoiceViolation,
    check_voice,
    render_user_prompt,
    system_prompt_for,
)

logger = logging.getLogger(__name__)


# Anthropic model and cost. Sonnet 4.5 list price as of 2026-05-25:
# $3 / 1M input, $15 / 1M output. Hamilton produces long outputs, so
# output dominates cost. We track to the cent and write to reports.cost_cents.
DEFAULT_MODEL = "claude-sonnet-4-5-20250929"
INPUT_PRICE_PER_MTOK = 3.00  # dollars per million input tokens
OUTPUT_PRICE_PER_MTOK = 15.00  # dollars per million output tokens
MAX_OUTPUT_TOKENS = 4096

TEMPLATE_DIR = Path(__file__).parent / "templates"


# -----------------------------------------------------------------------------
# Request / result shapes
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class ReportRequest:
    """A single Hamilton job."""

    kind: str  # "institution" | "category" | "peer"
    target: str  # slug of subject institution or canonical category
    peers: tuple[str, ...] = ()
    requested_by: str | None = None
    force: bool = False

    def __post_init__(self) -> None:
        if self.kind not in ("institution", "category", "peer"):
            raise ValueError(f"invalid kind: {self.kind!r}")
        if self.kind == "peer" and not self.peers:
            raise ValueError("peer reports require at least one peer slug")


@dataclass
class ReportResult:
    """Outcome of a generation run."""

    report_id: uuid.UUID
    kind: str
    target: str
    status: str  # "succeeded" | "failed" | "blocked"
    body: str
    cost_cents: int
    mode: str  # "live" | "stub_llm" | "stub_db" | "stub_full"
    violations: list[VoiceViolation] = field(default_factory=list)
    error: str | None = None

    def to_summary(self) -> dict[str, Any]:
        return {
            "report_id": str(self.report_id),
            "kind": self.kind,
            "target": self.target,
            "status": self.status,
            "cost_cents": self.cost_cents,
            "mode": self.mode,
            "violations": [str(v) for v in self.violations],
            "error": self.error,
        }


# -----------------------------------------------------------------------------
# Template rendering
# -----------------------------------------------------------------------------


def _env() -> Environment:
    return Environment(
        loader=FileSystemLoader(str(TEMPLATE_DIR)),
        autoescape=False,
        keep_trailing_newline=True,
        undefined=StrictUndefined,
    )


_TEMPLATE_NAMES = {
    "institution": "institution_profile.md.j2",
    "category": "category_deepdive.md.j2",
    "peer": "peer_benchmark.md.j2",
}


def _render(kind: str, context: dict[str, Any], llm_sections: dict[str, str]) -> str:
    template = _env().get_template(_TEMPLATE_NAMES[kind])
    return template.render(**context, **llm_sections)


# -----------------------------------------------------------------------------
# LLM call (live + stub)
# -----------------------------------------------------------------------------


def _stub_llm_sections(kind: str, context: dict[str, Any]) -> dict[str, str]:
    """Placeholder LLM responses that keep the report valid in stub mode."""
    logger.info("STUB: would call Claude for %s report", kind)
    if kind == "institution":
        name = context["institution"]["name"]
        return {
            "llm_headline": (
                f"Bank Fee Index analysis ranks {name} against its peer set on "
                "the categories where pricing decisions matter most."
            ),
            "llm_positioning": (
                "Stub mode is active: this section would contain the model's "
                "synthesis of the peer-comparison table below."
            ),
            "llm_so_what": (
                "Stub mode is active: this callout would isolate the single "
                "implication a pricing committee should take from the table."
            ),
        }
    if kind == "category":
        return {
            "llm_headline": (
                "Bank Fee Index analysis isolates where the category clusters "
                "and which institutions sit outside the cluster."
            ),
            "llm_outliers": (
                "Stub mode is active: this section would name the extreme "
                "institutions and explain why their pricing diverges."
            ),
            "llm_implication": (
                "Stub mode is active: this section would close with the "
                "category-level implication for a bank pricing today."
            ),
        }
    if kind == "peer":
        return {
            "llm_headline": (
                "Bank Fee Index analysis reads the peer set as follows."
            ),
            "llm_deltas": (
                "Stub mode is active: this section would surface the two or "
                "three deltas that change the verdict."
            ),
            "llm_so_what": (
                "Stub mode is active: this callout would distill the verdict "
                "into one falsifiable claim."
            ),
        }
    return {}


def _call_anthropic(
    kind: str,
    context: dict[str, Any],
    *,
    model: str = DEFAULT_MODEL,
) -> tuple[dict[str, str], int, int]:
    """Live Anthropic call. Returns (sections_dict, input_tokens, output_tokens).

    The model is instructed to return a JSON object whose keys match the
    Jinja2 placeholders for the requested kind, so the agent can drop it
    straight into the template.
    """
    import anthropic  # local import keeps stub mode dependency-free

    expected_keys = {
        "institution": ["llm_headline", "llm_positioning", "llm_so_what"],
        "category": ["llm_headline", "llm_outliers", "llm_implication"],
        "peer": ["llm_headline", "llm_deltas", "llm_so_what"],
    }[kind]

    system = system_prompt_for(kind)
    user = render_user_prompt(kind, context) + (
        "\n\nReturn your answer as a JSON object with exactly these keys "
        f"and no others: {expected_keys}. Each value is the markdown body "
        "for that section. Do not wrap the JSON in code fences."
    )

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=model,
        max_tokens=MAX_OUTPUT_TOKENS,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = "".join(
        block.text for block in msg.content if getattr(block, "type", None) == "text"
    )
    try:
        sections = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"hamilton: model did not return JSON: {exc}") from exc
    for key in expected_keys:
        if key not in sections:
            raise RuntimeError(f"hamilton: model output missing key {key!r}")
    usage = msg.usage
    return sections, int(usage.input_tokens), int(usage.output_tokens)


def _estimate_cost_cents(input_tokens: int, output_tokens: int) -> int:
    dollars = (
        input_tokens / 1_000_000 * INPUT_PRICE_PER_MTOK
        + output_tokens / 1_000_000 * OUTPUT_PRICE_PER_MTOK
    )
    return max(0, round(dollars * 100))


# -----------------------------------------------------------------------------
# DB persistence
# -----------------------------------------------------------------------------


def _load_psycopg():
    try:
        import psycopg2  # type: ignore
        return psycopg2
    except ImportError:
        logger.warning("hamilton: psycopg2 not installed; DB writes will be stubbed")
        return None


def _persist(
    *,
    result: ReportResult,
    request: ReportRequest,
    context: dict[str, Any],
) -> None:
    """Write a row into reports + an agent_events row. No-op in stub_db mode."""
    db_url = get_db_url()
    psycopg2 = _load_psycopg()
    if not (db_url and psycopg2):
        logger.info(
            "STUB: would insert reports row %s (status=%s, cost_cents=%s)",
            result.report_id,
            result.status,
            result.cost_cents,
        )
        return

    subject_institution_slug = (
        request.target if request.kind in ("institution", "peer") else None
    )
    subject_category = request.target if request.kind == "category" else None

    params_json = json.dumps(
        {
            "kind": request.kind,
            "target": request.target,
            "peers": list(request.peers),
        }
    )

    with psycopg2.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO reports (
                id, kind, subject_institution_slug, subject_category,
                status, requested_by, params, output_markdown,
                cost_cents, created_at, completed_at
            )
            VALUES (
                %s, %s, %s, %s,
                %s, %s, %s::jsonb, %s,
                %s, now(), now()
            )
            ON CONFLICT (id) DO UPDATE SET
                status = EXCLUDED.status,
                output_markdown = EXCLUDED.output_markdown,
                cost_cents = EXCLUDED.cost_cents,
                completed_at = now()
            """,
            (
                str(result.report_id),
                request.kind,
                subject_institution_slug,
                subject_category,
                result.status,
                request.requested_by,
                params_json,
                result.body,
                result.cost_cents,
            ),
        )
        cur.execute(
            """
            INSERT INTO agent_events (agent, run_id, status, payload, error)
            VALUES ('hamilton', %s, %s, %s::jsonb, %s)
            """,
            (
                str(result.report_id),
                result.status,
                json.dumps(result.to_summary()),
                result.error,
            ),
        )
        conn.commit()


# -----------------------------------------------------------------------------
# Public agent class
# -----------------------------------------------------------------------------


class HamiltonAgent:
    """Top-level orchestrator. Stateless; safe to construct per request."""

    def __init__(self, *, model: str = DEFAULT_MODEL) -> None:
        self.model = model

    # ----- context assembly -------------------------------------------------

    def _assemble_context(self, request: ReportRequest) -> dict[str, Any]:
        if request.kind == "institution":
            return build_institution_context(request.target)
        if request.kind == "category":
            return build_category_context(request.target)
        if request.kind == "peer":
            return build_peer_context(request.target, request.peers)
        raise ValueError(f"unknown kind: {request.kind!r}")

    # ----- main entry point -------------------------------------------------

    def generate(self, request: ReportRequest, *, dry_run: bool = False) -> ReportResult:
        report_id = uuid.uuid4()
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
        db_url = get_db_url()

        if anthropic_key and db_url and not dry_run:
            mode = "live"
        elif anthropic_key and not db_url:
            mode = "stub_db"
        elif not anthropic_key and db_url and not dry_run:
            mode = "stub_llm"
        else:
            mode = "stub_full"

        logger.info(
            "hamilton: starting report %s kind=%s target=%s mode=%s",
            report_id,
            request.kind,
            request.target,
            mode,
        )

        try:
            context = self._assemble_context(request)
        except Exception as exc:  # noqa: BLE001
            logger.exception("hamilton: context assembly failed")
            return ReportResult(
                report_id=report_id,
                kind=request.kind,
                target=request.target,
                status="failed",
                body="",
                cost_cents=0,
                mode=mode,
                error=str(exc),
            )

        # LLM section generation.
        cost_cents = 0
        if mode in ("live",):
            try:
                sections, in_tok, out_tok = _call_anthropic(
                    request.kind, context, model=self.model
                )
                cost_cents = _estimate_cost_cents(in_tok, out_tok)
            except Exception as exc:  # noqa: BLE001
                logger.exception("hamilton: anthropic call failed; falling back to stub")
                sections = _stub_llm_sections(request.kind, context)
                mode = "stub_llm"
                # Record cost as 0 since the call failed.
        else:
            sections = _stub_llm_sections(request.kind, context)

        try:
            body = _render(request.kind, context, sections)
        except Exception as exc:  # noqa: BLE001
            logger.exception("hamilton: template render failed")
            return ReportResult(
                report_id=report_id,
                kind=request.kind,
                target=request.target,
                status="failed",
                body="",
                cost_cents=cost_cents,
                mode=mode,
                error=str(exc),
            )

        # Editorial QA gate. Violations block the report from succeeding,
        # but the draft is still persisted so a human can inspect it.
        violations = check_voice(body)
        status = "blocked" if violations else "succeeded"
        if violations:
            logger.warning(
                "hamilton: %d editorial violation(s) blocked report %s",
                len(violations),
                report_id,
            )

        result = ReportResult(
            report_id=report_id,
            kind=request.kind,
            target=request.target,
            status=status,
            body=body,
            cost_cents=cost_cents,
            mode=mode,
            violations=violations,
        )

        if not dry_run:
            try:
                _persist(result=result, request=request, context=context)
            except Exception as exc:  # noqa: BLE001
                logger.exception("hamilton: persistence failed (non-fatal)")
                result.error = f"persistence_failed: {exc}"

        return result


# -----------------------------------------------------------------------------
# Module-level convenience entry point used by __main__.
# -----------------------------------------------------------------------------


def run(
    *,
    kind: str,
    target: str,
    peers: Sequence[str] = (),
    requested_by: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    agent = HamiltonAgent()
    req = ReportRequest(
        kind=kind,
        target=target,
        peers=tuple(peers),
        requested_by=requested_by,
    )
    result = agent.generate(req, dry_run=dry_run)
    return result.to_summary()
