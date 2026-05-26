"""Darwin drain agent.

Reads `fees_raw` rows that have no matching `fees_verified` row, classifies
each via the Claude haiku classifier (or stub), and writes `fees_verified`
rows back. Maintains price-change history via `superseded_by`.

Contract (see TECHNICAL_ARCHITECT.md, section 3):
- Input: fees_raw rows with no corresponding fees_verified row
- Output: fees_verified rows; auto_approved when confidence >= 0.90
- Idempotent: UNIQUE(institution_id, canonical_fee_key) WHERE superseded_by IS NULL
- Price changes: a new amount on the same key sets the prior row's superseded_by
- Failure isolated per-row; emits agent_events for per-row + run-level outcomes
"""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass
from typing import Any

import re

from .bounds import check_amount
from .classifier import (
    AUTO_PROMOTE_CONFIDENCE,
    Classification,
    ExtractionResult,
    classify,
    extract_fees,
)
from .taxonomy import family_for, is_canonical


_UNMAPPED_CATEGORY = "_unmapped"
_UNMAPPED_FAMILY = "Unmapped"
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(s: str | None) -> str:
    """Lower-snake-case slug for unmapped canonical_fee_key disambiguation."""
    if not s:
        return "unknown"
    out = _SLUG_RE.sub("_", s.lower()).strip("_")
    return out[:60] or "unknown"


def _normalize_for_match(s: str) -> str:
    """Collapse whitespace and lowercase for substring evidence verification."""
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def _verify_evidence(evidence: str | None, raw_text: str) -> bool:
    """True when evidence_quote appears (whitespace-insensitive) in raw_text.

    Returns False when either side is missing. The agent forces review_status
    to 'pending' on a False result even if Claude's confidence is high.
    """
    if not evidence or not raw_text:
        return False
    needle = _normalize_for_match(evidence)
    haystack = _normalize_for_match(raw_text)
    if not needle:
        return False
    return needle in haystack


logger = logging.getLogger(__name__)


# Default per-run batch size when --limit is not provided. Avoids
# accidentally classifying 100K rows in one Modal invocation.
DEFAULT_LIMIT = 100


@dataclass
class RowOutcome:
    """Per-row drain outcome for the run summary.

    Multi-fee aware: `fees_extracted` is the number of fees produced from this
    one fees_raw row, broken down by review_status into `auto_approved` and
    `pending` counts. `status` is the rollup at the row level.
    """

    fees_raw_id: int
    institution_id: int
    classification: Classification | None
    fees_verified_id: int | None
    superseded_id: int | None
    status: str  # 'auto_approved' | 'pending' | 'flagged_taxonomy' | 'empty' | 'error'
    error: str | None = None
    fees_extracted: int = 0
    fees_auto_approved: int = 0
    fees_pending: int = 0
    fees_superseded: int = 0
    cost_cents: int = 0


# --- DB layer -------------------------------------------------------------


def _get_db_url() -> str | None:
    return os.environ.get("DATABASE_URL")


def _load_psycopg():
    """Lazy-import psycopg2; return None when unavailable (stub mode)."""
    try:
        import psycopg2  # type: ignore
        import psycopg2.extras  # type: ignore
        return psycopg2
    except ImportError:
        logger.warning("darwin: psycopg2 not installed; DB writes will be stubbed")
        return None


def _load_pending_rows(
    conn, limit: int, *, state: str | None = None
) -> list[dict]:
    """Fetch fees_raw rows with no matching fees_verified row.

    Ordered oldest-first so the backlog drains FIFO. The LIMIT is honoured
    even in continuous-drain mode so each invocation has a bounded cost.
    When `state` is given, only rows for institutions in that state are
    considered.
    """
    params: list[Any] = []
    sql = """
        SELECT fr.id AS fees_raw_id,
               fr.institution_id,
               fr.raw_text,
               fr.raw_payload
        FROM fees_raw fr
    """
    if state:
        sql += " JOIN institutions i ON i.id = fr.institution_id"
    sql += """
        WHERE NOT EXISTS (
            SELECT 1 FROM fees_verified fv WHERE fv.fees_raw_id = fr.id
        )
    """
    if state:
        sql += " AND i.state_code = %s"
        params.append(state)
    sql += " ORDER BY fr.extracted_at ASC LIMIT %s"
    params.append(limit)

    with conn.cursor() as cur:
        cur.execute(sql, tuple(params))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _find_live_row(
    conn, *, institution_id: int, canonical_fee_key: str
) -> dict | None:
    """Find the current live row for (institution, canonical key), if any.

    Returns dict with id + amount, or None if no live row exists. The
    uniqueness constraint guarantees at most one.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, amount
            FROM fees_verified
            WHERE institution_id = %s
              AND canonical_fee_key = %s
              AND superseded_by IS NULL
            LIMIT 1
            """,
            (institution_id, canonical_fee_key),
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "amount": row[1]}


def _insert_verified(
    conn,
    *,
    fees_raw_id: int,
    institution_id: int,
    classification: Classification,
    review_status: str,
    evidence_in_source: bool,
    amount_in_bounds: bool,
    amount_bound_reason: str | None,
) -> int:
    """Insert a fees_verified row. Returns the new row id."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO fees_verified (
                fees_raw_id,
                institution_id,
                fee_category,
                fee_family,
                fee_name,
                amount,
                frequency,
                conditions,
                confidence,
                canonical_fee_key,
                variant_type,
                review_status,
                evidence_quote,
                evidence_in_source,
                amount_in_bounds,
                amount_bound_reason
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                fees_raw_id,
                institution_id,
                classification.fee_category,
                family_for(classification.fee_category),
                classification.fee_name,
                classification.amount,
                classification.frequency,
                classification.conditions,
                round(classification.confidence, 3),
                classification.fee_category,  # canonical_fee_key == category for canonical set
                None,  # variant_type populated by Knox / future enrichment.
                review_status,
                classification.evidence_quote,
                evidence_in_source,
                amount_in_bounds,
                amount_bound_reason,
            ),
        )
        return cur.fetchone()[0]


def _insert_unmapped(
    conn,
    *,
    fees_raw_id: int,
    institution_id: int,
    entry: dict,
    raw_text: str,
) -> int:
    """Insert a long-tail unmapped fee as a fees_verified row.

    fee_category is '_unmapped' (FK placeholder); canonical_fee_key is
    '_unmapped:<slug>' so multiple unmapped fees per institution don't
    collide on the partial unique index. Always review_status='flagged'.
    """
    fee_name = entry.get("fee_name")
    amount = entry.get("amount")
    confidence = entry.get("confidence") or 0.0
    evidence = entry.get("evidence_quote")
    canonical_key = f"_unmapped:{_slugify(fee_name)}"
    evidence_ok = _verify_evidence(evidence, raw_text)
    in_bounds, bound_reason = check_amount(_UNMAPPED_CATEGORY, amount)

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO fees_verified (
                fees_raw_id,
                institution_id,
                fee_category,
                fee_family,
                fee_name,
                amount,
                frequency,
                conditions,
                confidence,
                canonical_fee_key,
                variant_type,
                review_status,
                evidence_quote,
                evidence_in_source,
                amount_in_bounds,
                amount_bound_reason
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                fees_raw_id,
                institution_id,
                _UNMAPPED_CATEGORY,
                _UNMAPPED_FAMILY,
                fee_name,
                amount,
                entry.get("frequency"),
                entry.get("conditions"),
                round(float(confidence), 3),
                canonical_key,
                None,
                "flagged",
                evidence,
                evidence_ok,
                in_bounds,
                bound_reason,
            ),
        )
        return cur.fetchone()[0]


def _find_other_doc_live_rows(
    conn,
    *,
    institution_id: int,
    canonical_fee_key: str,
    exclude_fees_raw_id: int,
) -> list[dict]:
    """Cross-doc dedup helper.

    Find live (non-superseded) fees_verified rows for the same
    (institution, canonical key) that originated from a DIFFERENT fees_raw
    document than the one we're currently processing. Returns list of
    {id, amount, confidence, created_at}.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, amount, confidence, created_at
            FROM fees_verified
            WHERE institution_id = %s
              AND canonical_fee_key = %s
              AND superseded_by IS NULL
              AND fees_raw_id <> %s
            """,
            (institution_id, canonical_fee_key, exclude_fees_raw_id),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _supersede(conn, *, old_id: int, new_id: int) -> None:
    """Mark `old_id` as superseded by `new_id` (price-change history)."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE fees_verified SET superseded_by = %s WHERE id = %s",
            (new_id, old_id),
        )


def _amounts_differ(old: Any, new: Any) -> bool:
    """True when two NUMERIC-ish amounts differ enough to count as a change.

    Treats None on either side as 'different' so we err on the side of
    versioning. Sub-cent jitter is ignored.
    """
    if old is None and new is None:
        return False
    if old is None or new is None:
        return True
    try:
        return abs(float(old) - float(new)) > 0.005
    except (TypeError, ValueError):
        return True


def _emit_event(
    conn,
    *,
    run_id: uuid.UUID,
    status: str,
    payload: dict | None = None,
    error: str | None = None,
) -> None:
    """Insert one row into agent_events."""
    import json
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO agent_events (agent, run_id, status, payload, error)
            VALUES ('darwin', %s, %s, %s::jsonb, %s)
            """,
            (
                str(run_id),
                status,
                json.dumps(payload or {}, default=str),
                error,
            ),
        )


# --- Core drain loop ------------------------------------------------------


def _process_row(
    conn,
    row: dict,
    *,
    run_id: uuid.UUID,
    extractor=extract_fees,
    use_db: bool,
) -> RowOutcome:
    """Extract every fee from one fees_raw row and persist N fees_verified rows.

    Each fee in the document becomes one fees_verified row. Auto-promotion
    is per-fee (confidence >= AUTO_PROMOTE_CONFIDENCE). Price-change history
    is tracked per (institution_id, canonical_fee_key) -- the prior live row
    for that key is superseded by the new row when amounts differ.
    """
    fees_raw_id = row["fees_raw_id"]
    institution_id = row["institution_id"]
    raw_text = row.get("raw_text") or ""
    raw_payload = row.get("raw_payload")

    result: ExtractionResult = extractor(raw_text, raw_payload=raw_payload)

    if not result.fees:
        # Empty document or extraction error -- record so we don't re-drain it.
        if use_db:
            _emit_event(
                conn,
                run_id=run_id,
                status="skipped",
                payload={
                    "reason": "no_fees_extracted",
                    "fees_raw_id": fees_raw_id,
                    "institution_id": institution_id,
                    "notes": result.notes,
                    "cost_cents": result.cost_cents,
                    "stub_extractor": result.stub,
                },
            )
            conn.commit()
        return RowOutcome(
            fees_raw_id=fees_raw_id,
            institution_id=institution_id,
            classification=None,
            fees_verified_id=None,
            superseded_id=None,
            status="empty",
            fees_extracted=0,
            cost_cents=result.cost_cents,
        )

    if not use_db:
        for fee in result.fees:
            logger.info(
                "STUB: would insert fees_verified(category=%s, amount=%s, "
                "confidence=%.2f)",
                fee.fee_category,
                fee.amount,
                fee.confidence,
            )
        return RowOutcome(
            fees_raw_id=fees_raw_id,
            institution_id=institution_id,
            classification=result.fees[0],
            fees_verified_id=None,
            superseded_id=None,
            status="auto_approved" if result.fees[0].auto_promote else "pending",
            fees_extracted=len(result.fees),
            fees_auto_approved=sum(1 for f in result.fees if f.auto_promote),
            fees_pending=sum(1 for f in result.fees if not f.auto_promote),
            cost_cents=result.cost_cents,
        )

    auto_count = 0
    pending_count = 0
    superseded_count = 0
    last_id: int | None = None
    last_classification: Classification | None = None

    # Drop any fee with no usable amount — these are extraction noise.
    # A fee without an amount is not a fee; persisting it just clutters
    # fees_verified with rows the reviewer would reject anyway.
    valid_fees = [
        f for f in result.fees
        if f.amount is not None and float(f.amount) > 0
    ]
    dropped_no_amount = len(result.fees) - len(valid_fees)
    if dropped_no_amount:
        logger.info(
            "darwin: dropped %d fees with null/zero amount for fees_raw=%s",
            dropped_no_amount, fees_raw_id,
        )

    # Per-doc: collapse duplicates by canonical key (Claude may emit a tier
    # variant under the same category). Keep the highest-confidence one.
    deduped: dict[str, Classification] = {}
    for fee in valid_fees:
        existing = deduped.get(fee.fee_category)
        if existing is None or fee.confidence > existing.confidence:
            deduped[fee.fee_category] = fee

    for fee in deduped.values():
        # Evidence verification: is the quote actually present in raw_text?
        evidence_ok = _verify_evidence(fee.evidence_quote, raw_text)
        # Amount sanity bounds per category.
        in_bounds, bound_reason = check_amount(fee.fee_category, fee.amount)

        # Start from Claude's confidence-based decision, then downgrade to
        # 'pending' if either guardrail trips. We never UPGRADE on the basis
        # of the guards -- they are veto-only.
        review_status = "auto_approved" if fee.auto_promote else "pending"
        if review_status == "auto_approved" and (not evidence_ok or not in_bounds):
            review_status = "pending"

        canonical_key = fee.fee_category
        live = _find_live_row(
            conn,
            institution_id=institution_id,
            canonical_fee_key=canonical_key,
        )
        new_id = _insert_verified(
            conn,
            fees_raw_id=fees_raw_id,
            institution_id=institution_id,
            classification=fee,
            review_status=review_status,
            evidence_in_source=evidence_ok,
            amount_in_bounds=in_bounds,
            amount_bound_reason=bound_reason,
        )
        superseded_id: int | None = None
        if live and _amounts_differ(live["amount"], fee.amount):
            _supersede(conn, old_id=live["id"], new_id=new_id)
            superseded_id = live["id"]
            superseded_count += 1

        # Cross-doc dedup. If other live rows exist for the same
        # (institution, canonical key) from a DIFFERENT fees_raw document,
        # the higher-confidence row wins; supersede the loser(s).
        competitors = _find_other_doc_live_rows(
            conn,
            institution_id=institution_id,
            canonical_fee_key=canonical_key,
            exclude_fees_raw_id=fees_raw_id,
        )
        for comp in competitors:
            comp_conf = float(comp.get("confidence") or 0.0)
            if fee.confidence >= comp_conf:
                # New row wins; supersede the older competitor.
                _supersede(conn, old_id=comp["id"], new_id=new_id)
                superseded_count += 1
            else:
                # Existing competitor wins; supersede THIS new row instead.
                _supersede(conn, old_id=new_id, new_id=comp["id"])
                superseded_count += 1
                break  # one winner is enough

        if review_status == "auto_approved":
            auto_count += 1
        else:
            pending_count += 1

        _emit_event(
            conn,
            run_id=run_id,
            status="succeeded",
            payload={
                "fees_raw_id": fees_raw_id,
                "fees_verified_id": new_id,
                "institution_id": institution_id,
                "fee_category": canonical_key,
                "fee_name": fee.fee_name,
                "amount": fee.amount,
                "confidence": fee.confidence,
                "review_status": review_status,
                "superseded_id": superseded_id,
                "evidence_quote": fee.evidence_quote,
                "evidence_in_source": evidence_ok,
                "amount_in_bounds": in_bounds,
                "amount_bound_reason": bound_reason,
                "stub_extractor": result.stub,
            },
        )
        last_id = new_id
        last_classification = fee

    # Persist long-tail unmapped fees so admins can later categorize them.
    unmapped_persisted = 0
    for entry in result.unmapped_fees:
        amount = entry.get("amount")
        if amount is None or float(amount) <= 0:
            # Same noise-filter rule as canonical fees: skip null/zero.
            continue
        try:
            new_id = _insert_unmapped(
                conn,
                fees_raw_id=fees_raw_id,
                institution_id=institution_id,
                entry=entry,
                raw_text=raw_text,
            )
        except Exception as exc:  # noqa: BLE001 -- one bad entry shouldn't kill the doc
            logger.warning("darwin: skipped unmapped entry: %s", exc)
            continue
        unmapped_persisted += 1
        _emit_event(
            conn,
            run_id=run_id,
            status="succeeded",
            payload={
                "fees_raw_id": fees_raw_id,
                "fees_verified_id": new_id,
                "institution_id": institution_id,
                "fee_category": _UNMAPPED_CATEGORY,
                "fee_name": entry.get("fee_name"),
                "amount": amount,
                "confidence": entry.get("confidence"),
                "review_status": "flagged",
                "suggested_category": entry.get("suggested_category"),
                "kind": "unmapped",
            },
        )

    conn.commit()

    row_status = "auto_approved" if auto_count > 0 and pending_count == 0 else "pending"
    return RowOutcome(
        fees_raw_id=fees_raw_id,
        institution_id=institution_id,
        classification=last_classification,
        fees_verified_id=last_id,
        superseded_id=None,
        status=row_status,
        fees_extracted=len(deduped),
        fees_auto_approved=auto_count,
        fees_pending=pending_count,
        fees_superseded=superseded_count,
        cost_cents=result.cost_cents,
    )


def drain(
    *,
    limit: int | None = None,
    dry_run: bool = False,
    extractor=extract_fees,
    state: str | None = None,
    # `classifier` kept for backwards-compat with old callers (tests / Modal
    # invocations that still pass classifier=...). Ignored if `extractor` is
    # provided non-default.
    classifier=None,
) -> dict:
    """Top-level entrypoint: drain a batch of fees_raw rows.

    Returns a summary dict for the CLI / Modal logging.
    """
    run_id = uuid.uuid4()
    batch_limit = limit or DEFAULT_LIMIT

    db_url = _get_db_url()
    psycopg2 = _load_psycopg()
    use_db = bool(db_url and psycopg2 and not dry_run)

    if not use_db:
        if not db_url:
            logger.info("darwin: STUB mode (DATABASE_URL not set)")
        elif psycopg2 is None:
            logger.info("darwin: STUB mode (psycopg2 not installed)")
        elif dry_run:
            logger.info("darwin: dry-run mode (no DB writes)")
        logger.info("darwin: stub mode has no fees_raw to drain; exiting cleanly")
        return {
            "run_id": str(run_id),
            "processed": 0,
            "fees_extracted": 0,
            "auto_approved": 0,
            "pending": 0,
            "empty": 0,
            "errors": 0,
            "cost_cents": 0,
            "state": state,
            "mode": "stub",
        }

    conn = psycopg2.connect(db_url)
    try:
        # Insert agent_runs row first so agent_events FK resolves
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_runs (run_id, agent, status, "
                "trigger_source, target_state) "
                "VALUES (%s, 'darwin', 'in_progress', 'manual', %s) "
                "ON CONFLICT (run_id) DO NOTHING",
                (str(run_id), state),
            )
        conn.commit()

        rows = _load_pending_rows(conn, batch_limit, state=state)
        logger.info(
            "darwin: loaded %d rows to extract (state=%s)",
            len(rows),
            state or "ALL",
        )

        counts = {"auto_approved": 0, "pending": 0, "empty": 0, "errors": 0}
        total_fees_extracted = 0
        total_fees_auto = 0
        total_fees_pending = 0
        total_cost_cents = 0

        for row in rows:
            try:
                outcome = _process_row(
                    conn, row, run_id=run_id, extractor=extractor, use_db=True
                )
                counts[outcome.status] = counts.get(outcome.status, 0) + 1
                total_fees_extracted += outcome.fees_extracted
                total_fees_auto += outcome.fees_auto_approved
                total_fees_pending += outcome.fees_pending
                total_cost_cents += outcome.cost_cents
            except Exception as exc:  # noqa: BLE001 -- isolate per-row failures.
                conn.rollback()
                logger.exception(
                    "darwin: failure on fees_raw_id=%s: %s",
                    row.get("fees_raw_id"),
                    exc,
                )
                counts["errors"] += 1
                _emit_event(
                    conn,
                    run_id=run_id,
                    status="failed",
                    payload={"fees_raw_id": row.get("fees_raw_id")},
                    error=str(exc)[:500],
                )
                conn.commit()

        # Update run-level rollup
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE agent_runs SET ended_at=now(), status=%s, "
                "items_processed=%s, items_failed=%s, cost_cents=%s "
                "WHERE run_id=%s",
                (
                    "succeeded" if counts["errors"] == 0 else "failed",
                    len(rows),
                    counts["errors"],
                    total_cost_cents,
                    str(run_id),
                ),
            )
        conn.commit()

        summary = {
            "run_id": str(run_id),
            "processed": len(rows),
            "fees_extracted": total_fees_extracted,
            "fees_auto_approved": total_fees_auto,
            "fees_pending": total_fees_pending,
            **counts,
            "cost_cents": total_cost_cents,
            "state": state,
            "mode": "db",
        }
        logger.info("darwin: drain complete %s", summary)
        return summary
    finally:
        conn.close()
