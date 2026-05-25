"""Lightweight raw-text extraction for Atlas.

Atlas does NOT classify or canonicalize. It only extracts a best-effort
plain-text representation so that downstream agents (Darwin) can read
fees_raw.raw_text without re-fetching the original HTML/PDF.

Heavyweight extraction (LLM, layout-aware PDF) is deferred to Darwin.
"""

from __future__ import annotations

import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 500_000  # cap text we shove into Postgres


def extract_text(content: bytes, extension: str) -> Optional[str]:
    """Return a plain-text representation of content, or None on failure."""
    if not content:
        return None
    try:
        if extension == "html":
            return _extract_html(content)
        if extension == "pdf":
            return _extract_pdf(content)
    except Exception as exc:  # noqa: BLE001 — extractor must never fail the run
        logger.warning("extract_text failed (%s): %s", extension, exc)
        return None
    return None


def _extract_html(content: bytes) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(content, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    return text[:MAX_TEXT_CHARS]


def _extract_pdf(content: bytes) -> str:
    import pdfplumber

    parts: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            if page_text:
                parts.append(page_text)
            if sum(len(p) for p in parts) >= MAX_TEXT_CHARS:
                break
    return "\n\n".join(parts)[:MAX_TEXT_CHARS]
