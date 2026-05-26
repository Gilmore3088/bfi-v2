"""Unit tests for homepage anchor scraping. No real network calls."""

from __future__ import annotations

import httpx
import pytest

from magellan.scraper import (
    MAX_CANDIDATES_PER_HOMEPAGE,
    SCRAPED_CONFIDENCE,
    SCRAPED_PATTERN,
    extract_fee_links,
)


def _client_for(html: str, base_url: str = "https://www.examplebank.com") -> httpx.AsyncClient:
    """Build an AsyncClient backed by MockTransport that returns the given HTML."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text=html,
            headers={"content-type": "text/html; charset=utf-8"},
        )

    transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport, follow_redirects=True, base_url=base_url)


async def test_extracts_fee_link_in_nav():
    html = """
    <html><body>
      <nav>
        <a href="/personal/checking">Checking</a>
        <a href="/disclosures/fees">Fees &amp; Disclosures</a>
        <a href="/about">About Us</a>
      </nav>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")

    assert len(out) == 1
    cand = out[0]
    assert cand.url == "https://www.examplebank.com/disclosures/fees"
    assert cand.pattern == SCRAPED_PATTERN
    assert cand.confidence == SCRAPED_CONFIDENCE


async def test_no_fee_links_returns_empty():
    html = """
    <html><body>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/locations">Locations</a>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")
    assert out == []


async def test_external_link_filtered_out():
    html = """
    <html><body>
      <a href="https://other-bank.com/fees">Competitor Fees</a>
      <a href="/our-fees">Our Fees</a>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")

    urls = [c.url for c in out]
    assert "https://www.examplebank.com/our-fees" in urls
    assert not any("other-bank.com" in u for u in urls)


async def test_mailto_javascript_filtered_out():
    html = """
    <html><body>
      <a href="mailto:fees@bank.com">Email About Fees</a>
      <a href="javascript:showFees()">Show Fees</a>
      <a href="tel:+18005551234">Call About Fees</a>
      <a href="/real-fees">Real Fees Page</a>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")
    assert len(out) == 1
    assert out[0].url == "https://www.examplebank.com/real-fees"


async def test_relative_urls_resolved():
    html = """
    <html><body>
      <a href="disclosures/fees.pdf">Fee Schedule PDF</a>
      <a href="/personal/fees">Fees</a>
      <a href="../legal/charges">Charges</a>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")

    urls = {c.url for c in out}
    assert "https://www.examplebank.com/disclosures/fees.pdf" in urls
    assert "https://www.examplebank.com/personal/fees" in urls
    assert "https://www.examplebank.com/legal/charges" in urls


async def test_mixed_case_keywords_matched():
    html = """
    <html><body>
      <a href="/x1">FEES</a>
      <a href="/x2">Disclosures</a>
      <a href="/x3">Pricing &amp; Rates</a>
      <a href="/x4">Truth In Savings</a>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")
    assert len(out) == 4


async def test_caps_at_15_candidates():
    anchors = "\n".join(
        f'<a href="/fees/page-{i}">Fee Page {i}</a>' for i in range(30)
    )
    html = f"<html><body>{anchors}</body></html>"
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")
    assert len(out) == MAX_CANDIDATES_PER_HOMEPAGE == 15


async def test_dedupes_by_url():
    html = """
    <html><body>
      <a href="/fees">Fees</a>
      <a href="/fees">Fee Schedule</a>
      <a href="/fees#section">Fees Section</a>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")
    assert len(out) == 1
    assert out[0].url == "https://www.examplebank.com/fees"


async def test_fetch_failure_returns_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom", request=request)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        out = await extract_fee_links(client, "https://www.deadbank.com")
    assert out == []


async def test_4xx_response_returns_empty():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, text="Forbidden")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        out = await extract_fee_links(client, "https://www.blockedbank.com")
    assert out == []


async def test_blank_url_returns_empty():
    async with _client_for("<html></html>") as client:
        assert await extract_fee_links(client, "") == []


async def test_subdomain_of_same_host_kept():
    # www-stripped host match: docs.examplebank.com vs www.examplebank.com.
    html = """
    <html><body>
      <a href="https://docs.examplebank.com/fee-schedule.pdf">Fee Schedule</a>
    </body></html>
    """
    async with _client_for(html) as client:
        out = await extract_fee_links(client, "https://www.examplebank.com")
    assert len(out) == 1
    assert "docs.examplebank.com" in out[0].url
