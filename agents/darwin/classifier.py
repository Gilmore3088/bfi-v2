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

    @property
    def family(self) -> str | None:
        return family_for(self.fee_category)

    @property
    def auto_promote(self) -> bool:
        """True only when in-taxonomy AND confidence is at or above threshold."""
        return (not self.off_taxonomy) and self.confidence >= AUTO_PROMOTE_CONFIDENCE


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
