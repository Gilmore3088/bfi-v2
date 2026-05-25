"""Magellan discovery agent.

Probes candidate URLs for each institution that lacks an active
fee-schedule URL, records findings to Postgres, and upserts the
highest-confidence hit into `institution_urls`.

Contract (see TECHNICAL_ARCHITECT.md, section 3):
- Input: institutions with no active row in institution_urls
- Output: institution_urls rows + agent_events rows
- Idempotent: UNIQUE(institution_id, url) ON CONFLICT DO NOTHING
- Failure isolated per-institution; emits agent_events with status='failed'
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass, field
from typing import Sequence

import httpx

from .candidates import Candidate, generate_candidates
from .knowledge import (
    load_state_patterns,
    record_pattern_outcome,
    reorder_candidates_by_knowledge,
)


logger = logging.getLogger(__name__)


HTTP_TIMEOUT_S = 10.0
PROBE_CONCURRENCY = 8
USER_AGENT = "BankFeeIndex-Magellan/0.1 (+https://bankfeeindex.com/agents)"

# Status codes treated as "URL exists and may serve the page".
SUCCESS_STATUSES = {200, 203}
# Status codes that indicate definitive non-existence (cache as not_found).
DEFINITE_MISS_STATUSES = {404, 410}

# When confidence is at or above this threshold, also upsert into institution_urls.
URL_UPSERT_THRESHOLD = 0.70


# Seed institutions from SPEC.md M1 scope.
SEED_INSTITUTIONS: tuple[dict, ...] = (
    {"name": "JPMorgan Chase", "state": "OH", "charter": "bank", "website_url": "https://www.chase.com"},
    {"name": "Bank of America", "state": "NC", "charter": "bank", "website_url": "https://www.bankofamerica.com"},
    {"name": "BMO Bank", "state": "IL", "charter": "bank", "website_url": "https://www.bmo.com"},
    {"name": "Charles Schwab Bank", "state": "TX", "charter": "bank", "website_url": "https://www.schwab.com"},
    {"name": "BOKF", "state": "OK", "charter": "bank", "website_url": "https://www.bokfinancial.com"},
    {"name": "First National Bank of Pennsylvania", "state": "PA", "charter": "bank", "website_url": "https://www.fnb-online.com"},
    {"name": "Amarillo National Bank", "state": "TX", "charter": "bank", "website_url": "https://www.anb.com"},
    {"name": "Centier Bank", "state": "IN", "charter": "bank", "website_url": "https://www.centier.com"},
    {"name": "Sturgis Bank & Trust", "state": "MI", "charter": "bank", "website_url": "https://www.sturgisbank.com"},
    {"name": "Clear Mountain Bank", "state": "WV", "charter": "bank", "website_url": "https://www.clearmountainbank.com"},
    {"name": "Bank of York", "state": "SC", "charter": "bank", "website_url": "https://www.bankofyork.com"},
    {"name": "The Peshtigo National Bank", "state": "WI", "charter": "bank", "website_url": "https://www.peshtigonationalbank.com"},
    {"name": "Navy Federal Credit Union", "state": "VA", "charter": "credit_union", "website_url": "https://www.navyfederal.org"},
    {"name": "State Employees' FCU", "state": "NC", "charter": "credit_union", "website_url": "https://www.ncsecu.org"},
    {"name": "Pentagon Federal Credit Union", "state": "VA", "charter": "credit_union", "website_url": "https://www.penfed.org"},
    {"name": "SchoolsFirst FCU", "state": "CA", "charter": "credit_union", "website_url": "https://www.schoolsfirstfcu.org"},
    {"name": "Teachers FCU", "state": "NY", "charter": "credit_union", "website_url": "https://www.teachersfcu.org"},
    {"name": "ESL FCU", "state": "NY", "charter": "credit_union", "website_url": "https://www.esl.org"},
    {"name": "Brightstar FCU", "state": "FL", "charter": "credit_union", "website_url": "https://www.brightstarcu.org"},
    {"name": "Brazos Valley Schools FCU", "state": "TX", "charter": "credit_union", "website_url": "https://www.bvscu.org"},
    {"name": "OC FCU", "state": "OH", "charter": "credit_union", "website_url": "https://www.ocfcu.org"},
    {"name": "Bowater Employees FCU", "state": "TN", "charter": "credit_union", "website_url": "https://www.bowateremployeescu.org"},
)


@dataclass
class ProbeResult:
    """Outcome of probing a single candidate URL."""

    candidate: Candidate
    status: int | None
    content_type: str | None
    content_length: int | None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status in SUCCESS_STATUSES


@dataclass
class InstitutionFinding:
    """Aggregate result for one institution."""

    institution_id: int | None
    institution_name: str
    best: ProbeResult | None
    probes: list[ProbeResult] = field(default_factory=list)

    @property
    def found(self) -> bool:
        return self.best is not None and self.best.ok


async def probe_candidate(
    client: httpx.AsyncClient, candidate: Candidate
) -> ProbeResult:
    """Probe a single candidate URL with HEAD then fall back to GET."""
    try:
        resp = await client.head(candidate.url, follow_redirects=True)
        # Some sites reject HEAD; try GET when status is 405 or 403.
        if resp.status_code in (403, 405):
            resp = await client.get(candidate.url, follow_redirects=True)
        length_header = resp.headers.get("content-length")
        return ProbeResult(
            candidate=candidate,
            status=resp.status_code,
            content_type=resp.headers.get("content-type"),
            content_length=int(length_header) if length_header and length_header.isdigit() else None,
        )
    except (httpx.HTTPError, ValueError) as exc:
        return ProbeResult(
            candidate=candidate,
            status=None,
            content_type=None,
            content_length=None,
            error=str(exc)[:200],
        )


async def probe_all(
    candidates: Sequence[Candidate],
    concurrency: int = PROBE_CONCURRENCY,
) -> list[ProbeResult]:
    """Probe a batch of candidates with bounded concurrency."""
    semaphore = asyncio.Semaphore(concurrency)
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/pdf,*/*"}

    async with httpx.AsyncClient(
        timeout=HTTP_TIMEOUT_S,
        headers=headers,
        follow_redirects=True,
    ) as client:
        async def _bounded(c: Candidate) -> ProbeResult:
            async with semaphore:
                return await probe_candidate(client, c)

        return await asyncio.gather(*(_bounded(c) for c in candidates))


def select_best(probes: Sequence[ProbeResult]) -> ProbeResult | None:
    """Choose the best probe: highest-confidence URL that responded OK."""
    ok = [p for p in probes if p.ok]
    if not ok:
        return None
    return max(ok, key=lambda p: p.candidate.confidence)


async def discover_for_institution(
    institution_name: str,
    website_url: str,
    institution_id: int | None = None,
    state_patterns: dict[str, float] | None = None,
) -> InstitutionFinding:
    """Run the full discovery loop for a single institution (no DB writes).

    When state_patterns is provided, candidates are reordered so URLs whose
    pattern has historically succeeded in this state are probed first.
    """
    candidates = generate_candidates(website_url)
    if state_patterns:
        candidates = reorder_candidates_by_knowledge(candidates, state_patterns)
    if not candidates:
        logger.warning("magellan: no candidates for %s (website=%r)", institution_name, website_url)
        return InstitutionFinding(
            institution_id=institution_id,
            institution_name=institution_name,
            best=None,
        )

    logger.info(
        "magellan: probing %d candidates for %s", len(candidates), institution_name
    )
    probes = await probe_all(candidates)
    best = select_best(probes)
    if best:
        logger.info(
            "magellan: found %s for %s (confidence=%.2f, status=%s)",
            best.candidate.url,
            institution_name,
            best.candidate.confidence,
            best.status,
        )
    else:
        logger.info("magellan: no fee URL found for %s", institution_name)
    return InstitutionFinding(
        institution_id=institution_id,
        institution_name=institution_name,
        best=best,
        probes=list(probes),
    )


# --- DB layer ---------------------------------------------------------------


def _get_db_url() -> str | None:
    return os.environ.get("DATABASE_URL")


def _load_psycopg():
    """Lazy-import psycopg2; returns None if unavailable (stub mode)."""
    try:
        import psycopg2  # type: ignore
        import psycopg2.extras  # type: ignore
        return psycopg2
    except ImportError:
        logger.warning("magellan: psycopg2 not installed; DB writes will be stubbed")
        return None


def _ensure_seed_institutions(conn) -> list[dict]:
    """Insert seed institutions if missing; return rows with ids."""
    rows: list[dict] = []
    with conn.cursor() as cur:
        for inst in SEED_INSTITUTIONS:
            cur.execute(
                """
                INSERT INTO institutions (name, state_code, charter_type, website_url)
                VALUES (%(name)s, %(state)s, %(charter)s, %(website_url)s)
                ON CONFLICT (name) DO UPDATE
                  SET website_url = COALESCE(institutions.website_url, EXCLUDED.website_url)
                RETURNING id, name, website_url
                """,
                inst,
            )
            row = cur.fetchone()
            rows.append({"id": row[0], "name": row[1], "website_url": row[2]})
    conn.commit()
    return rows


def _load_targets(
    conn,
    *,
    seed: bool,
    limit: int | None,
    state_code: str | None = None,
) -> list[dict]:
    """Load institutions to probe.

    Seed mode: returns the 22 SPEC institutions (inserts if missing).
    Default: institutions with no active institution_urls row, optionally
    filtered by state_code.
    """
    if seed:
        rows = _ensure_seed_institutions(conn)
        # Attach state via lookup so downstream knowledge calls have it.
        if rows:
            ids = tuple(r["id"] for r in rows)
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, state_code FROM institutions WHERE id = ANY(%s)",
                    (list(ids),),
                )
                state_by_id = {row[0]: row[1] for row in cur.fetchall()}
            for r in rows:
                r["state_code"] = state_by_id.get(r["id"])
        return rows

    params: list = []
    where = [
        "i.website_url IS NOT NULL",
        "i.website_url <> ''",
        "NOT EXISTS (SELECT 1 FROM institution_urls iu "
        "WHERE iu.institution_id = i.id AND iu.is_active)",
    ]
    if state_code:
        where.append("i.state_code = %s")
        params.append(state_code)
    sql = (
        "SELECT i.id, i.name, i.website_url, i.state_code "
        "FROM institutions i WHERE " + " AND ".join(where) +
        " ORDER BY i.asset_size DESC NULLS LAST"
    )
    if limit:
        sql += f" LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _record_finding(conn, run_id: uuid.UUID, finding: InstitutionFinding) -> None:
    """Persist a finding: upsert URL if confident, always emit agent_event."""
    if finding.institution_id is None:
        logger.info("magellan: skipping DB write (no institution_id)")
        return

    with conn.cursor() as cur:
        if finding.found and finding.best is not None:
            best = finding.best
            cand = best.candidate
            if cand.confidence >= URL_UPSERT_THRESHOLD:
                cur.execute(
                    """
                    INSERT INTO institution_urls
                        (institution_id, url, discovery_method, confidence, verified_at, is_active)
                    VALUES (%s, %s, %s, %s, now(), TRUE)
                    ON CONFLICT (institution_id, url) DO UPDATE
                      SET verified_at = now(),
                          is_active = TRUE,
                          confidence = GREATEST(institution_urls.confidence, EXCLUDED.confidence)
                    """,
                    (
                        finding.institution_id,
                        cand.url,
                        f"pattern:{cand.pattern}",
                        cand.confidence,
                    ),
                )

        status = "succeeded" if finding.found else "skipped"
        payload = {
            "institution_name": finding.institution_name,
            "candidates_probed": len(finding.probes),
            "found_url": finding.best.candidate.url if finding.found else None,
            "confidence": finding.best.candidate.confidence if finding.found else None,
        }
        cur.execute(
            """
            INSERT INTO agent_events (agent, run_id, status, payload)
            VALUES ('magellan', %s, %s, %s::jsonb)
            """,
            (str(run_id), status, _json_dumps(payload)),
        )
    conn.commit()


def _record_knowledge(
    conn,
    state_code: str | None,
    finding: InstitutionFinding,
) -> None:
    """Write per-state hit/miss outcomes for every probed pattern."""
    best_pattern = finding.best.candidate.pattern if finding.found and finding.best else None
    for probe in finding.probes:
        record_pattern_outcome(
            conn,
            state_code=state_code,
            pattern=probe.candidate.pattern,
            hit=(probe.candidate.pattern == best_pattern),
        )
    conn.commit()


def _json_dumps(payload: dict) -> str:
    import json
    return json.dumps(payload, default=str)


async def run(
    *,
    seed: bool = False,
    limit: int | None = None,
    dry_run: bool = False,
    state: str | None = None,
) -> dict:
    """Top-level entrypoint. Returns a summary dict.

    In stub mode (no DATABASE_URL or no psycopg2), reads from SEED_INSTITUTIONS,
    runs discovery, and logs "STUB: would write X" instead of DB writes.
    """
    run_id = uuid.uuid4()
    db_url = _get_db_url()
    psycopg2 = _load_psycopg()
    use_db = bool(db_url and psycopg2 and not dry_run)

    if not use_db:
        if not db_url:
            logger.info("magellan: STUB mode (DATABASE_URL not set)")
        elif not psycopg2:
            logger.info("magellan: STUB mode (psycopg2 not installed)")
        elif dry_run:
            logger.info("magellan: dry-run mode (no DB writes)")
        if seed:
            targets = [
                {"id": None, "name": i["name"], "website_url": i["website_url"]}
                for i in SEED_INSTITUTIONS
            ]
        else:
            logger.warning(
                "magellan: STUB mode requires --seed (no DB to query). Exiting."
            )
            return {"run_id": str(run_id), "processed": 0, "found": 0, "mode": "stub"}
    else:
        conn = psycopg2.connect(db_url)
        # Create agent_runs row so FK from agent_events resolves
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_runs (run_id, agent, status, "
                "trigger_source, target_state) "
                "VALUES (%s, 'magellan', 'in_progress', 'manual', %s)",
                (str(run_id), state),
            )
        conn.commit()
        targets = _load_targets(conn, seed=seed, limit=limit, state_code=state)
        logger.info(
            "magellan: loaded %d targets from DB (state=%s)",
            len(targets),
            state or "ALL",
        )

    if limit and not seed:
        targets = targets[:limit]

    # Cache loaded state-pattern knowledge so we hit DB once per state.
    state_pattern_cache: dict[str, dict[str, float]] = {}

    found = 0
    processed = 0
    for target in targets:
        try:
            target_state = target.get("state_code") or state
            state_patterns: dict[str, float] | None = None
            if use_db and target_state:
                if target_state not in state_pattern_cache:
                    state_pattern_cache[target_state] = load_state_patterns(
                        conn, target_state
                    )
                state_patterns = state_pattern_cache[target_state]

            finding = await discover_for_institution(
                institution_name=target["name"],
                website_url=target.get("website_url") or "",
                institution_id=target.get("id"),
                state_patterns=state_patterns,
            )
            if use_db:
                _record_finding(conn, run_id, finding)
                _record_knowledge(conn, target_state, finding)
            else:
                if finding.found:
                    logger.info(
                        "STUB: would upsert institution_urls(%s, %s, confidence=%.2f)",
                        finding.institution_name,
                        finding.best.candidate.url,  # type: ignore[union-attr]
                        finding.best.candidate.confidence,  # type: ignore[union-attr]
                    )
                else:
                    logger.info(
                        "STUB: would record skipped agent_event for %s",
                        finding.institution_name,
                    )
            processed += 1
            if finding.found:
                found += 1
        except Exception as exc:  # noqa: BLE001 -- isolate per-institution failures
            logger.exception("magellan: failure for %s: %s", target.get("name"), exc)
            if use_db:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO agent_events (agent, run_id, status, error, payload)
                        VALUES ('magellan', %s, 'failed', %s, %s::jsonb)
                        """,
                        (
                            str(run_id),
                            str(exc)[:500],
                            _json_dumps({"institution_name": target.get("name")}),
                        ),
                    )
                conn.commit()

    if use_db:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_runs SET status='succeeded', ended_at=now(), "
                "items_processed=%s WHERE run_id=%s",
                (processed, str(run_id)),
            )
        conn.commit()
        conn.close()

    summary = {
        "run_id": str(run_id),
        "processed": processed,
        "found": found,
        "mode": "db" if use_db else "stub",
    }
    logger.info("magellan: run complete %s", summary)
    return summary
