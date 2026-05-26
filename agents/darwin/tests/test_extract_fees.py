"""Tests for multi-fee extraction (`extract_fees`) and the multi-fee row processor.

Coverage:
- Empty array (no fees in doc) -> ExtractionResult.fees == []
- Single fee preserved
- Multi-fee with one off-taxonomy entry -> off-taxonomy silently dropped
- Multi-fee with one low-confidence -> marked pending; auto-promote still works
- Multi-fee with a price change -> superseded_by set on the prior live row
- Cost accounting: per-doc cost_cents tracked and rolled into outcome
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest

from darwin.agent import _process_row
from darwin.classifier import (
    AUTO_PROMOTE_CONFIDENCE,
    ExtractionResult,
    Classification,
    extract_fees,
)


@dataclass
class _Block:
    type: str
    text: str


class _Usage:
    def __init__(self, input_tokens: int = 1000, output_tokens: int = 500) -> None:
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


class _FakeResponse:
    def __init__(self, text: str, *, input_tokens: int = 1000, output_tokens: int = 500) -> None:
        self.content = [_Block(type="text", text=text)]
        self.usage = _Usage(input_tokens=input_tokens, output_tokens=output_tokens)


def _client(json_text: str, **kwargs) -> MagicMock:
    client = MagicMock()
    client.messages.create.return_value = _FakeResponse(json_text, **kwargs)
    return client


# --- extract_fees parser --------------------------------------------------


def test_extract_fees_empty_array() -> None:
    client = _client('{"fees": [], "notes": "no fee schedule detected"}')
    result = extract_fees("404 not found", client=client)
    assert result.fees == []
    assert result.notes == "no fee schedule detected"
    assert result.stub is False


def test_extract_fees_single_fee() -> None:
    client = _client(
        '{"fees": [{"fee_category": "monthly_maintenance", '
        '"fee_name": "Monthly Service Fee", "amount": 12.0, '
        '"frequency": "per_month", "conditions": "Waived with $1500 balance", '
        '"confidence": 0.95, "evidence_quote": "Monthly Service Charge $12.00"}]}'
    )
    result = extract_fees("fake doc", client=client)
    assert len(result.fees) == 1
    fee = result.fees[0]
    assert fee.fee_category == "monthly_maintenance"
    assert fee.amount == 12.0
    assert fee.auto_promote is True
    assert fee.evidence_quote == "Monthly Service Charge $12.00"


def test_extract_fees_drops_off_taxonomy_entries() -> None:
    client = _client(
        '{"fees": ['
        '{"fee_category": "overdraft", "amount": 30.0, "confidence": 0.95, '
        '"evidence_quote": "Overdraft fee $30"},'
        '{"fee_category": "made_up_category", "amount": 10.0, "confidence": 0.99, '
        '"evidence_quote": "x"}'
        ']}'
    )
    result = extract_fees("doc", client=client)
    assert len(result.fees) == 1
    assert result.fees[0].fee_category == "overdraft"


def test_extract_fees_mixes_confidences() -> None:
    client = _client(
        '{"fees": ['
        '{"fee_category": "overdraft", "amount": 30.0, "confidence": 0.95, '
        '"evidence_quote": "OD $30"},'
        '{"fee_category": "nsf", "amount": 35.0, "confidence": 0.60, '
        '"evidence_quote": "NSF $35 (estimated)"}'
        ']}'
    )
    result = extract_fees("doc", client=client)
    assert len(result.fees) == 2
    by_cat = {f.fee_category: f for f in result.fees}
    assert by_cat["overdraft"].auto_promote is True
    assert by_cat["nsf"].auto_promote is False


def test_extract_fees_strips_markdown_fences() -> None:
    client = _client(
        '```json\n{"fees": [{"fee_category": "nsf", "amount": 35.0, '
        '"confidence": 0.92, "evidence_quote": "NSF $35"}]}\n```'
    )
    result = extract_fees("doc", client=client)
    assert len(result.fees) == 1
    assert result.fees[0].fee_category == "nsf"


def test_extract_fees_handles_garbage_response() -> None:
    client = _client("the model wrote prose")
    result = extract_fees("doc", client=client)
    assert result.fees == []
    assert "extract_error" in (result.notes or "")


def test_extract_fees_tracks_cost_cents() -> None:
    # 100k input tokens + 10k output tokens at haiku pricing:
    # input  = 100_000 * 0.0001 = 10.0 cents
    # output = 10_000 * 0.0005  =  5.0 cents
    # total  = 15 cents (rounded up to next whole cent => 16 because of the
    # round-up-on-fractional rule we use to avoid undercounting)
    client = _client(
        '{"fees": []}',
        input_tokens=100_000,
        output_tokens=10_000,
    )
    result = extract_fees("doc", client=client)
    assert result.cost_cents >= 15


def test_extract_fees_stub_mode_when_no_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    result = extract_fees("Monthly maintenance fee $12.00")
    assert result.stub is True
    # Stub yields 0 or 1 fee depending on keyword hits.
    assert len(result.fees) <= 1


# --- _process_row (multi-fee, DB-mocked) ---------------------------------


class _FakeCursor:
    """Minimal cursor that records executed statements and returns canned rows.

    Behavior:
    - Tracks every (sql, params) pair so tests can assert on writes.
    - Maintains an in-memory `fees_verified` list keyed by id.
    - Returns appropriate rows for the three queries _process_row issues:
        SELECT id, amount FROM fees_verified WHERE ...   (live row lookup)
        INSERT INTO fees_verified ... RETURNING id        (new row)
        UPDATE fees_verified SET superseded_by ...        (supersession)
        INSERT INTO agent_events ...                      (events)
    """

    def __init__(self, store: dict) -> None:
        self._store = store
        self._last_returning: int | None = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    @property
    def description(self):
        return self._store.get("_next_description")

    def fetchall(self):
        rows = self._store.get("_next_fetchall") or []
        self._store["_next_fetchall"] = None
        self._store["_next_description"] = None
        return rows

    def execute(self, sql: str, params: tuple | None = None) -> None:
        params = params or ()
        sql_lc = " ".join(sql.split()).lower()
        self._store["statements"].append((sql_lc, params))

        if "select id, amount, confidence, created_at from fees_verified" in sql_lc:
            # Cross-doc dedup query. Default: no competitors.
            self._store["_next_description"] = [
                ("id",), ("amount",), ("confidence",), ("created_at",)
            ]
            self._store["_next_fetchall"] = self._store.get("_cross_doc_rows", [])
            return
        if "select id, amount from fees_verified" in sql_lc:
            inst_id, key = params[0], params[1]
            live = self._store["live"].get((inst_id, key))
            self._store["_next_fetchone"] = live  # tuple (id, amount) or None
        elif sql_lc.startswith("insert into fees_verified"):
            self._store["_id_counter"] += 1
            new_id = self._store["_id_counter"]
            self._store["fees_verified"][new_id] = {
                "fees_raw_id": params[0],
                "institution_id": params[1],
                "fee_category": params[2],
                "amount": params[5],
                "review_status": params[11],
                "superseded_by": None,
            }
            # Track as new live row.
            self._store["live"][(params[1], params[9])] = (new_id, params[5])
            self._store["_next_fetchone"] = (new_id,)
        elif sql_lc.startswith("update fees_verified set superseded_by"):
            new_id, old_id = params[0], params[1]
            row = self._store["fees_verified"].get(old_id)
            if row:
                row["superseded_by"] = new_id
            self._store["supersessions"].append((old_id, new_id))
        elif sql_lc.startswith("insert into agent_events"):
            self._store["events"].append(params)

    def fetchone(self):
        val = self._store.get("_next_fetchone")
        self._store["_next_fetchone"] = None
        return val


class _FakeConn:
    def __init__(self) -> None:
        self.store = {
            "statements": [],
            "fees_verified": {},
            "live": {},  # (institution_id, canonical_key) -> (id, amount)
            "supersessions": [],
            "events": [],
            "_id_counter": 0,
            "_next_fetchone": None,
        }
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return _FakeCursor(self.store)

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


# Raw text used by _process_row tests. Includes evidence_quote substrings
# (`<category> $<amount>`) that the per-fee evidence verifier looks for so the
# test fees can auto-approve under the new evidence-in-source guardrail.
_RAW_TEXT_WITH_EVIDENCE = (
    "monthly_maintenance $12.0 "
    "monthly_maintenance $8.0 "
    "overdraft $30.0 overdraft $35.0 "
    "nsf $35.0"
)


def _multi_fee_extractor(fees: list[Classification], cost_cents: int = 12):
    """Build a fake extractor returning the given Classifications."""

    def _fake(raw_text, *, raw_payload=None):
        return ExtractionResult(
            fees=list(fees),
            notes="test",
            cost_cents=cost_cents,
            stub=False,
            raw_response="{}",
        )

    return _fake


def _fee(category: str, amount: float, confidence: float = 0.95) -> Classification:
    return Classification(
        fee_category=category,
        amount=amount,
        frequency="per_event",
        conditions=None,
        confidence=confidence,
        fee_name=category.replace("_", " ").title(),
        off_taxonomy=False,
        stub=False,
        evidence_quote=f"{category} ${amount}",
    )


def test_process_row_empty_doc_records_skipped_event() -> None:
    conn = _FakeConn()
    extractor = _multi_fee_extractor([], cost_cents=3)
    outcome = _process_row(
        conn,
        {"fees_raw_id": 1, "institution_id": 100, "raw_text": _RAW_TEXT_WITH_EVIDENCE, "raw_payload": None},
        run_id=uuid.uuid4(),
        extractor=extractor,
        use_db=True,
    )
    assert outcome.status == "empty"
    assert outcome.fees_extracted == 0
    assert outcome.cost_cents == 3
    assert conn.store["fees_verified"] == {}
    assert len(conn.store["events"]) == 1
    assert conn.store["events"][0][1] == "skipped"


def test_process_row_inserts_one_row_per_fee() -> None:
    conn = _FakeConn()
    extractor = _multi_fee_extractor([
        _fee("monthly_maintenance", 12.0, 0.95),
        _fee("overdraft", 30.0, 0.93),
        _fee("nsf", 35.0, 0.91),
    ])
    outcome = _process_row(
        conn,
        {"fees_raw_id": 5, "institution_id": 200, "raw_text": _RAW_TEXT_WITH_EVIDENCE, "raw_payload": None},
        run_id=uuid.uuid4(),
        extractor=extractor,
        use_db=True,
    )
    assert outcome.fees_extracted == 3
    assert outcome.fees_auto_approved == 3
    assert outcome.fees_pending == 0
    assert len(conn.store["fees_verified"]) == 3
    # All three should land in fees_verified with auto_approved review_status.
    statuses = [row["review_status"] for row in conn.store["fees_verified"].values()]
    assert statuses == ["auto_approved", "auto_approved", "auto_approved"]


def test_process_row_low_confidence_fees_marked_pending() -> None:
    conn = _FakeConn()
    extractor = _multi_fee_extractor([
        _fee("overdraft", 30.0, 0.95),  # auto
        _fee("nsf", 35.0, 0.60),        # pending
    ])
    outcome = _process_row(
        conn,
        {"fees_raw_id": 7, "institution_id": 201, "raw_text": _RAW_TEXT_WITH_EVIDENCE, "raw_payload": None},
        run_id=uuid.uuid4(),
        extractor=extractor,
        use_db=True,
    )
    assert outcome.fees_extracted == 2
    assert outcome.fees_auto_approved == 1
    assert outcome.fees_pending == 1
    by_cat = {
        row["fee_category"]: row["review_status"]
        for row in conn.store["fees_verified"].values()
    }
    assert by_cat["overdraft"] == "auto_approved"
    assert by_cat["nsf"] == "pending"


def test_process_row_handles_price_change_via_supersede() -> None:
    conn = _FakeConn()
    # Seed an existing live row: institution 300, overdraft at $30.
    conn.store["_id_counter"] = 99
    conn.store["fees_verified"][99] = {
        "fees_raw_id": 0,
        "institution_id": 300,
        "fee_category": "overdraft",
        "amount": 30.0,
        "review_status": "auto_approved",
        "superseded_by": None,
    }
    conn.store["live"][(300, "overdraft")] = (99, 30.0)

    extractor = _multi_fee_extractor([_fee("overdraft", 35.0, 0.95)])
    outcome = _process_row(
        conn,
        {"fees_raw_id": 10, "institution_id": 300, "raw_text": _RAW_TEXT_WITH_EVIDENCE, "raw_payload": None},
        run_id=uuid.uuid4(),
        extractor=extractor,
        use_db=True,
    )
    assert outcome.fees_extracted == 1
    assert outcome.fees_superseded == 1
    # The old row (id=99) should have superseded_by set to the newly inserted id.
    assert conn.store["fees_verified"][99]["superseded_by"] is not None
    assert (99, conn.store["fees_verified"][99]["superseded_by"]) in conn.store["supersessions"]


def test_process_row_deduplicates_same_category_keeps_highest_confidence() -> None:
    """Claude sometimes emits a category twice (tier variants). We collapse
    to the highest-confidence one so the unique constraint on
    (institution_id, canonical_fee_key) isn't violated."""
    conn = _FakeConn()
    extractor = _multi_fee_extractor([
        _fee("monthly_maintenance", 8.0, 0.60),
        _fee("monthly_maintenance", 12.0, 0.95),  # higher conf -- keeps
    ])
    outcome = _process_row(
        conn,
        {"fees_raw_id": 12, "institution_id": 400, "raw_text": _RAW_TEXT_WITH_EVIDENCE, "raw_payload": None},
        run_id=uuid.uuid4(),
        extractor=extractor,
        use_db=True,
    )
    assert outcome.fees_extracted == 1
    inserted = list(conn.store["fees_verified"].values())[0]
    assert inserted["amount"] == 12.0
    assert inserted["review_status"] == "auto_approved"


def test_process_row_cost_cents_propagates_to_outcome() -> None:
    conn = _FakeConn()
    extractor = _multi_fee_extractor([_fee("overdraft", 30.0)], cost_cents=42)
    outcome = _process_row(
        conn,
        {"fees_raw_id": 15, "institution_id": 500, "raw_text": _RAW_TEXT_WITH_EVIDENCE, "raw_payload": None},
        run_id=uuid.uuid4(),
        extractor=extractor,
        use_db=True,
    )
    assert outcome.cost_cents == 42
