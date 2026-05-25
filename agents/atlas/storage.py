"""R2 object storage for Atlas.

Stores raw HTML/PDF under `raw/{institution_id}/{YYYY-MM-DD}/{hash}.{ext}`.
If R2 credentials are not configured, runs in STUB mode: it logs the
intended upload and returns a synthetic key without making any
network calls. This keeps M1 development unblocked.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_REQUIRED_ENV = ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")


@dataclass(frozen=True)
class StoredObject:
    key: str
    stub: bool


def r2_configured() -> bool:
    return all(os.environ.get(k) for k in _REQUIRED_ENV)


def build_r2_key(
    institution_id: int,
    content_hash: str,
    extension: str,
    *,
    when: Optional[datetime] = None,
) -> str:
    when = when or datetime.now(timezone.utc)
    date = when.strftime("%Y-%m-%d")
    ext = extension if extension in {"html", "pdf"} else "bin"
    return f"raw/{institution_id}/{date}/{content_hash}.{ext}"


def _content_type_for(extension: str) -> str:
    if extension == "pdf":
        return "application/pdf"
    if extension == "html":
        return "text/html"
    return "application/octet-stream"


def put_object(
    institution_id: int,
    content: bytes,
    content_hash: str,
    extension: str,
    *,
    when: Optional[datetime] = None,
) -> StoredObject:
    """Upload raw content to R2 (or stub if creds are missing)."""
    key = build_r2_key(institution_id, content_hash, extension, when=when)

    if not r2_configured():
        logger.info("STUB: would upload to R2 key=%s bytes=%d", key, len(content))
        return StoredObject(key=key, stub=True)

    import boto3  # local import so tests can run without boto3 installed
    from botocore.config import Config as BotoConfig

    client = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=BotoConfig(region_name="auto", s3={"addressing_style": "path"}),
    )
    bucket = os.environ["R2_BUCKET"]

    try:
        client.head_object(Bucket=bucket, Key=key)
        logger.debug("R2 object already present: %s", key)
        return StoredObject(key=key, stub=False)
    except client.exceptions.ClientError as e:
        if e.response["Error"]["Code"] not in ("404", "NoSuchKey", "NotFound"):
            raise

    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=_content_type_for(extension),
    )
    logger.info("Uploaded R2 object key=%s bytes=%d", key, len(content))
    return StoredObject(key=key, stub=False)
