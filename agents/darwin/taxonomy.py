"""Canonical fee taxonomy for Darwin classification.

The frozen 49-category whitelist (9 families) ported from v1
`fee_crawler/fee_amount_rules.py` and `src/lib/fee-taxonomy.ts`. Darwin
classifications MUST land in this set; off-taxonomy predictions are flagged
for human review.

Performance + correctness: the whitelist is a frozen tuple here in code, not
pulled from the DB at runtime. The `taxonomy` table in Postgres is for the
UI/reference data; the agent's source of truth is this module.

Sync rule: if you add a category here, also add it to the `taxonomy` table
seed and to `src/lib/taxonomy.ts`. The data-analyst audit (2026-05-25) found
91 distinct categories in production vs the intended 49 -- drift that this
whitelist is designed to prevent.
"""

from __future__ import annotations

from types import MappingProxyType


# Order mirrors v1 FEE_FAMILIES (top to bottom). DO NOT reorder casually --
# downstream presentation layers may key off the position for display.
_FAMILIES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Account Maintenance", (
        "monthly_maintenance",
        "minimum_balance",
        "early_closure",
        "dormant_account",
        "account_research",
        "paper_statement",
        "estatement_fee",
    )),
    ("Overdraft & NSF", (
        "overdraft",
        "nsf",
        "continuous_od",
        "od_protection_transfer",
        "od_line_of_credit",
        "od_daily_cap",
        "nsf_daily_cap",
    )),
    ("ATM & Card", (
        "atm_non_network",
        "atm_international",
        "card_replacement",
        "rush_card",
        "card_foreign_txn",
        "card_dispute",
    )),
    ("Wire Transfers", (
        "wire_domestic_outgoing",
        "wire_domestic_incoming",
        "wire_intl_outgoing",
        "wire_intl_incoming",
    )),
    ("Check Services", (
        "cashiers_check",
        "money_order",
        "check_printing",
        "stop_payment",
        "counter_check",
        "check_cashing",
        "check_image",
    )),
    ("Digital & Electronic", (
        "ach_origination",
        "ach_return",
        "bill_pay",
        "mobile_deposit",
        "zelle_fee",
    )),
    ("Cash & Deposit", (
        "coin_counting",
        "cash_advance",
        "deposited_item_return",
        "night_deposit",
    )),
    ("Account Services", (
        "notary_fee",
        "safe_deposit_box",
        "garnishment_levy",
        "legal_process",
        "account_verification",
        "balance_inquiry",
    )),
    ("Lending Fees", (
        "late_payment",
        "loan_origination",
        "appraisal_fee",
    )),
)


# Flat whitelist tuple of the 49 canonical categories.
CANONICAL_CATEGORIES: tuple[str, ...] = tuple(
    cat for _family, cats in _FAMILIES for cat in cats
)

# Reverse map: category -> family. Immutable view.
CATEGORY_FAMILY: MappingProxyType = MappingProxyType({
    cat: family for family, cats in _FAMILIES for cat in cats
})

# Family list in canonical order.
FAMILIES: tuple[str, ...] = tuple(family for family, _ in _FAMILIES)


def is_canonical(category: str | None) -> bool:
    """True if `category` is one of the 49 whitelisted categories."""
    if not category:
        return False
    return category in CATEGORY_FAMILY


def family_for(category: str) -> str | None:
    """Return the family name for a category, or None if off-taxonomy."""
    return CATEGORY_FAMILY.get(category)


# Hard invariant: exactly 49 categories across exactly 9 families. The
# Technical Architect brief and SPEC.md both lock this shape.
assert len(CANONICAL_CATEGORIES) == 49, (
    f"taxonomy invariant violated: expected 49 categories, got {len(CANONICAL_CATEGORIES)}"
)
assert len(FAMILIES) == 9, (
    f"taxonomy invariant violated: expected 9 families, got {len(FAMILIES)}"
)
