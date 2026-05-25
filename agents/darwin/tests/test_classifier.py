"""Tests for the Darwin classifier and price-change-history pattern."""

from __future__ import annotations

import os
from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest

from darwin.agent import _amounts_differ
from darwin.classifier import (
    AUTO_PROMOTE_CONFIDENCE,
    Classification,
    classify,
)


@dataclass
class _Block:
    type: str
    text: str


class _FakeResponse:
    """Mimics anthropic.types.Message just enough for our parser."""

    def __init__(self, text: str) -> None:
        self.content = [_Block(type="text", text=text)]


# --- Stub-mode tests ------------------------------------------------------


def test_stub_mode_when_no_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = classify("Monthly service charge $12.00")
    assert result.stub is True
    assert result.confidence == 0.50
    # Below auto-promote threshold by design.
    assert not result.auto_promote


def test_stub_routes_known_keywords(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert classify("NSF return item fee $35").fee_category == "nsf"
    assert classify("Overdraft item fee $30").fee_category == "overdraft"
    assert classify("Monthly maintenance fee $15").fee_category == "monthly_maintenance"
    assert classify("Wire transfer outgoing $25").fee_category == "wire_domestic_outgoing"
    assert classify("Foreign transaction fee 3%").fee_category == "card_foreign_txn"


def test_stub_extracts_amount_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = classify("Stop payment fee $32.00")
    assert result.amount == 32.0
    assert result.fee_category == "stop_payment"


def test_stub_falls_back_to_overdraft(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = classify("Something totally unrecognizable")
    assert result.fee_category == "overdraft"
    assert result.stub is True


# --- Mocked-live-mode tests ----------------------------------------------


def _mock_client(json_text: str) -> MagicMock:
    client = MagicMock()
    client.messages.create.return_value = _FakeResponse(json_text)
    return client


def test_classify_parses_clean_json() -> None:
    client = _mock_client(
        '{"fee_category": "monthly_maintenance", "amount": 12.0, '
        '"frequency": "per_month", "conditions": "Waived with $1500 balance", '
        '"confidence": 0.95, "fee_name": "Monthly Service Charge"}'
    )
    result = classify("Monthly service charge", client=client)
    assert result.fee_category == "monthly_maintenance"
    assert result.amount == 12.0
    assert result.frequency == "per_month"
    assert result.confidence == 0.95
    assert result.off_taxonomy is False
    assert result.stub is False
    assert result.auto_promote is True


def test_classify_strips_markdown_fences() -> None:
    client = _mock_client(
        '```json\n{"fee_category": "nsf", "amount": 35.0, '
        '"frequency": "per_item", "conditions": null, "confidence": 0.92}\n```'
    )
    result = classify("NSF fee $35", client=client)
    assert result.fee_category == "nsf"
    assert result.amount == 35.0
    assert result.auto_promote is True


def test_classify_flags_off_taxonomy_predictions() -> None:
    client = _mock_client(
        '{"fee_category": "monthly_maintenance_charge", "amount": 10.0, '
        '"frequency": "per_month", "conditions": null, "confidence": 0.97}'
    )
    result = classify("...", client=client)
    assert result.off_taxonomy is True
    # Even at 0.97 confidence, off-taxonomy MUST NOT auto-promote.
    assert result.auto_promote is False


def test_classify_clamps_confidence_to_unit_interval() -> None:
    client = _mock_client(
        '{"fee_category": "overdraft", "amount": 30.0, '
        '"frequency": "per_item", "conditions": null, "confidence": 1.5}'
    )
    result = classify("...", client=client)
    assert result.confidence == 1.0


def test_classify_handles_garbage_response_without_raising() -> None:
    client = _mock_client("the model went off the rails and wrote prose")
    result = classify("...", client=client)
    # Defensive fallback: low confidence, off-taxonomy, no insertion possible.
    assert result.confidence == 0.0
    assert result.off_taxonomy is True


def test_auto_promote_threshold_is_inclusive() -> None:
    just_above = Classification(
        fee_category="overdraft", amount=30.0, frequency="per_item",
        conditions=None, confidence=AUTO_PROMOTE_CONFIDENCE, off_taxonomy=False,
    )
    just_below = Classification(
        fee_category="overdraft", amount=30.0, frequency="per_item",
        conditions=None, confidence=AUTO_PROMOTE_CONFIDENCE - 0.001,
        off_taxonomy=False,
    )
    assert just_above.auto_promote is True
    assert just_below.auto_promote is False


# --- Price-change-history -------------------------------------------------


def test_amounts_differ_detects_real_price_change() -> None:
    assert _amounts_differ(30.0, 35.0) is True
    assert _amounts_differ(12.00, 15.00) is True


def test_amounts_differ_ignores_subcent_jitter() -> None:
    assert _amounts_differ(30.00, 30.001) is False
    assert _amounts_differ(30.00, 30.00) is False


def test_amounts_differ_treats_one_sided_none_as_change() -> None:
    assert _amounts_differ(None, 30.0) is True
    assert _amounts_differ(30.0, None) is True


def test_amounts_differ_treats_both_none_as_no_change() -> None:
    assert _amounts_differ(None, None) is False


def test_amounts_differ_handles_decimal_like_inputs() -> None:
    # psycopg2 returns NUMERIC as Decimal -- we coerce to float.
    from decimal import Decimal
    assert _amounts_differ(Decimal("30.00"), 30.0) is False
    assert _amounts_differ(Decimal("30.00"), 35.0) is True
