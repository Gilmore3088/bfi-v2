"""Tests for the frozen 49-category whitelist."""

from __future__ import annotations

from darwin.taxonomy import (
    CANONICAL_CATEGORIES,
    CATEGORY_FAMILY,
    FAMILIES,
    family_for,
    is_canonical,
)


def test_canonical_set_has_exactly_49_categories() -> None:
    assert len(CANONICAL_CATEGORIES) == 49


def test_canonical_set_has_exactly_9_families() -> None:
    assert len(FAMILIES) == 9
    assert len(set(FAMILIES)) == 9


def test_canonical_categories_are_unique() -> None:
    assert len(set(CANONICAL_CATEGORIES)) == len(CANONICAL_CATEGORIES)


def test_canonical_categories_are_snake_case_strings() -> None:
    for cat in CANONICAL_CATEGORIES:
        assert isinstance(cat, str)
        assert cat == cat.lower()
        assert " " not in cat
        assert "-" not in cat


def test_every_category_belongs_to_a_family() -> None:
    assert set(CATEGORY_FAMILY) == set(CANONICAL_CATEGORIES)
    for cat in CANONICAL_CATEGORIES:
        assert CATEGORY_FAMILY[cat] in FAMILIES


def test_is_canonical_accepts_whitelisted() -> None:
    # Spot-check a few known categories from the v1 product.
    assert is_canonical("monthly_maintenance")
    assert is_canonical("nsf")
    assert is_canonical("overdraft")
    assert is_canonical("atm_non_network")
    assert is_canonical("wire_intl_outgoing")


def test_is_canonical_rejects_drift() -> None:
    # These are examples of the 91-category drift seen in v1 production.
    assert not is_canonical("monthly_maintenance_charge")
    assert not is_canonical("month_fee")
    assert not is_canonical("premier_fee")
    assert not is_canonical("overdraft_privilege")
    assert not is_canonical("excessive_withdrawal_fee")


def test_is_canonical_rejects_empty_inputs() -> None:
    assert not is_canonical(None)
    assert not is_canonical("")


def test_family_for_returns_expected_grouping() -> None:
    assert family_for("monthly_maintenance") == "Account Maintenance"
    assert family_for("overdraft") == "Overdraft & NSF"
    assert family_for("nsf") == "Overdraft & NSF"
    assert family_for("atm_non_network") == "ATM & Card"
    assert family_for("wire_domestic_outgoing") == "Wire Transfers"
    assert family_for("late_payment") == "Lending Fees"


def test_family_for_returns_none_off_taxonomy() -> None:
    assert family_for("not_a_real_category") is None


def test_taxonomy_is_immutable() -> None:
    # Sanity: the tuple cannot be mutated and the mapping view rejects writes.
    import pytest
    with pytest.raises(TypeError):
        CATEGORY_FAMILY["new_category"] = "Misc"  # type: ignore[index]
