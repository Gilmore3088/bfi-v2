"""Tests for `agents.darwin.bounds.check_amount`."""

from __future__ import annotations

import pytest

from darwin.bounds import BOUNDS, check_amount


def test_null_amount_returns_false_with_reason():
    ok, reason = check_amount("monthly_maintenance", None)
    assert ok is False
    assert reason == "null amount"


def test_non_positive_amount_returns_false():
    ok, reason = check_amount("overdraft", 0)
    assert ok is False
    assert reason == "non-positive amount"

    ok2, reason2 = check_amount("overdraft", -5.0)
    assert ok2 is False
    assert reason2 == "non-positive amount"


def test_non_numeric_amount_returns_false():
    ok, reason = check_amount("overdraft", "abc")  # type: ignore[arg-type]
    assert ok is False
    assert reason == "non-numeric amount"


@pytest.mark.parametrize("category,floor,ceiling", [
    (cat, lo, hi) for cat, (lo, hi) in BOUNDS.items()
])
def test_mid_range_amount_in_bounds(category: str, floor: float, ceiling: float):
    mid = (floor + ceiling) / 2.0
    if mid <= 0:
        mid = max(0.01, ceiling / 2.0)
    ok, reason = check_amount(category, mid)
    assert ok is True, f"{category} mid={mid}: {reason}"
    assert reason is None


def test_above_ceiling_flags_with_reason():
    ok, reason = check_amount("overdraft", 999.0)
    assert ok is False
    assert reason is not None
    assert "above typical ceiling" in reason


def test_below_floor_flags_with_reason():
    # monthly_maintenance floor is 3.0; 1.0 is below.
    ok, reason = check_amount("monthly_maintenance", 1.0)
    assert ok is False
    assert reason is not None
    assert "below typical floor" in reason


def test_unknown_category_uses_default_bounds():
    # Default is (0, 1000); a value in that range passes.
    ok, reason = check_amount("some_category_we_havent_seen", 50.0)
    assert ok is True
    assert reason is None

    # And exceeding 1000 fails.
    ok2, reason2 = check_amount("some_category_we_havent_seen", 5000.0)
    assert ok2 is False
    assert reason2 is not None
    assert "1000" in reason2


def test_unmapped_placeholder_uses_default_bounds():
    ok, _ = check_amount("_unmapped", 25.0)
    assert ok is True
