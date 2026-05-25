"""Darwin classifier: calls Claude (haiku) to classify a raw fee snippet.

Public API:
    classify(raw_text, *, raw_payload=None, client=None) -> Classification

In stub mode (no ANTHROPIC_API_KEY), returns a deterministic fake
classification so the rest of the pipeline can be exercised end-to-end
without burning quota.

Prompt design: one tight system prompt + a JSON-only response. We instruct
Claude to pick `fee_category` strictly from the 49-category whitelist; we
also re-validate post-hoc and flag any off-list category as off-taxonomy
even if Claude returned it.
"""

from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Any

from .taxonomy import CANONICAL_CATEGORIES, family_for, is_canonical


logger = logging.getLogger(__name__)


# Claude model and parameters. Haiku is the cost-efficient classifier per
# v1 fee_crawler config.yaml.
CLAUDE_MODEL = "claude-haiku-4-5-20251001"
CLAUDE_MAX_TOKENS = 512
CLAUDE_TEMPERATURE = 0.0  # Deterministic classification.


# Auto-promotion threshold (TA brief section 3, Darwin contract).
AUTO_PROMOTE_CONFIDENCE = 0.90


@dataclass
class Classification:
    """A single Darwin classification result.

    `off_taxonomy` is True when the LLM picked something outside the
    whitelist; the caller should route those rows differently (flag for
    human review, do NOT auto-promote).
    """

    fee_category: str
    amount: float | None
    frequency: str | None
    conditions: str | None
    confidence: float
    fee_name: str | None = None
    off_taxonomy: bool = False
    stub: bool = False
    raw_response: str | None = None
    evidence_quote: str | None = None

    @property
    def family(self) -> str | None:
        return family_for(self.fee_category)

    @property
    def auto_promote(self) -> bool:
        """True only when in-taxonomy AND confidence is at or above threshold."""
        return (not self.off_taxonomy) and self.confidence >= AUTO_PROMOTE_CONFIDENCE


@dataclass
class ExtractionResult:
    """Result of multi-fee extraction from a single fees_raw document.

    `fees` contains zero or more Classification objects (one per fee found).
    Off-taxonomy fees are filtered out at parse time so the caller only ever
    sees whitelisted categories.

    `cost_cents` is the rounded-up integer cost of the Claude call (input +
    output tokens at haiku pricing). 0 in stub mode.
    """

    fees: list[Classification]
    notes: str | None = None
    cost_cents: int = 0
    stub: bool = False
    raw_response: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0


# --- Prompt ---------------------------------------------------------------

_SYSTEM_PROMPT = """You are Darwin, a bank-fee classifier. You read a short
snippet of fee-schedule text and emit a single JSON object describing one fee.

Rules:
- Pick `fee_category` STRICTLY from the allowed list below. If nothing matches
  well, return the closest one and set `confidence` below 0.50 -- do NOT
  invent new categories.
- `amount` is a number in USD. If the fee is a range, pick the headline value.
  Use null if the snippet is ambiguous or non-numeric.
- `frequency` is one of: "per_item", "per_month", "per_year", "per_occurrence",
  "one_time", "per_transaction", or null.
- `conditions` is free-form text describing waivers/tiers/limits, or null.
- `confidence` is a float in [0, 1] reflecting how sure you are about
  `fee_category` and `amount`.
- Never infer NSF from overdraft or vice versa. They are distinct.

Output JSON only. No prose. No markdown fences.

Allowed fee_category values (49):
{categories}
"""


def _build_system_prompt() -> str:
    return _SYSTEM_PROMPT.format(
        categories=", ".join(CANONICAL_CATEGORIES),
    )


def _build_user_prompt(raw_text: str, raw_payload: dict[str, Any] | None) -> str:
    parts = ["Fee snippet:", raw_text.strip()[:2000]]
    if raw_payload:
        # Include the structured payload too -- often more useful than the
        # raw HTML/PDF text alone.
        payload_str = json.dumps(raw_payload, default=str)[:2000]
        parts.extend(["", "Structured payload (if any):", payload_str])
    parts.append("")
    parts.append("Respond with JSON only:")
    parts.append(
        '{"fee_category": "...", "amount": 0.0, "frequency": "...", '
        '"conditions": "...", "confidence": 0.0, "fee_name": "..."}'
    )
    return "\n".join(parts)


# --- Stub mode ------------------------------------------------------------

# Crude keyword routing for the stub. Order matters -- longer / more-specific
# patterns first. Short tokens like "nsf" use word-boundary matching to avoid
# false hits inside other words (e.g. "tra-nsf-er").
_STUB_KEYWORD_MAP: tuple[tuple[str, str], ...] = (
    ("non-sufficient", "nsf"),
    ("monthly maintenance", "monthly_maintenance"),
    ("monthly service", "monthly_maintenance"),
    ("foreign transaction", "card_foreign_txn"),
    ("safe deposit", "safe_deposit_box"),
    ("stop payment", "stop_payment"),
    ("money order", "money_order"),
    ("cashier", "cashiers_check"),
    ("wire", "wire_domestic_outgoing"),
    ("overdraft", "overdraft"),
    ("nsf", "nsf"),
    ("atm", "atm_non_network"),
)


def _stub_classify(raw_text: str) -> Classification:
    """Deterministic stub classification (no API key required).

    Returns a low-confidence (0.50) classification keyed off simple keyword
    matches. Short tokens are matched on word boundaries to prevent
    substrings like "nsf" inside "transfer" from triggering NSF. Falls back
    to `overdraft` if nothing matches so the drain still flows.
    """
    text = (raw_text or "").lower()
    # Padded variant for word-boundary checks of short tokens.
    padded = f" {text} "
    category = "overdraft"
    for needle, cat in _STUB_KEYWORD_MAP:
        if len(needle) <= 4:
            # Short tokens: require leading whitespace to anchor at a word start.
            if f" {needle}" in padded:
                category = cat
                break
        elif needle in text:
            category = cat
            break

    amount_match = re.search(r"\$?\s*(\d{1,4}(?:\.\d{1,2})?)", text)
    amount = float(amount_match.group(1)) if amount_match else None

    logger.info("STUB: would call Claude (category=%s, amount=%s)", category, amount)
    return Classification(
        fee_category=category,
        amount=amount,
        frequency=None,
        conditions=None,
        confidence=0.50,
        fee_name=None,
        off_taxonomy=False,
        stub=True,
    )


# --- Live Claude path -----------------------------------------------------


def _load_anthropic() -> Any | None:
    """Lazy-load anthropic SDK; return None if unavailable."""
    try:
        import anthropic  # type: ignore
        return anthropic
    except ImportError:
        logger.warning("darwin: anthropic SDK not installed; staying in stub mode")
        return None


def _parse_response(raw: str) -> dict[str, Any]:
    """Extract the JSON object from Claude's response.

    Defensive: strips markdown fences if present, finds the first '{'.
    Raises ValueError on completely unparseable text.
    """
    text = raw.strip()
    # Strip ```json ... ``` if present.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    if start == -1:
        raise ValueError(f"no JSON object in response: {raw[:200]!r}")
    end = text.rfind("}")
    if end == -1 or end < start:
        raise ValueError(f"unterminated JSON object in response: {raw[:200]!r}")
    return json.loads(text[start:end + 1])


def _coerce_classification(parsed: dict[str, Any], raw_response: str) -> Classification:
    """Validate parsed JSON and wrap it as a Classification."""
    category = (parsed.get("fee_category") or "").strip()
    confidence_raw = parsed.get("confidence")
    try:
        confidence = float(confidence_raw) if confidence_raw is not None else 0.0
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    amount_raw = parsed.get("amount")
    try:
        amount = float(amount_raw) if amount_raw is not None else None
    except (TypeError, ValueError):
        amount = None

    off = not is_canonical(category)
    return Classification(
        fee_category=category or "uncategorized",
        amount=amount,
        frequency=parsed.get("frequency"),
        conditions=parsed.get("conditions"),
        confidence=confidence,
        fee_name=parsed.get("fee_name"),
        off_taxonomy=off,
        stub=False,
        raw_response=raw_response,
    )


def classify(
    raw_text: str,
    *,
    raw_payload: dict[str, Any] | None = None,
    client: Any | None = None,
) -> Classification:
    """Classify a single raw fee snippet.

    Stub mode triggers when ANTHROPIC_API_KEY is unset or the anthropic SDK
    is unavailable. Stub returns a fixed low-confidence result and never
    raises, so the drain loop continues smoothly.

    `client` is injectable for tests -- pass a mocked Anthropic-like object
    with a `.messages.create(...)` method.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if client is None:
        if not api_key:
            return _stub_classify(raw_text)
        anthropic = _load_anthropic()
        if anthropic is None:
            return _stub_classify(raw_text)
        client = anthropic.Anthropic(api_key=api_key)

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=CLAUDE_MAX_TOKENS,
            temperature=CLAUDE_TEMPERATURE,
            system=_build_system_prompt(),
            messages=[
                {"role": "user", "content": _build_user_prompt(raw_text, raw_payload)},
            ],
        )
        # Extract text content. Anthropic SDK returns a list of content blocks.
        text_blocks = [
            block.text for block in response.content
            if getattr(block, "type", None) == "text"
        ]
        raw_response = "".join(text_blocks) if text_blocks else ""
        parsed = _parse_response(raw_response)
        return _coerce_classification(parsed, raw_response)
    except Exception as exc:  # noqa: BLE001 -- never let one bad row kill the batch.
        logger.warning("darwin: classifier error, returning low-confidence: %s", exc)
        return Classification(
            fee_category="uncategorized",
            amount=None,
            frequency=None,
            conditions=None,
            confidence=0.0,
            fee_name=None,
            off_taxonomy=True,
            stub=False,
            raw_response=None,
        )


# --- Multi-fee extraction -------------------------------------------------

# Larger token budget than single-fee classify; documents can have 50+ fees.
EXTRACT_MAX_TOKENS = 8192

# Haiku pricing (claude-haiku-4-5): $1/MTok input, $5/MTok output as of 2026-05.
# Stored as fractional cents per token for cost_cents math.
_HAIKU_INPUT_CENTS_PER_TOKEN = 0.0001  # $1 / 1M tokens => 0.0001 cents/token
_HAIKU_OUTPUT_CENTS_PER_TOKEN = 0.0005  # $5 / 1M tokens


_EXTRACT_SYSTEM_PROMPT = """You are Darwin, a bank-fee schedule extractor. You read a
fee-schedule document (HTML, PDF text, or plain text) and emit a JSON array of
EVERY identifiable fee in the document.

Rules:
- Pick `fee_category` STRICTLY from the canonical whitelist below (49 values).
  If a fee on the document doesn't fit any of the 49 categories well, OMIT it
  entirely. DO NOT force-fit or invent categories.
- `fee_name` is the human-readable label as printed in the document.
- `amount` is the USD amount as a number. If the document gives a range (e.g.
  "$25-$50"), use the headline value. Use null if non-numeric (e.g. "varies").
- `frequency` is one of: "per_month", "per_event", "per_year", "per_item",
  "per_transaction", "per_occurrence", "one_time", or null.
- `conditions` is free-form text describing waivers/tiers/limits, or null.
- `confidence` is a per-fee float in [0, 1] reflecting how sure you are about
  THIS specific fee's category and amount.
- `evidence_quote` is the verbatim text from the source document supporting
  this fee (max ~200 chars). REQUIRED -- this enables traceability.
- Never infer NSF from overdraft or vice versa. They are distinct categories.
- If the document contains no fee schedule (404 page, navigation HTML, etc.),
  return {"fees": [], "notes": "no fee schedule detected"}.
- `notes` may include free-form observations: extraction quality, unusual
  structures, sections that looked like fees but didn't fit the taxonomy.

Output JSON only. No prose. No markdown fences. Shape:
{
  "fees": [
    {
      "fee_category": "monthly_maintenance",
      "fee_name": "Monthly Service Fee",
      "amount": 12.00,
      "frequency": "per_month",
      "conditions": "Waived with $1500 minimum balance",
      "confidence": 0.92,
      "evidence_quote": "Monthly Service Charge $12.00 (waived..."
    }
  ],
  "notes": "..."
}

Allowed fee_category values (49):
{categories}
"""


def _build_extract_system_prompt() -> str:
    return _EXTRACT_SYSTEM_PROMPT.replace(
        "{categories}", ", ".join(CANONICAL_CATEGORIES)
    )


def _build_extract_user_prompt(
    raw_text: str, raw_payload: dict[str, Any] | None
) -> str:
    parts = ["Fee schedule document:", (raw_text or "").strip()[:30000]]
    if raw_payload:
        payload_str = json.dumps(raw_payload, default=str)[:4000]
        parts.extend(["", "Structured payload (if any):", payload_str])
    parts.append("")
    parts.append("Return JSON only.")
    return "\n".join(parts)


def _parse_extract_response(raw: str) -> dict[str, Any]:
    """Parse the multi-fee response. Defensive against fences / leading prose."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    if start == -1:
        raise ValueError(f"no JSON object in extract response: {raw[:200]!r}")
    end = text.rfind("}")
    if end == -1 or end < start:
        raise ValueError(f"unterminated JSON object: {raw[:200]!r}")
    return json.loads(text[start:end + 1])


def _coerce_fee_entry(entry: dict[str, Any], raw_response: str) -> Classification | None:
    """Validate one fee dict from the array. Returns None for off-taxonomy."""
    category = (entry.get("fee_category") or "").strip()
    if not is_canonical(category):
        # Drop off-taxonomy entries silently; the calling layer logs counts.
        return None

    try:
        confidence = float(entry.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    amount_raw = entry.get("amount")
    try:
        amount = float(amount_raw) if amount_raw is not None else None
    except (TypeError, ValueError):
        amount = None

    evidence = entry.get("evidence_quote")
    if isinstance(evidence, str):
        evidence = evidence.strip()[:500] or None

    return Classification(
        fee_category=category,
        amount=amount,
        frequency=entry.get("frequency"),
        conditions=entry.get("conditions"),
        confidence=confidence,
        fee_name=entry.get("fee_name"),
        off_taxonomy=False,
        stub=False,
        raw_response=raw_response,
        evidence_quote=evidence,
    )


def _stub_extract(raw_text: str) -> ExtractionResult:
    """Stub multi-fee extractor: reuse single-fee stub to yield 0-1 fees."""
    single = _stub_classify(raw_text)
    if single.amount is None and not single.raw_response:
        # Treat 'no amount, no useful signal' as 'no fees found'.
        return ExtractionResult(fees=[], notes="stub: no signal", stub=True)
    return ExtractionResult(fees=[single], notes="stub mode", stub=True)


def _estimate_cost_cents(input_tokens: int, output_tokens: int) -> int:
    """Round-up cost in cents for one Claude call at haiku pricing."""
    cents = (
        input_tokens * _HAIKU_INPUT_CENTS_PER_TOKEN
        + output_tokens * _HAIKU_OUTPUT_CENTS_PER_TOKEN
    )
    # Round up to next whole cent so cost is never undercounted.
    return max(0, int(cents + 0.9999))


def extract_fees(
    raw_text: str,
    *,
    raw_payload: dict[str, Any] | None = None,
    client: Any | None = None,
) -> ExtractionResult:
    """Extract every fee in a fee-schedule document as a list of Classifications.

    Stub mode (no API key) returns at most one fee from the keyword router so
    the drain pipeline still flows. Off-taxonomy fees are dropped at parse
    time -- callers see only canonical categories.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if client is None:
        if not api_key:
            return _stub_extract(raw_text)
        anthropic = _load_anthropic()
        if anthropic is None:
            return _stub_extract(raw_text)
        client = anthropic.Anthropic(api_key=api_key)

    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=EXTRACT_MAX_TOKENS,
            temperature=CLAUDE_TEMPERATURE,
            system=_build_extract_system_prompt(),
            messages=[
                {
                    "role": "user",
                    "content": _build_extract_user_prompt(raw_text, raw_payload),
                },
            ],
        )
        text_blocks = [
            block.text for block in response.content
            if getattr(block, "type", None) == "text"
        ]
        raw_response = "".join(text_blocks) if text_blocks else ""

        # Usage tokens for cost tracking. Anthropic SDK exposes .usage.
        usage = getattr(response, "usage", None)
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)

        parsed = _parse_extract_response(raw_response)
        raw_fees = parsed.get("fees") or []
        if not isinstance(raw_fees, list):
            raw_fees = []

        fees: list[Classification] = []
        for entry in raw_fees:
            if not isinstance(entry, dict):
                continue
            coerced = _coerce_fee_entry(entry, raw_response)
            if coerced is not None:
                fees.append(coerced)

        notes = parsed.get("notes")
        if not isinstance(notes, str):
            notes = None

        return ExtractionResult(
            fees=fees,
            notes=notes,
            cost_cents=_estimate_cost_cents(input_tokens, output_tokens),
            stub=False,
            raw_response=raw_response,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    except Exception as exc:  # noqa: BLE001 -- never let one bad doc kill the batch.
        logger.warning("darwin: extract_fees error: %s", exc)
        return ExtractionResult(
            fees=[],
            notes=f"extract_error: {exc}"[:500],
            cost_cents=0,
            stub=False,
            raw_response=None,
        )
