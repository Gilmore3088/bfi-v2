"""Unit tests for individual Knox check rules."""

from __future__ import annotations

import pytest

from knox.checks import (
    CANONICAL_CATEGORIES,
    INSTITUTION_REJECT_THRESHOLD,
    check_completeness,
    check_confidence,
    check_institution_wide,
    check_outlier,
    check_taxonomy,
    run_all_checks,
)
from knox.outliers import OutlierBounds


def _row(**overrides) -> dict:
    base = {
        "id": 1,
        "institution_id": 10,
        "fee_category": "monthly_maintenance",
        "fee_family": "account",
        "fee_name": "Monthly Service Fee",
        "amount": 12.0,
        "frequency": "monthly",
        "confidence": 0.95,
        "charter_type": "bank",
    }
    base.update(overrides)
    return base


def test_confidence_passes_above_threshold():
    assert check_confidence(_row(confidence=0.95)) is None


def test_confidence_flags_below_threshold():
    finding = check_confidence(_row(confidence=0.42))
    assert finding is not None
    assert finding.event_type == "low_confidence"
    assert finding.suggested_action == "human_review"
    assert finding.details["confidence"] == pytest.approx(0.42)


def test_confidence_handles_missing_value():
    assert check_confidence(_row(confidence=None)) is None


def test_taxonomy_passes_for_canonical_category():
    canonical = next(iter(CANONICAL_CATEGORIES))
    assert check_taxonomy(_row(fee_category=canonical)) is None


def test_taxonomy_flags_unknown_category():
    finding = check_taxonomy(_row(fee_category="bogus_category"))
    assert finding is not None
    assert finding.event_type == "off_taxonomy"
    assert finding.suggested_action == "reclassify_or_reject"


def test_completeness_passes_when_fields_present():
    assert check_completeness(_row(amount=5.0, frequency="monthly")) is None


def test_completeness_flags_missing_amount():
    finding = check_completeness(_row(amount=None))
    assert finding is not None
    assert finding.event_type == "incomplete_extraction"
    assert "amount" in finding.details["missing_fields"]


def test_completeness_flags_zero_amount_as_missing():
    # Darwin emits amount=0 when extraction fails; treat as incomplete.
    finding = check_completeness(_row(amount=0))
    assert finding is not None
    assert "amount" in finding.details["missing_fields"]


def test_outlier_returns_none_when_no_cohort():
    assert check_outlier(_row(), bounds_index={}) is None


def test_outlier_flags_amount_outside_bounds():
    bounds = OutlierBounds(
        category="monthly_maintenance",
        charter_type="bank",
        n=20,
        median=10.0,
        q1=8.0,
        q3=12.0,
        iqr=4.0,
        lower=-4.0,
        upper=24.0,
    )
    finding = check_outlier(_row(amount=999.0), bounds_index={("monthly_maintenance", "bank"): bounds})
    assert finding is not None
    assert finding.event_type == "statistical_outlier"
    assert finding.details["amount"] == 999.0


def test_outlier_ignores_in_bound_amount():
    bounds = OutlierBounds(
        category="monthly_maintenance",
        charter_type="bank",
        n=20,
        median=10.0,
        q1=8.0,
        q3=12.0,
        iqr=4.0,
        lower=-4.0,
        upper=24.0,
    )
    assert check_outlier(_row(amount=11.0), bounds_index={("monthly_maintenance", "bank"): bounds}) is None


def test_institution_wide_flags_when_threshold_met():
    counts = {10: INSTITUTION_REJECT_THRESHOLD}
    finding = check_institution_wide(_row(institution_id=10), counts)
    assert finding is not None
    assert finding.event_type == "institution_wide_problem"
    assert finding.severity == "critical"
    assert finding.suggested_action == "requeue_magellan"


def test_institution_wide_silent_below_threshold():
    counts = {10: INSTITUTION_REJECT_THRESHOLD - 1}
    assert check_institution_wide(_row(institution_id=10), counts) is None


def test_run_all_checks_collects_multiple_findings():
    findings = run_all_checks(
        _row(confidence=0.2, fee_category="bogus", amount=None),
        bounds_index={},
        recent_reject_counts={},
    )
    event_types = {f.event_type for f in findings}
    assert {"low_confidence", "off_taxonomy", "incomplete_extraction"}.issubset(event_types)


def test_run_all_checks_clean_row_has_no_findings():
    canonical = "monthly_maintenance"
    assert canonical in CANONICAL_CATEGORIES
    findings = run_all_checks(
        _row(fee_category=canonical, confidence=0.99, amount=10.0, frequency="monthly"),
        bounds_index={},
        recent_reject_counts={},
    )
    assert findings == []
