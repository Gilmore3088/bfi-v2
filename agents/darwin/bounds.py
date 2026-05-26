"""Per-category amount sanity bounds for Darwin fee classifications.

Hand-curated [floor, ceiling] tuples per canonical category, based on
industry data (Bankrate, NerdWallet surveys, Federal Reserve studies).
A fee whose amount falls outside its category bounds is forced into
human review even if Claude returned a high confidence score -- the
amount is implausible enough that we want eyes on it.

Categories not listed fall back to a generous (0, 1000) default.
"""

from __future__ import annotations


# Format: category -> (floor_inclusive, ceiling_inclusive) in USD.
BOUNDS: dict[str, tuple[float, float]] = {
    # Account Maintenance
    "monthly_maintenance": (3.0, 35.0),
    "minimum_balance": (3.0, 35.0),
    "early_closure": (10.0, 50.0),
    "dormant_account": (3.0, 25.0),
    "account_research": (10.0, 75.0),
    "paper_statement": (1.0, 10.0),
    "estatement_fee": (0.0, 5.0),

    # Overdraft & NSF
    "overdraft": (15.0, 50.0),
    "nsf": (15.0, 45.0),
    "continuous_od": (3.0, 50.0),
    "od_protection_transfer": (0.0, 15.0),
    "od_line_of_credit": (0.0, 25.0),
    "od_daily_cap": (50.0, 250.0),
    "nsf_daily_cap": (50.0, 250.0),

    # ATM & Card
    "atm_non_network": (1.50, 6.00),
    "atm_international": (1.00, 7.00),
    "card_replacement": (0.0, 25.0),
    "rush_card": (10.0, 50.0),
    "card_foreign_txn": (0.0, 5.0),  # often a percentage; flat-dollar bound only
    "card_dispute": (0.0, 35.0),

    # Wire Transfers
    "wire_domestic_outgoing": (15.0, 50.0),
    "wire_domestic_incoming": (0.0, 25.0),
    "wire_intl_outgoing": (25.0, 100.0),
    "wire_intl_incoming": (0.0, 35.0),

    # Check Services
    "cashiers_check": (3.0, 15.0),
    "money_order": (1.0, 10.0),
    "check_printing": (10.0, 50.0),
    "stop_payment": (15.0, 45.0),
    "counter_check": (1.0, 10.0),
    "check_cashing": (3.0, 25.0),
    "check_image": (0.0, 10.0),

    # Digital & Electronic
    "ach_origination": (0.0, 5.0),
    "ach_return": (3.0, 30.0),
    "bill_pay": (0.0, 15.0),
    "mobile_deposit": (0.0, 5.0),
    "zelle_fee": (0.0, 5.0),

    # Cash & Deposit
    "coin_counting": (0.0, 10.0),
    "cash_advance": (0.0, 15.0),
    "deposited_item_return": (5.0, 30.0),
    "night_deposit": (0.0, 25.0),

    # Account Services
    "notary_fee": (0.0, 25.0),
    "safe_deposit_box": (15.0, 500.0),
    "garnishment_levy": (50.0, 150.0),
    "legal_process": (25.0, 150.0),
    "account_verification": (5.0, 30.0),
    "balance_inquiry": (0.0, 5.0),

    # Lending Fees
    "late_payment": (10.0, 50.0),
    "loan_origination": (50.0, 1500.0),
    "appraisal_fee": (100.0, 1000.0),
}


_DEFAULT_BOUNDS: tuple[float, float] = (0.0, 1000.0)


def check_amount(category: str, amount: float | None) -> tuple[bool, str | None]:
    """Returns ``(in_bounds, reason_if_not)``.

    - Null amounts are out of bounds ("null amount").
    - Non-positive amounts are out of bounds ("non-positive amount").
    - Categories without explicit bounds use the (0, 1000) default.
    """
    if amount is None:
        return False, "null amount"
    try:
        a = float(amount)
    except (TypeError, ValueError):
        return False, "non-numeric amount"
    if a <= 0:
        return False, "non-positive amount"
    floor, ceiling = BOUNDS.get(category, _DEFAULT_BOUNDS)
    if a < floor:
        return False, f"below typical floor ${floor:.2f}"
    if a > ceiling:
        return False, f"above typical ceiling ${ceiling:.2f}"
    return True, None
