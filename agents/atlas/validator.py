"""Content validation for Atlas.

Atlas fetches any 200-OK body it can reach, but many of those bodies are
landing pages, marketing copy, or soft-404s (HTTP 200 with "page not found"
content). Storing those rows in fees_raw wastes Darwin classification spend.

This module exposes a single pure function, ``validate_text``, that returns a
``ValidationResult`` describing whether the extracted text resembles a real
fee schedule. No I/O, no DB, no side effects — easy to unit test.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

FEE_KEYWORDS: frozenset[str] = frozenset(
    {
        "fee",
        "charge",
        "service fee",
        "monthly",
        "overdraft",
        "nsf",
        "wire transfer",
        "stop payment",
        "atm",
        "minimum balance",
        "schedule of fees",
        "fee schedule",
        "disclosure",
    }
)

SOFT_404_MARKERS: tuple[str, ...] = (
    "page not found",
    "404 error",
    "we can't find the page",
    "the page you requested",
    "oops",
    "redirected",
)

HTML_SIZE_THRESHOLD = 1500
PDF_SIZE_THRESHOLD = 800
SOFT_404_MAX_CHARS = 4000
MIN_KEYWORD_HITS = 2


@dataclass
class ValidationResult:
    is_fee_schedule: bool
    reason: str  # 'ok' | 'too_small' | 'no_dollar_signs' | 'no_fee_keywords' | 'soft_404'
    score: float  # 0-1 confidence this is a real fee schedule


def _size_threshold(content_type: Optional[str]) -> int:
    if content_type and "pdf" in content_type.lower():
        return PDF_SIZE_THRESHOLD
    return HTML_SIZE_THRESHOLD


def _count_keyword_hits(lowered: str) -> int:
    return sum(1 for kw in FEE_KEYWORDS if kw in lowered)


def _has_soft_404_marker(lowered: str) -> bool:
    return any(marker in lowered for marker in SOFT_404_MARKERS)


def _compute_score(
    *,
    size_ok: bool,
    has_dollar: bool,
    keyword_hits: int,
) -> float:
    score = 0.0
    if size_ok:
        score += 0.3
    if has_dollar:
        score += 0.3
    if keyword_hits >= MIN_KEYWORD_HITS:
        score += 0.4
    return round(score, 3)


def validate_text(text: Optional[str], content_type: Optional[str] = None) -> ValidationResult:
    """Validate that extracted text plausibly represents a fee schedule.

    Rules (any failure short-circuits to a rejection):
      - text length < threshold -> too_small
        (threshold is 800 for PDFs, 1500 otherwise)
      - text does not contain '$' or '¢' -> no_dollar_signs
      - text contains fewer than 2 fee keywords (case-insensitive) -> no_fee_keywords
      - text contains a soft-404 marker AND total length < 4000 chars -> soft_404
    """
    safe_text = text or ""
    lowered = safe_text.lower()
    length = len(safe_text)
    threshold = _size_threshold(content_type)

    has_dollar = ("$" in safe_text) or ("¢" in safe_text)
    keyword_hits = _count_keyword_hits(lowered)
    size_ok = length >= threshold

    score = _compute_score(
        size_ok=size_ok,
        has_dollar=has_dollar,
        keyword_hits=keyword_hits,
    )

    if not size_ok:
        return ValidationResult(False, "too_small", score)
    if not has_dollar:
        return ValidationResult(False, "no_dollar_signs", score)
    if keyword_hits < MIN_KEYWORD_HITS:
        return ValidationResult(False, "no_fee_keywords", score)
    if _has_soft_404_marker(lowered) and length < SOFT_404_MAX_CHARS:
        return ValidationResult(False, "soft_404", score)

    return ValidationResult(True, "ok", score)
