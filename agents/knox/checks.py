"""Adversarial-review checks Knox runs against ``fees_verified`` rows.

Each check is a pure function returning ``Finding | None`` so the rules can
be tested in isolation.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from .outliers import OutlierBounds

CONFIDENCE_THRESHOLD = 0.90
INSTITUTION_REJECT_THRESHOLD = 3

# Canonical 49-category taxonomy. Kept in sync with TS ``lib/taxonomy.ts``.
# TODO(knox): load from the ``taxonomy`` table once the baseline migration
# lands; this list is the M1 placeholder.
# Single source of truth — pulled from Darwin's canonical list so the two
# agents can't drift. If Darwin's taxonomy is missing here, that's the bug.
from agents.darwin.taxonomy import CANONICAL_CATEGORIES as _DARWIN_CANONICAL  # type: ignore

CANONICAL_CATEGORIES: frozenset[str] = frozenset(_DARWIN_CANONICAL)

REQUIRED_FIELDS: tuple[str, ...] = ("amount", "frequency")


@dataclass(frozen=True)
class Finding:
    """A single problem Knox identified with a row."""

    event_type: str
    severity: str  # 'info' | 'warning' | 'critical'
    fees_verified_id: int
    reason: str
    suggested_action: str
    details: dict[str, Any]


def check_confidence(row: dict, threshold: float = CONFIDENCE_THRESHOLD) -> Finding | None:
    confidence = row.get("confidence")
    if confidence is None or confidence >= threshold:
        return None
    return Finding(
        event_type="low_confidence",
        severity="warning",
        fees_verified_id=int(row["id"]),
        reason=f"confidence {confidence:.2f} below threshold {threshold:.2f}",
        suggested_action="human_review",
        details={"confidence": float(confidence), "threshold": threshold},
    )


def check_outlier(row: dict, bounds_index: dict[tuple[str, str], OutlierBounds]) -> Finding | None:
    category = row.get("fee_category")
    charter = row.get("charter_type")
    amount = row.get("amount")
    if category is None or charter is None or amount is None:
        return None

    bounds = bounds_index.get((category, charter))
    if bounds is None or not bounds.is_outlier(float(amount)):
        return None

    return Finding(
        event_type="statistical_outlier",
        severity="warning",
        fees_verified_id=int(row["id"]),
        reason=(
            f"amount {float(amount):.2f} outside IQR bounds "
            f"[{bounds.lower:.2f}, {bounds.upper:.2f}] for "
            f"{category}/{charter} (n={bounds.n}, median={bounds.median:.2f})"
        ),
        suggested_action="human_review",
        details={
            "amount": float(amount),
            "category": category,
            "charter_type": charter,
            "lower": bounds.lower,
            "upper": bounds.upper,
            "median": bounds.median,
            "n": bounds.n,
        },
    )


def check_taxonomy(row: dict, canonical: Iterable[str] = CANONICAL_CATEGORIES) -> Finding | None:
    category = row.get("fee_category")
    canonical_set = canonical if isinstance(canonical, frozenset) else frozenset(canonical)
    if category and category in canonical_set:
        return None
    return Finding(
        event_type="off_taxonomy",
        severity="warning",
        fees_verified_id=int(row["id"]),
        reason=f"fee_category {category!r} not in canonical taxonomy",
        suggested_action="reclassify_or_reject",
        details={"fee_category": category},
    )


def check_completeness(row: dict, required: Iterable[str] = REQUIRED_FIELDS) -> Finding | None:
    missing = [field for field in required if row.get(field) in (None, "", 0)]
    # amount==0 is treated as missing because Darwin emits 0 on extraction failure
    if not missing:
        return None
    return Finding(
        event_type="incomplete_extraction",
        severity="warning",
        fees_verified_id=int(row["id"]),
        reason=f"missing required fields: {', '.join(missing)}",
        suggested_action="re_extract",
        details={"missing_fields": missing},
    )


def check_institution_wide(
    row: dict,
    recent_reject_counts: dict[int, int],
    threshold: int = INSTITUTION_REJECT_THRESHOLD,
) -> Finding | None:
    institution_id = row.get("institution_id")
    if institution_id is None:
        return None
    count = recent_reject_counts.get(int(institution_id), 0)
    if count < threshold:
        return None
    return Finding(
        event_type="institution_wide_problem",
        severity="critical",
        fees_verified_id=int(row["id"]),
        reason=(
            f"institution {institution_id} has {count} recent rejects "
            f"(>= {threshold}); URL may be stale"
        ),
        suggested_action="requeue_magellan",
        details={"institution_id": int(institution_id), "recent_rejects": count},
    )


def run_all_checks(
    row: dict,
    *,
    bounds_index: dict[tuple[str, str], OutlierBounds],
    recent_reject_counts: dict[int, int],
) -> list[Finding]:
    """Run every check against ``row`` and return all findings."""
    findings: list[Finding] = []
    for check in (
        lambda r: check_confidence(r),
        lambda r: check_taxonomy(r),
        lambda r: check_completeness(r),
        lambda r: check_outlier(r, bounds_index),
        lambda r: check_institution_wide(r, recent_reject_counts),
    ):
        finding = check(row)
        if finding is not None:
            findings.append(finding)
    return findings
