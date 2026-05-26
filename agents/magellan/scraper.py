"""Homepage anchor scraping for fee-schedule discovery.

Fetches an institution's homepage and extracts anchor tags whose href or
visible text matches fee-related keywords. Produces higher-confidence
candidates than blind pattern probing because the bank itself links to
the page.
"""

from __future__ import annotations

import logging
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .candidates import Candidate


logger = logging.getLogger(__name__)


# Keywords matched (case-insensitively) against href or visible link text.
FEE_KEYWORDS: tuple[str, ...] = (
    "fee",
    "disclosure",
    "charge",
    "rate",
    "schedule of",
    "truth in",
    "pricing",
)

# Anchors with these schemes / pseudo-schemes are not real navigations.
_SKIP_SCHEMES: frozenset[str] = frozenset({"mailto", "tel", "javascript", "sms", "data"})

# Confidence assigned to a scraper-discovered candidate. Higher than the
# default pattern confidence (0.55) because the bank explicitly linked it.
SCRAPED_CONFIDENCE = 0.7

# Per-homepage cap. Most banks have <5 fee-related links; a hard cap
# guards against rogue pages with hundreds of footer links.
MAX_CANDIDATES_PER_HOMEPAGE = 15

# Pattern label used on Candidate objects (and persisted by the
# knowledge layer) so we can distinguish scraper hits from URL-probe hits.
SCRAPED_PATTERN = "scraped_link"

# Maximum bytes to download from a homepage. Some sites serve huge
# bundles; we only need the HTML head/body anchor markup.
MAX_HOMEPAGE_BYTES = 2_000_000


def _matches_keyword(text: str) -> bool:
    lowered = text.lower()
    return any(kw in lowered for kw in FEE_KEYWORDS)


def _same_host(homepage_host: str, candidate_host: str) -> bool:
    """Compare hosts ignoring leading 'www.' so subdomains-of-self stay in."""
    if not candidate_host:
        # Relative URL resolved to same host -> empty netloc means same.
        return True
    a = homepage_host.lower().removeprefix("www.")
    b = candidate_host.lower().removeprefix("www.")
    return a == b or b.endswith("." + a) or a.endswith("." + b)


async def extract_fee_links(
    client: httpx.AsyncClient,
    website_url: str,
) -> list[Candidate]:
    """Fetch the institution homepage and return fee-related anchor candidates.

    Args:
        client: Active httpx.AsyncClient (caller manages lifecycle).
        website_url: Institution homepage URL.

    Returns:
        List of Candidate objects (pattern="scraped_link", confidence=0.7),
        deduplicated by absolute URL, capped at MAX_CANDIDATES_PER_HOMEPAGE.
        Empty list on fetch failure, parse failure, or no matches.
    """
    if not website_url:
        return []

    try:
        resp = await client.get(website_url, follow_redirects=True)
    except httpx.HTTPError as exc:
        logger.warning(
            "magellan.scraper: homepage fetch failed for %s: %s",
            website_url,
            str(exc)[:200],
        )
        return []

    if resp.status_code >= 400:
        logger.warning(
            "magellan.scraper: homepage returned %s for %s",
            resp.status_code,
            website_url,
        )
        return []

    body = resp.text
    if len(body) > MAX_HOMEPAGE_BYTES:
        body = body[:MAX_HOMEPAGE_BYTES]

    try:
        soup = BeautifulSoup(body, "html.parser")
    except Exception as exc:  # noqa: BLE001 - parser shouldn't take us down
        logger.warning(
            "magellan.scraper: parse failed for %s: %s", website_url, exc
        )
        return []

    # Base for relative URL resolution: prefer final response URL (after redirects).
    base_url = str(resp.url) if resp.url else website_url
    base_host = urlparse(base_url).netloc

    seen: set[str] = set()
    candidates: list[Candidate] = []

    for anchor in soup.find_all("a"):
        href = anchor.get("href")
        if not href:
            continue
        href = href.strip()
        if not href or href.startswith("#"):
            continue

        # Skip non-navigational schemes.
        scheme = urlparse(href).scheme.lower()
        if scheme in _SKIP_SCHEMES:
            continue

        text = anchor.get_text(separator=" ", strip=True) or ""
        if not (_matches_keyword(href) or _matches_keyword(text)):
            continue

        absolute = urljoin(base_url, href)
        parsed = urlparse(absolute)
        if parsed.scheme not in ("http", "https"):
            continue
        if not _same_host(base_host, parsed.netloc):
            continue

        # Drop fragments for dedup; otherwise /fees#anchor and /fees are dupes.
        clean = parsed._replace(fragment="").geturl()
        if clean in seen:
            continue
        seen.add(clean)

        candidates.append(
            Candidate(
                url=clean,
                pattern=SCRAPED_PATTERN,
                confidence=SCRAPED_CONFIDENCE,
            )
        )

        if len(candidates) >= MAX_CANDIDATES_PER_HOMEPAGE:
            break

    return candidates
