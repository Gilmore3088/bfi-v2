"""HTTP fetch layer for Atlas.

httpx-based fetcher with content-type detection and a small SSRF
denylist. PDF and HTML are returned as raw bytes; the caller decides
storage and downstream processing.
"""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import socket
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENT = (
    "BankFeeIndex/2.0 (Atlas crawler; +https://bankfeeindex.com/bots)"
)
DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
MAX_BYTES = 25 * 1024 * 1024  # 25 MB

_BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]
_BLOCKED_HOSTS = {"metadata.google.internal", "metadata.google.internal."}


@dataclass(frozen=True)
class FetchResult:
    url: str
    http_status: int
    content_type: str
    content_length: int
    content: bytes
    content_hash: str
    extension: str  # "html" | "pdf" | "bin"


def is_safe_url(url: str) -> bool:
    """Return False if URL resolves to a private/loopback/metadata host."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    hostname = parsed.hostname
    if not hostname:
        return False
    if hostname.lower() in _BLOCKED_HOSTS:
        return False
    try:
        for info in socket.getaddrinfo(hostname, None):
            ip = ipaddress.ip_address(info[4][0])
            for network in _BLOCKED_NETWORKS:
                if ip in network:
                    return False
    except (socket.gaierror, ValueError):
        # If DNS lookup fails, let the request itself surface the error.
        return True
    return True


def detect_extension(content_type: str, url: str, content: bytes) -> str:
    ct = (content_type or "").lower()
    if "pdf" in ct:
        return "pdf"
    if "html" in ct or "xhtml" in ct or "text/plain" in ct:
        return "html"
    if url.lower().endswith(".pdf"):
        return "pdf"
    if content[:4] == b"%PDF":
        return "pdf"
    if content[:15].lstrip().lower().startswith(b"<!doctype") or b"<html" in content[:512].lower():
        return "html"
    return "bin"


async def fetch_url(
    url: str,
    *,
    user_agent: str = DEFAULT_USER_AGENT,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    client: Optional[httpx.AsyncClient] = None,
) -> FetchResult:
    """Fetch a single URL; raises httpx errors on failure.

    If `client` is provided, it is reused (no close). Otherwise a temporary
    client is created for this call.
    """
    if not is_safe_url(url):
        raise ValueError(f"Refusing to fetch unsafe URL: {url}")

    headers = {"User-Agent": user_agent, "Accept": "*/*"}
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(timeout=timeout, follow_redirects=True, headers=headers)
    try:
        resp = await client.get(url, headers=headers)
        content = resp.content[:MAX_BYTES]
        content_type = resp.headers.get("content-type", "")
        ext = detect_extension(content_type, str(resp.url), content)
        return FetchResult(
            url=str(resp.url),
            http_status=resp.status_code,
            content_type=content_type,
            content_length=len(content),
            content=content,
            content_hash=hashlib.sha256(content).hexdigest(),
            extension=ext,
        )
    finally:
        if owns_client:
            await client.aclose()
