"""Unit tests for agents.atlas.storage — verifies stub behavior + key shape."""

from __future__ import annotations

from datetime import datetime, timezone

from agents.atlas.storage import build_r2_key, put_object, r2_configured


def test_build_r2_key_shape():
    when = datetime(2026, 5, 25, 12, 0, tzinfo=timezone.utc)
    key = build_r2_key(institution_id=42, content_hash="abc123", extension="pdf", when=when)
    assert key == "raw/42/2026-05-25/abc123.pdf"


def test_build_r2_key_unknown_extension_normalized_to_bin():
    when = datetime(2026, 1, 1, tzinfo=timezone.utc)
    key = build_r2_key(institution_id=7, content_hash="deadbeef", extension="exe", when=when)
    assert key.endswith(".bin")


def test_r2_not_configured_in_test_env():
    # conftest strips R2_* vars; storage must report stub mode.
    assert r2_configured() is False


def test_put_object_stub_mode_returns_synthetic_key():
    when = datetime(2026, 5, 25, tzinfo=timezone.utc)
    obj = put_object(
        institution_id=99,
        content=b"<html>fees</html>",
        content_hash="cafebabe",
        extension="html",
        when=when,
    )
    assert obj.stub is True
    assert obj.key == "raw/99/2026-05-25/cafebabe.html"
