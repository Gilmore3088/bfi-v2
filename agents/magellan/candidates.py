"""Candidate URL generation for fee-schedule discovery.

Given an institution's website root, produce a ranked list of likely
fee-schedule URLs based on patterns observed across thousands of US bank
and credit union sites. No network calls; pure URL construction.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse, urlunparse


# Ordered by historical hit rate from v1 discovery telemetry.
# Patterns intentionally kept tight: high-precision common paths first,
# broader disclosures sections second, PDF fallbacks last.
COMMON_PATHS: tuple[str, ...] = (
    # High-precision fee pages
    "/personal/checking-fees",
    "/personal/fees",
    "/personal-banking/fees",
    "/personal/checking/fees",
    "/disclosures/fee-schedule",
    "/disclosures/fees",
    "/fee-schedule",
    "/feeschedule",
    "/fees-and-charges",
    "/fees",
    # Consumer / business variants
    "/consumer/fees",
    "/consumer-banking/fees",
    "/business/fees",
    "/business-banking/fees",
    "/commercial/fees",
    # About / legal / resources
    "/about/fees",
    "/legal/fees",
    "/legal/disclosures",
    "/resources/fees",
    "/resources/disclosures",
    "/disclosures",
    # Credit-union specific
    "/membership/fees",
    "/member-services/fees",
    "/accounts/fees",
    # PDF fallbacks (recorded with lower confidence)
    "/fees.pdf",
    "/personal/fees.pdf",
    "/checking/fees.pdf",
    "/docs/fees.pdf",
    "/sites/default/files/fees.pdf",
)


PATH_CONFIDENCE: dict[str, float] = {
    # Fee-schedule pages with explicit naming get top confidence.
    "/personal/checking-fees": 0.85,
    "/disclosures/fee-schedule": 0.85,
    "/fee-schedule": 0.80,
    "/feeschedule": 0.80,
    "/fees-and-charges": 0.78,
    "/personal/fees": 0.75,
    "/personal-banking/fees": 0.75,
    "/disclosures/fees": 0.75,
    "/fees": 0.70,
}

DEFAULT_PATH_CONFIDENCE = 0.55
PDF_CONFIDENCE = 0.60


@dataclass(frozen=True)
class Candidate:
    """A single URL candidate to probe."""

    url: str
    pattern: str
    confidence: float

    def is_pdf(self) -> bool:
        return self.url.lower().endswith(".pdf")


def _normalize_root(website_url: str) -> str | None:
    """Return scheme://host with no path, or None if unparseable."""
    if not website_url:
        return None
    parsed = urlparse(website_url.strip())
    if not parsed.netloc:
        # Tolerate bare hostnames like "example.com".
        if parsed.path and "." in parsed.path:
            return f"https://{parsed.path.strip('/')}"
        return None
    scheme = parsed.scheme or "https"
    return urlunparse((scheme, parsed.netloc, "", "", "", ""))


def _confidence_for(path: str) -> float:
    if path in PATH_CONFIDENCE:
        return PATH_CONFIDENCE[path]
    if path.lower().endswith(".pdf"):
        return PDF_CONFIDENCE
    return DEFAULT_PATH_CONFIDENCE


def generate_candidates(
    website_url: str,
    extra_paths: Iterable[str] | None = None,
) -> list[Candidate]:
    """Build candidate URLs for an institution website.

    Args:
        website_url: Root URL of the institution (any URL on the same host works).
        extra_paths: Optional additional path patterns to append (e.g. CMS hints).

    Returns:
        Deduplicated list of Candidate objects ordered by confidence desc.
        Empty list if website_url cannot be parsed.
    """
    root = _normalize_root(website_url)
    if not root:
        return []

    paths: list[str] = list(COMMON_PATHS)
    if extra_paths:
        for p in extra_paths:
            if p and p not in paths:
                paths.append(p)

    seen: set[str] = set()
    candidates: list[Candidate] = []
    for path in paths:
        url = f"{root}{path}"
        if url in seen:
            continue
        seen.add(url)
        candidates.append(
            Candidate(url=url, pattern=path, confidence=_confidence_for(path))
        )

    candidates.sort(key=lambda c: c.confidence, reverse=True)
    return candidates


def merge_candidates(*groups: Iterable[Candidate]) -> list[Candidate]:
    """Concatenate Candidate groups, dedupe by URL, preserve input order.

    The FIRST occurrence of each URL wins (so callers should pass
    higher-confidence sources first, e.g. scraped links before patterns).
    Returns a new list; inputs are not mutated.
    """
    seen: set[str] = set()
    out: list[Candidate] = []
    for group in groups:
        for c in group:
            if c.url in seen:
                continue
            seen.add(c.url)
            out.append(c)
    return out
