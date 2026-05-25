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

from .classifier import AUTO_PROMOTE_CONFIDENCE, Classification, classify
from .taxonomy import family_for, is_canonical


logger = logging.getLogger(__name__)


# Default per-run batch size when --limit is not provided. Avoids
# accidentally classifying 100K rows in one Modal invocation.
DEFAULT_LIMIT = 100


@dataclass
class RowOutcome:
    """Per-row drain outcome for the run summary."""

    fees_raw_id: int
    institution_id: int
    classification: Classification | None
    fees_verified_id: int | None
    superseded_id: int | None
    status: str  # 'auto_approved' | 'pending' | 'flagged_taxonomy' | 'error'
    error: str | None = None


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


def _load_pending_rows(conn, limit: int) -> list[dict]:
    """Fetch fees_raw rows with no matching fees_verified row.

    Ordered oldest-first so the backlog drains FIFO. The LIMIT is honoured
    even in continuous-drain mode so each invocation has a bounded cost.
    """
    sql = """
        SELECT fr.id AS fees_raw_id,
               fr.institution_id,
               fr.raw_text,
               fr.raw_payload
        FROM fees_raw fr
        WHERE NOT EXISTS (
            SELECT 1 FROM fees_verified fv WHERE fv.fees_raw_id = fr.id
        )
        ORDER BY fr.extracted_at ASC
        LIMIT %s
    """
    with conn.cursor() as cur:
        cur.execute(sql, (limit,))
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
                review_status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
            ),
        )
        return cur.fetchone()[0]


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
    classifier=classify,
    use_db: bool,
) -> RowOutcome:
    """Classify one fees_raw row and persist the result."""
    fees_raw_id = row["fees_raw_id"]
    institution_id = row["institution_id"]
    raw_text = row.get("raw_text") or ""
    raw_payload = row.get("raw_payload")

    classification = classifier(raw_text, raw_payload=raw_payload)

    if classification.off_taxonomy:
        # Off-taxonomy: cannot insert into fees_verified (FK to taxonomy
        # would fail). Record as an agent_event so Knox / a human can
        # adjudicate without polluting the verified set.
        logger.warning(
            "darwin: off-taxonomy classification %r for fees_raw=%s; flagging",
            classification.fee_category,
            fees_raw_id,
        )
        if use_db:
            _emit_event(
                conn,
                run_id=run_id,
                status="skipped",
                payload={
                    "reason": "off_taxonomy",
                    "fees_raw_id": fees_raw_id,
                    "institution_id": institution_id,
                    "predicted_category": classification.fee_category,
                    "confidence": classification.confidence,
                },
            )
            conn.commit()
        return RowOutcome(
            fees_raw_id=fees_raw_id,
            institution_id=institution_id,
            classification=classification,
            fees_verified_id=None,
            superseded_id=None,
            status="flagged_taxonomy",
        )

    review_status = "auto_approved" if classification.auto_promote else "pending"

    if not use_db:
        logger.info(
            "STUB: would insert fees_verified(fees_raw_id=%s, institution_id=%s, "
            "category=%s, confidence=%.2f, review_status=%s)",
            fees_raw_id,
            institution_id,
            classification.fee_category,
            classification.confidence,
            review_status,
        )
        return RowOutcome(
            fees_raw_id=fees_raw_id,
            institution_id=institution_id,
            classification=classification,
            fees_verified_id=None,
            superseded_id=None,
            status=review_status,
        )

    # Price-change-history: find the live row for this (institution, key).
    # If amount changed, we will supersede the old row after inserting the
    # new one. Both writes happen in a single transaction.
    canonical_key = classification.fee_category
    live = _find_live_row(
        conn, institution_id=institution_id, canonical_fee_key=canonical_key
    )

    new_id = _insert_verified(
        conn,
        fees_raw_id=fees_raw_id,
        institution_id=institution_id,
        classification=classification,
        review_status=review_status,
    )
    superseded_id: int | None = None
    if live and _amounts_differ(live["amount"], classification.amount):
        _supersede(conn, old_id=live["id"], new_id=new_id)
        superseded_id = live["id"]
        logger.info(
            "darwin: price change for institution=%s key=%s old=%s new=%s",
            institution_id,
            canonical_key,
            live["amount"],
            classification.amount,
        )

    _emit_event(
        conn,
        run_id=run_id,
        status="succeeded",
        payload={
            "fees_raw_id": fees_raw_id,
            "fees_verified_id": new_id,
            "institution_id": institution_id,
            "category": classification.fee_category,
            "confidence": classification.confidence,
            "review_status": review_status,
            "superseded_id": superseded_id,
            "stub_classifier": classification.stub,
        },
    )
    conn.commit()

    return RowOutcome(
        fees_raw_id=fees_raw_id,
        institution_id=institution_id,
        classification=classification,
        fees_verified_id=new_id,
        superseded_id=superseded_id,
        status=review_status,
    )


def drain(
    *,
    limit: int | None = None,
    dry_run: bool = False,
    classifier=classify,
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
            "auto_approved": 0,
            "pending": 0,
            "flagged_taxonomy": 0,
            "errors": 0,
            "mode": "stub",
        }

    conn = psycopg2.connect(db_url)
    try:
        # Insert agent_runs row first so agent_events FK resolves
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO agent_runs (run_id, agent, status, trigger_source) "
                "VALUES (%s, 'darwin', 'in_progress', 'manual') ON CONFLICT (run_id) DO NOTHING",
                (str(run_id),),
            )
        conn.commit()

        rows = _load_pending_rows(conn, batch_limit)
        logger.info("darwin: loaded %d rows to classify", len(rows))

        counts = {"auto_approved": 0, "pending": 0, "flagged_taxonomy": 0, "errors": 0}

        for row in rows:
            try:
                outcome = _process_row(
                    conn, row, run_id=run_id, classifier=classifier, use_db=True
                )
                counts[outcome.status] = counts.get(outcome.status, 0) + 1
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
                "UPDATE agent_runs SET ended_at=now(), status=%s, items_processed=%s "
                "WHERE run_id=%s",
                (
                    "succeeded" if counts["errors"] == 0 else "failed",
                    len(rows),
                    str(run_id),
                ),
            )
        conn.commit()

        summary = {
            "run_id": str(run_id),
            "processed": len(rows),
            **counts,
            "mode": "db",
        }
        logger.info("darwin: drain complete %s", summary)
        return summary
    finally:
        conn.close()
