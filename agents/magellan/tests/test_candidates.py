"""Unit tests for candidate URL generation. No network calls."""

from __future__ import annotations

import pytest

from magellan.candidates import (
    COMMON_PATHS,
    Candidate,
    DEFAULT_PATH_CONFIDENCE,
    PDF_CONFIDENCE,
    generate_candidates,
)


def test_generate_candidates_returns_nonempty_for_valid_url():
    candidates = generate_candidates("https://www.example.com")
    assert len(candidates) == len(COMMON_PATHS)
    assert all(isinstance(c, Candidate) for c in candidates)


def test_generate_candidates_returns_empty_for_blank():
    assert generate_candidates("") == []
    assert generate_candidates("   ") == []


def test_generate_candidates_handles_bare_hostname():
    candidates = generate_candidates("example.com")
    assert candidates, "expected candidates for bare hostname"
    assert all(c.url.startswith("https://example.com") for c in candidates)


def test_generate_candidates_strips_path_from_input():
    candidates = generate_candidates("https://www.example.com/about/team")
    assert all(c.url.startswith("https://www.example.com") for c in candidates)
    # Generated URLs should not include the original /about/team prefix.
    assert not any("/about/team" in c.url for c in candidates)


def test_generated_urls_are_unique():
    candidates = generate_candidates("https://bank.example")
    urls = [c.url for c in candidates]
    assert len(urls) == len(set(urls))


def test_generated_candidates_sorted_by_confidence_desc():
    candidates = generate_candidates("https://bank.example")
    confidences = [c.confidence for c in candidates]
    assert confidences == sorted(confidences, reverse=True)


def test_pdf_candidates_get_pdf_confidence():
    candidates = generate_candidates("https://bank.example")
    pdfs = [c for c in candidates if c.pattern.endswith(".pdf")]
    assert pdfs, "expected at least one PDF candidate"
    for c in pdfs:
        assert c.confidence == PDF_CONFIDENCE
        assert c.is_pdf()


def test_high_precision_paths_outrank_generic():
    candidates = generate_candidates("https://bank.example")
    by_pattern = {c.pattern: c for c in candidates}
    assert by_pattern["/fee-schedule"].confidence > by_pattern["/fees"].confidence
    assert by_pattern["/disclosures/fee-schedule"].confidence >= by_pattern["/disclosures"].confidence


def test_extra_paths_appended_and_deduped():
    candidates = generate_candidates(
        "https://bank.example",
        extra_paths=["/cms/fees", "/fees"],  # /fees is a duplicate
    )
    patterns = [c.pattern for c in candidates]
    assert "/cms/fees" in patterns
    # Duplicate should not double up.
    assert patterns.count("/fees") == 1


def test_extra_path_uses_default_confidence():
    candidates = generate_candidates(
        "https://bank.example",
        extra_paths=["/custom/path"],
    )
    extra = next(c for c in candidates if c.pattern == "/custom/path")
    assert extra.confidence == DEFAULT_PATH_CONFIDENCE


@pytest.mark.parametrize(
    "url",
    [
        "https://www.chase.com",
        "http://example.org",
        "https://navyfederal.org/path/ignored",
    ],
)
def test_normalizes_various_input_shapes(url: str):
    candidates = generate_candidates(url)
    assert candidates, f"expected candidates for {url}"
