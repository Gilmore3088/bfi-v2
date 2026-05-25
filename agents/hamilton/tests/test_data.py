"""Data layer shape tests.

Exercises the in-process stub data path (no DATABASE_URL set). Covers
context assembly for all three report kinds and the distribution math.
"""

from __future__ import annotations

import os

import pytest

from hamilton import data


@pytest.fixture(autouse=True)
def _no_db(monkeypatch):
    """Force stub mode by clearing DATABASE_URL for every test in this module."""
    monkeypatch.delenv("DATABASE_URL", raising=False)


def test_load_institution_returns_known_seed():
    inst = data.load_institution("jpmorgan-chase")
    assert inst is not None
    assert inst.name == "JPMorgan Chase"
    assert inst.charter == "bank"


def test_load_institution_unknown_slug_returns_none():
    assert data.load_institution("does-not-exist") is None


def test_load_institution_fees_filters_by_slug():
    fees = data.load_institution_fees("jpmorgan-chase")
    assert fees, "expected non-empty stub fees for seed institution"
    assert all(f.institution_slug == "jpmorgan-chase" for f in fees)


def test_load_category_fees_filters_by_category():
    rows = data.load_category_fees("overdraft")
    assert rows
    assert all(r.canonical_category == "overdraft" for r in rows)


def test_summarize_distribution_empty():
    summary = data.summarize_distribution([])
    assert summary["count"] == 0
    assert summary["median"] is None


def test_summarize_distribution_basic():
    rows = data.load_category_fees("overdraft")
    summary = data.summarize_distribution(rows)
    assert summary["count"] == len(rows)
    assert summary["min"] <= summary["median"] <= summary["max"]
    assert summary["p25"] <= summary["median"] <= summary["p75"]


def test_build_institution_context_shape():
    context = data.build_institution_context("jpmorgan-chase")
    assert context["kind"] == "institution"
    assert context["institution"]["slug"] == "jpmorgan-chase"
    assert isinstance(context["fees"], list)
    assert isinstance(context["peers"], dict)
    # Every fee category must have a corresponding peer-distribution entry.
    fee_categories = {f["category"] for f in context["fees"]}
    assert fee_categories.issubset(set(context["peers"].keys()))


def test_build_institution_context_unknown_raises():
    with pytest.raises(ValueError):
        data.build_institution_context("does-not-exist")


def test_build_category_context_shape():
    context = data.build_category_context("overdraft")
    assert context["kind"] == "category"
    assert context["category"] == "overdraft"
    assert context["distribution"]["count"] > 0
    assert isinstance(context["rows"], list)
    assert all("institution_name" in r for r in context["rows"])


def test_build_peer_context_shape():
    context = data.build_peer_context(
        "jpmorgan-chase", ["bank-of-america", "wells-fargo"]
    )
    assert context["kind"] == "peer"
    assert context["subject"]["slug"] == "jpmorgan-chase"
    peer_slugs = {p["slug"] for p in context["peers"]}
    assert peer_slugs == {"bank-of-america", "wells-fargo"}
    # Table rows have a by_institution dict keyed by slug.
    assert context["table"]
    for row in context["table"]:
        assert "category" in row
        assert isinstance(row["by_institution"], dict)


def test_build_peer_context_unknown_subject_raises():
    with pytest.raises(ValueError):
        data.build_peer_context("does-not-exist", ["bank-of-america"])
