"""Unit tests for agents.atlas.fetcher — no network."""

from __future__ import annotations

import hashlib

import httpx
import pytest

from agents.atlas.fetcher import detect_extension, fetch_url, is_safe_url


def test_is_safe_url_blocks_loopback():
    assert is_safe_url("http://127.0.0.1/x") is False
    assert is_safe_url("http://localhost/x") is False


def test_is_safe_url_blocks_metadata_host():
    assert is_safe_url("http://metadata.google.internal/computeMetadata") is False


def test_is_safe_url_rejects_non_http_scheme():
    assert is_safe_url("file:///etc/passwd") is False
    assert is_safe_url("ftp://example.com/x") is False


def test_is_safe_url_allows_public_hostname():
    # Allow unresolved or public hosts; the request will surface DNS errors itself.
    assert is_safe_url("https://example.com/fees") is True


def test_detect_extension_pdf_by_content_type():
    assert detect_extension("application/pdf", "https://x/y", b"") == "pdf"


def test_detect_extension_pdf_by_magic_bytes():
    assert detect_extension("application/octet-stream", "https://x/y", b"%PDF-1.4 ...") == "pdf"


def test_detect_extension_html_by_doctype():
    assert detect_extension("text/html; charset=utf-8", "https://x/y", b"<!DOCTYPE html><html>") == "html"


def test_detect_extension_fallback_bin():
    assert detect_extension("application/octet-stream", "https://x/y", b"\x00\x01\x02") == "bin"


@pytest.mark.asyncio
async def test_fetch_url_mocked_html():
    html = b"<!doctype html><html><body>Fees</body></html>"

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=html, headers={"content-type": "text/html"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
        result = await fetch_url("https://example.com/fees", client=client)

    assert result.http_status == 200
    assert result.extension == "html"
    assert result.content == html
    assert result.content_hash == hashlib.sha256(html).hexdigest()
    assert result.content_length == len(html)


@pytest.mark.asyncio
async def test_fetch_url_refuses_unsafe():
    with pytest.raises(ValueError):
        await fetch_url("http://127.0.0.1/x")
