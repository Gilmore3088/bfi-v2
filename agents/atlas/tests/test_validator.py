"""Unit tests for agents.atlas.validator."""

from __future__ import annotations

from agents.atlas.validator import (
    HTML_SIZE_THRESHOLD,
    PDF_SIZE_THRESHOLD,
    validate_text,
)


def _pad(text: str, length: int) -> str:
    """Pad text with neutral filler so total length >= length chars."""
    if len(text) >= length:
        return text
    filler = " bank account terms and conditions apply.\n"
    while len(text) < length:
        text += filler
    return text


def _real_fee_schedule_text() -> str:
    body = (
        "SCHEDULE OF FEES AND DISCLOSURES\n"
        "Monthly maintenance fee: $12.00 per month.\n"
        "Overdraft fee: $35.00 per item.\n"
        "NSF fee: $35.00 per returned item.\n"
        "ATM fee at non-network machines: $3.00 per withdrawal.\n"
        "Wire transfer (domestic outgoing): $25.00 per transfer.\n"
        "Stop payment: $30.00 per request.\n"
        "Minimum balance to avoid the monthly service fee: $1,500.\n"
    )
    return _pad(body, HTML_SIZE_THRESHOLD + 200)


def test_real_fee_schedule_is_valid_with_high_score():
    text = _real_fee_schedule_text()
    result = validate_text(text, content_type="text/html")
    assert result.is_fee_schedule is True
    assert result.reason == "ok"
    assert result.score > 0.7


def test_soft_404_with_short_body_is_rejected():
    text = (
        "Page not found. We can't find the page you requested. "
        "Please return to the homepage. $0.00 was charged. "
        "This is our generic error template — fee schedule disclosure overdraft."
    )
    text = _pad(text, HTML_SIZE_THRESHOLD + 100)
    # Trim back below the 4000-char soft-404 ceiling.
    text = text[:3500]
    result = validate_text(text, content_type="text/html")
    assert result.is_fee_schedule is False
    assert result.reason == "soft_404"


def test_marketing_page_without_dollar_signs_is_rejected():
    text = _pad(
        "Welcome to Our Community Bank. We pride ourselves on service, "
        "low monthly fees, and friendly tellers. Visit a branch today!",
        HTML_SIZE_THRESHOLD + 200,
    )
    # Strip any stray dollar signs to be safe.
    text = text.replace("$", "").replace("¢", "")
    result = validate_text(text, content_type="text/html")
    assert result.is_fee_schedule is False
    assert result.reason == "no_dollar_signs"


def test_short_pdf_with_fees_is_valid_under_pdf_leniency():
    body = (
        "FEE SCHEDULE\n"
        "Monthly service fee: $5.00\n"
        "Overdraft fee: $30.00\n"
        "NSF fee: $30.00\n"
        "Wire transfer: $20.00\n"
        "Stop payment: $25.00\n"
    )
    text = _pad(body, 900)
    assert len(text) < HTML_SIZE_THRESHOLD  # would fail HTML threshold
    assert len(text) >= PDF_SIZE_THRESHOLD
    result = validate_text(text, content_type="application/pdf")
    assert result.is_fee_schedule is True
    assert result.reason == "ok"


def test_marketing_page_with_one_fee_mention_is_rejected_for_keywords():
    text = _pad(
        "Welcome! Open an account today. We have low fees. "
        "Earn $200 when you sign up. Limited time offer. Stop by today.",
        HTML_SIZE_THRESHOLD + 200,
    )
    result = validate_text(text, content_type="text/html")
    assert result.is_fee_schedule is False
    assert result.reason == "no_fee_keywords"


def test_empty_text_is_rejected_as_too_small():
    result = validate_text("", content_type="text/html")
    assert result.is_fee_schedule is False
    assert result.reason == "too_small"
    assert result.score == 0.0


def test_none_text_is_rejected_as_too_small():
    result = validate_text(None, content_type="text/html")
    assert result.is_fee_schedule is False
    assert result.reason == "too_small"


def test_long_fee_schedule_with_various_currency_symbols_is_valid():
    body = (
        "FEE SCHEDULE AND DISCLOSURE\n"
        "Monthly maintenance: $10.00 USD\n"
        "Overdraft fee: $35.00 per occurrence\n"
        "NSF: $35.00 per item\n"
        "Coin counting: 5¢ per coin for non-customers\n"
        "Wire transfer domestic: $25.00\n"
        "Wire transfer international: $50.00\n"
        "Stop payment: $30.00\n"
        "Minimum balance to avoid fee: $1,500.00\n"
        "ATM withdrawal at non-network ATM: $3.00\n"
    )
    text = _pad(body, HTML_SIZE_THRESHOLD * 3)
    result = validate_text(text, content_type="text/html")
    assert result.is_fee_schedule is True
    assert result.reason == "ok"
    assert result.score == 1.0


def test_soft_404_marker_in_very_long_body_passes_through():
    # Long bodies that mention "redirected" in passing should not be flagged
    # as soft-404 (since the marker check requires length < 4000).
    body = (
        "FEE SCHEDULE\n"
        "Monthly fee: $10.00\n"
        "Overdraft: $35.00\n"
        "NSF: $35.00\n"
        "Note: outgoing wire transfers may be redirected through correspondent banks. "
        "Wire transfer: $25.00\n"
        "Stop payment: $30.00\n"
    )
    text = _pad(body, 5000)
    result = validate_text(text, content_type="text/html")
    assert result.is_fee_schedule is True
    assert result.reason == "ok"
