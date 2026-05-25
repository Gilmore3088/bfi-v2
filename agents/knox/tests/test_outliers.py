"""Unit tests for IQR-based outlier detection."""

from __future__ import annotations

from knox.outliers import (
    DEFAULT_K,
    MIN_COHORT_SIZE,
    build_bounds_index,
    compute_bounds,
)


def test_compute_bounds_returns_none_for_small_cohort():
    amounts = list(range(MIN_COHORT_SIZE - 1))
    assert compute_bounds(amounts, "monthly_maintenance", "bank") is None


def test_compute_bounds_flags_extreme_amount():
    amounts = [10.0] * 20
    bounds = compute_bounds(amounts, "monthly_maintenance", "bank")
    assert bounds is not None
    # With zero IQR the bounds collapse to the median; any deviation is an outlier.
    assert bounds.is_outlier(999.0)
    assert not bounds.is_outlier(10.0)


def test_compute_bounds_uses_k_factor():
    amounts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    bounds = compute_bounds(amounts, "nsf", "credit_union", k=DEFAULT_K)
    assert bounds is not None
    assert bounds.q1 < bounds.median < bounds.q3
    # A value moderately above q3 but inside the 3*IQR window is not an outlier.
    assert not bounds.is_outlier(bounds.q3 + 0.5 * bounds.iqr)
    # A value far above the window is an outlier.
    assert bounds.is_outlier(bounds.q3 + 10 * bounds.iqr)


def test_build_bounds_index_groups_by_category_and_charter():
    rows = []
    rows.extend(
        {"fee_category": "monthly_maintenance", "charter_type": "bank", "amount": float(x)}
        for x in range(MIN_COHORT_SIZE * 2)
    )
    rows.extend(
        {"fee_category": "nsf", "charter_type": "credit_union", "amount": float(x)}
        for x in range(MIN_COHORT_SIZE * 2)
    )
    # Below-threshold cohort should be dropped.
    rows.append({"fee_category": "wire_incoming", "charter_type": "bank", "amount": 5.0})

    index = build_bounds_index(rows)
    assert ("monthly_maintenance", "bank") in index
    assert ("nsf", "credit_union") in index
    assert ("wire_incoming", "bank") not in index


def test_build_bounds_index_ignores_rows_missing_fields():
    rows = [{"fee_category": None, "charter_type": "bank", "amount": 1.0}] * 20
    rows += [{"fee_category": "nsf", "charter_type": None, "amount": 1.0}] * 20
    rows += [{"fee_category": "nsf", "charter_type": "bank", "amount": None}] * 20
    assert build_bounds_index(rows) == {}
