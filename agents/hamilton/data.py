"""Data-access layer for Hamilton.

Pulls the verified fee data Hamilton needs from Postgres for each of the
three M1 report kinds. Every query is read-only; writes go through
``agent.py``. The functions return plain dicts/lists so they survive the
trip to Jinja2 and to the Anthropic prompt unchanged.

All queries tolerate missing tables (returning empty results) so the
stub mode in ``agent.py`` can exercise the full pipeline without a
live DB.
"""

from __future__ import annotations

import logging
import os
import statistics
from dataclasses import dataclass
from typing import Any, Sequence

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Institution:
    id: int | None
    slug: str
    name: str
    charter: str
    state: str | None
    asset_tier: str | None


@dataclass(frozen=True)
class FeeRow:
    institution_slug: str
    institution_name: str
    canonical_category: str
    amount: float
    extracted_at: str | None


def _load_psycopg():
    """Lazy-import psycopg2; returns None if unavailable (stub mode)."""
    try:
        import psycopg2  # type: ignore
        import psycopg2.extras  # type: ignore
        return psycopg2
    except ImportError:
        logger.warning("hamilton: psycopg2 not installed; data layer in stub mode")
        return None


def get_db_url() -> str | None:
    return os.environ.get("DATABASE_URL")


def _slug(value: str) -> str:
    return value.lower().replace(" ", "-").replace("'", "").replace(".", "")


# --- Stub data ---------------------------------------------------------------
# Used when DATABASE_URL is unset or psycopg2 is missing so the CLI and tests
# still produce a coherent report shape. These mirror the SPEC.md seed list.

_STUB_INSTITUTIONS: tuple[Institution, ...] = (
    Institution(1, "jpmorgan-chase", "JPMorgan Chase", "bank", "OH", "super_regional"),
    Institution(2, "bank-of-america", "Bank of America", "bank", "NC", "super_regional"),
    Institution(3, "wells-fargo", "Wells Fargo", "bank", "CA", "super_regional"),
    Institution(4, "citi", "Citibank", "bank", "NY", "super_regional"),
    Institution(5, "navy-federal-credit-union", "Navy Federal Credit Union", "credit_union", "VA", "large_regional"),
)

_STUB_FEES: tuple[FeeRow, ...] = (
    FeeRow("jpmorgan-chase", "JPMorgan Chase", "overdraft", 34.0, "2026-05-01"),
    FeeRow("bank-of-america", "Bank of America", "overdraft", 10.0, "2026-05-01"),
    FeeRow("wells-fargo", "Wells Fargo", "overdraft", 35.0, "2026-05-01"),
    FeeRow("citi", "Citibank", "overdraft", 0.0, "2026-05-01"),
    FeeRow("navy-federal-credit-union", "Navy Federal Credit Union", "overdraft", 20.0, "2026-05-01"),
    FeeRow("jpmorgan-chase", "JPMorgan Chase", "monthly_maintenance", 12.0, "2026-05-01"),
    FeeRow("bank-of-america", "Bank of America", "monthly_maintenance", 14.0, "2026-05-01"),
    FeeRow("wells-fargo", "Wells Fargo", "monthly_maintenance", 10.0, "2026-05-01"),
    FeeRow("citi", "Citibank", "monthly_maintenance", 15.0, "2026-05-01"),
    FeeRow("navy-federal-credit-union", "Navy Federal Credit Union", "monthly_maintenance", 0.0, "2026-05-01"),
    FeeRow("jpmorgan-chase", "JPMorgan Chase", "nsf", 34.0, "2026-05-01"),
    FeeRow("bank-of-america", "Bank of America", "nsf", 0.0, "2026-05-01"),
    FeeRow("wells-fargo", "Wells Fargo", "nsf", 35.0, "2026-05-01"),
)


# --- Public API --------------------------------------------------------------


def load_institution(slug: str) -> Institution | None:
    """Find a single institution by slug, falling back to stub data."""
    db_url = get_db_url()
    psycopg2 = _load_psycopg()
    if not (db_url and psycopg2):
        return next((i for i in _STUB_INSTITUTIONS if i.slug == slug), None)

    with psycopg2.connect(db_url) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT id, slug, name, charter_type, state_code, asset_tier
                FROM institutions
                WHERE slug = %s
                LIMIT 1
                """,
                (slug,),
            )
            row = cur.fetchone()
        except Exception as exc:  # noqa: BLE001 -- treat any DB error as stub fallback
            logger.warning("hamilton: load_institution fell back to stub (%s)", exc)
            return next((i for i in _STUB_INSTITUTIONS if i.slug == slug), None)

    if not row:
        return None
    return Institution(id=row[0], slug=row[1], name=row[2], charter=row[3], state=row[4], asset_tier=row[5])


def load_institution_fees(slug: str) -> list[FeeRow]:
    """Return all verified fees for an institution."""
    db_url = get_db_url()
    psycopg2 = _load_psycopg()
    if not (db_url and psycopg2):
        return [f for f in _STUB_FEES if f.institution_slug == slug]

    with psycopg2.connect(db_url) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT i.slug, i.name, fv.canonical_category, fv.amount, fv.extracted_at::text
                FROM fees_verified fv
                JOIN institutions i ON i.id = fv.institution_id
                WHERE i.slug = %s
                  AND fv.review_status IN ('approved', 'auto_approved')
                  AND fv.superseded_by IS NULL
                ORDER BY fv.canonical_category
                """,
                (slug,),
            )
            rows = cur.fetchall()
        except Exception as exc:  # noqa: BLE001
            logger.warning("hamilton: load_institution_fees fell back to stub (%s)", exc)
            return [f for f in _STUB_FEES if f.institution_slug == slug]

    return [FeeRow(*row) for row in rows]


def load_category_fees(category: str) -> list[FeeRow]:
    """Return all verified fee rows for a single canonical category."""
    db_url = get_db_url()
    psycopg2 = _load_psycopg()
    if not (db_url and psycopg2):
        return [f for f in _STUB_FEES if f.canonical_category == category]

    with psycopg2.connect(db_url) as conn, conn.cursor() as cur:
        try:
            cur.execute(
                """
                SELECT LOWER(REGEXP_REPLACE(i.name, '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
                       i.name, fv.fee_category, fv.amount, fv.created_at::text
                FROM fees_verified fv
                JOIN institutions i ON i.id = fv.institution_id
                WHERE fv.fee_category = %s
                  AND fv.review_status IN ('approved', 'auto_approved')
                  AND fv.superseded_by IS NULL
                ORDER BY fv.amount
                """,
                (category,),
            )
            rows = cur.fetchall()
        except Exception as exc:  # noqa: BLE001
            logger.warning("hamilton: load_category_fees fell back to stub (%s)", exc)
            return [f for f in _STUB_FEES if f.canonical_category == category]

    return [FeeRow(*row) for row in rows]


def summarize_distribution(rows: Sequence[FeeRow]) -> dict[str, Any]:
    """Compute median / quartiles / count over a fee row collection."""
    amounts = sorted(r.amount for r in rows if r.amount is not None)
    if not amounts:
        return {"count": 0, "median": None, "p25": None, "p75": None, "min": None, "max": None}

    quantiles = (
        statistics.quantiles(amounts, n=4) if len(amounts) >= 4 else [amounts[0], amounts[len(amounts) // 2], amounts[-1]]
    )
    return {
        "count": len(amounts),
        "median": statistics.median(amounts),
        "p25": quantiles[0],
        "p75": quantiles[-1],
        "min": amounts[0],
        "max": amounts[-1],
    }


def build_institution_context(slug: str) -> dict[str, Any]:
    """Assemble the full data context for an institution-profile report."""
    inst = load_institution(slug)
    if not inst:
        raise ValueError(f"institution not found: {slug}")

    fees = load_institution_fees(slug)
    # For each category the institution has, pull peer distribution.
    peer_context: dict[str, dict[str, Any]] = {}
    for category in {f.canonical_category for f in fees}:
        all_in_cat = load_category_fees(category)
        peer_context[category] = {
            "distribution": summarize_distribution(all_in_cat),
            "subject_amount": next(
                (f.amount for f in fees if f.canonical_category == category),
                None,
            ),
        }

    return {
        "kind": "institution",
        "institution": {
            "slug": inst.slug,
            "name": inst.name,
            "charter": inst.charter,
            "state": inst.state,
            "asset_tier": inst.asset_tier,
        },
        "fees": [
            {
                "category": f.canonical_category,
                "amount": f.amount,
                "extracted_at": f.extracted_at,
            }
            for f in fees
        ],
        "peers": peer_context,
    }


def build_category_context(category: str) -> dict[str, Any]:
    """Assemble the full data context for a category-deep-dive report."""
    rows = load_category_fees(category)
    distribution = summarize_distribution(rows)
    return {
        "kind": "category",
        "category": category,
        "distribution": distribution,
        "rows": [
            {
                "institution_slug": r.institution_slug,
                "institution_name": r.institution_name,
                "amount": r.amount,
                "extracted_at": r.extracted_at,
            }
            for r in rows
        ],
    }


def build_peer_context(subject_slug: str, peer_slugs: Sequence[str]) -> dict[str, Any]:
    """Assemble side-by-side peer-benchmark context."""
    subject = load_institution(subject_slug)
    if not subject:
        raise ValueError(f"institution not found: {subject_slug}")

    members = [subject] + [
        m for m in (load_institution(p) for p in peer_slugs) if m is not None
    ]
    table: dict[str, dict[str, Any]] = {}
    for member in members:
        fees = load_institution_fees(member.slug)
        for f in fees:
            row = table.setdefault(
                f.canonical_category,
                {"category": f.canonical_category, "by_institution": {}},
            )
            row["by_institution"][member.slug] = f.amount

    return {
        "kind": "peer",
        "subject": {
            "slug": subject.slug,
            "name": subject.name,
            "charter": subject.charter,
            "state": subject.state,
        },
        "peers": [
            {"slug": m.slug, "name": m.name, "charter": m.charter, "state": m.state}
            for m in members[1:]
        ],
        "table": list(table.values()),
    }
