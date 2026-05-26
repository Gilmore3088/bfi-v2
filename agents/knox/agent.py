"""Knox review loop.

Pulls ``fees_verified`` rows that Darwin has touched, runs the check
battery, and emits ``agent_events`` rows for the human review queue.
"""

from __future__ import annotations

import json
import logging
import os
import uuid
from dataclasses import asdict
from typing import Any

import psycopg2
import psycopg2.extras

from .checks import Finding, run_all_checks
from .outliers import build_bounds_index

logger = logging.getLogger(__name__)

AGENT_NAME = "knox"
RECENT_REJECT_WINDOW_DAYS = 7

FEES_QUERY = """
    SELECT
        fv.id,
        fv.institution_id,
        fv.fee_category,
        fv.fee_family,
        fv.fee_name,
        fv.amount,
        fv.frequency,
        fv.confidence,
        fv.review_status,
        fv.created_at,
        i.charter_type
    FROM fees_verified fv
    JOIN institutions i ON i.id = fv.institution_id
    WHERE fv.review_status IN ('verified', 'needs_review', 'pending', 'auto_approved')
      AND fv.superseded_by IS NULL
    ORDER BY fv.id ASC
    LIMIT %s
"""

COHORT_QUERY = """
    SELECT fv.fee_category, fv.amount, i.charter_type
    FROM fees_verified fv
    JOIN institutions i ON i.id = fv.institution_id
    WHERE fv.review_status IN ('verified', 'approved', 'auto_approved')
      AND fv.superseded_by IS NULL
      AND fv.amount IS NOT NULL
"""

RECENT_REJECTS_QUERY = """
    SELECT institution_id, COUNT(*) AS n
    FROM fees_verified
    WHERE review_status = 'rejected'
      AND reviewed_at >= NOW() - (%s || ' days')::interval
    GROUP BY institution_id
"""

EXISTING_EVENT_QUERY = """
    SELECT 1
    FROM agent_events
    WHERE agent = %s
      AND payload->>'fees_verified_id' = %s
      AND payload->>'event_type' = %s
      AND payload->>'row_signature' = %s
    LIMIT 1
"""

INSERT_EVENT_SQL = """
    INSERT INTO agent_events (agent, run_id, status, payload, created_at)
    VALUES (%s, %s, %s, %s::jsonb, NOW())
"""


def _row_signature(row: dict) -> str:
    """A stable signature for idempotency.

    Re-running Knox on the same row produces the same signature, so a
    duplicate event is skipped. If the row data changes (Darwin re-classifies
    with new amount/category/confidence), the signature changes and a new
    event is emitted.
    """
    parts = [
        str(row.get("amount")),
        str(row.get("fee_category")),
        str(row.get("confidence")),
        str(row.get("frequency")),
    ]
    return "|".join(parts)


def _finding_to_payload(finding: Finding, row: dict) -> dict[str, Any]:
    payload = asdict(finding)
    payload["row_signature"] = _row_signature(row)
    payload["institution_id"] = row.get("institution_id")
    payload["fees_verified_id"] = str(finding.fees_verified_id)
    return payload


def _event_exists(cursor, finding: Finding, row: dict) -> bool:
    cursor.execute(
        EXISTING_EVENT_QUERY,
        (
            AGENT_NAME,
            str(finding.fees_verified_id),
            finding.event_type,
            _row_signature(row),
        ),
    )
    return cursor.fetchone() is not None


def review(
    *,
    database_url: str | None = None,
    limit: int = 500,
    dry_run: bool = False,
) -> dict[str, int]:
    """Run one Knox review pass.

    Returns a summary dict with counts.
    """
    database_url = database_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set")

    summary = {
        "rows_examined": 0,
        "findings": 0,
        "events_emitted": 0,
        "events_skipped_dup": 0,
    }

    run_id = str(uuid.uuid4())
    logger.info("knox run %s start (limit=%d dry_run=%s)", run_id, limit, dry_run)

    with psycopg2.connect(database_url) as conn:
        conn.set_session(autocommit=False)
        # Record agent_runs row so the live dashboard reflects this Knox pass
        with conn.cursor() as setup_cur:
            setup_cur.execute(
                "INSERT INTO agent_runs (run_id, agent, status, trigger_source) "
                "VALUES (%s, 'knox', 'in_progress', 'manual') "
                "ON CONFLICT (run_id) DO NOTHING",
                (run_id,),
            )
        conn.commit()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(COHORT_QUERY)
            cohort_rows = [dict(r) for r in cur.fetchall()]
            bounds_index = build_bounds_index(cohort_rows)

            cur.execute(RECENT_REJECTS_QUERY, (RECENT_REJECT_WINDOW_DAYS,))
            recent_reject_counts = {int(r["institution_id"]): int(r["n"]) for r in cur.fetchall()}

            cur.execute(FEES_QUERY, (limit,))
            rows = [dict(r) for r in cur.fetchall()]

        summary["rows_examined"] = len(rows)

        with conn.cursor() as write_cur:
            for row in rows:
                findings = run_all_checks(
                    row,
                    bounds_index=bounds_index,
                    recent_reject_counts=recent_reject_counts,
                )
                for finding in findings:
                    summary["findings"] += 1
                    if _event_exists(write_cur, finding, row):
                        summary["events_skipped_dup"] += 1
                        continue
                    payload = _finding_to_payload(finding, row)
                    status = "failed" if finding.severity == "critical" else "succeeded"
                    if dry_run:
                        logger.info("DRY-RUN emit %s", payload)
                    else:
                        write_cur.execute(
                            INSERT_EVENT_SQL,
                            (AGENT_NAME, run_id, status, json.dumps(payload)),
                        )
                    summary["events_emitted"] += 1

        if dry_run:
            conn.rollback()
        else:
            conn.commit()

        # Finalize the agent_runs row
        with conn.cursor() as fin_cur:
            fin_cur.execute(
                "UPDATE agent_runs SET status='succeeded', ended_at=now(), "
                "items_processed=%s WHERE run_id=%s",
                (summary["rows_examined"], run_id),
            )
        conn.commit()

    logger.info("knox run %s complete: %s", run_id, summary)
    return summary
