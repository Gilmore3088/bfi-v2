"""Voice constraints tests.

These tests are the automated half of the OPERATIONS_MANAGER.md section 3
editorial gate. Anything that passes here still has to clear a human read.
"""

from __future__ import annotations

import pytest

from hamilton.prompts import (
    BANNED_PHRASES,
    check_voice,
    institution_profile_system_prompt,
    render_user_prompt,
    system_prompt_for,
)


def test_clean_body_has_no_violations():
    body = (
        "# Sample Report\n\n"
        "Bank Fee Index analysis shows that the institution's overdraft fee "
        "sits at the top of its peer set. The implication is plain: this "
        "pricing decision is worth defending or revisiting."
    )
    assert check_voice(body) == []


@pytest.mark.parametrize("phrase", list(BANNED_PHRASES))
def test_banned_phrases_are_flagged(phrase: str):
    body = f"This sentence will unfairly {phrase} the reader."
    violations = check_voice(body)
    assert any(v.rule == "banned_phrase" for v in violations), (
        f"expected banned_phrase violation for {phrase!r}"
    )


def test_first_person_pronouns_are_flagged():
    body = "Bank Fee Index analysis is clear, but I think the data could go further."
    violations = check_voice(body)
    assert any(v.rule == "first_person" for v in violations)


def test_we_pronoun_is_flagged():
    body = "We looked at 1,247 institutions in the peer set."
    violations = check_voice(body)
    assert any(v.rule == "first_person" for v in violations)


def test_third_person_body_passes_first_person_check():
    body = (
        "Bank Fee Index analysis identifies the top of the peer set. The "
        "institution's pricing is the highest in the sample."
    )
    violations = check_voice(body)
    assert not any(v.rule == "first_person" for v in violations)


def test_future_dollar_prediction_is_flagged():
    body = "Bank Fee Index analysis projects that overdraft fees will rise by 2030."
    violations = check_voice(body)
    assert any(v.rule == "future_prediction" for v in violations)


def test_forecast_word_is_flagged():
    body = "Bank Fee Index forecasts a category-wide shift."
    violations = check_voice(body)
    assert any(v.rule == "future_prediction" for v in violations)


def test_system_prompt_for_known_kinds_returns_string():
    for kind in ("institution", "category", "peer"):
        text = system_prompt_for(kind)
        assert isinstance(text, str)
        assert "Hamilton" in text
        assert "Third person throughout" in text


def test_system_prompt_for_unknown_kind_raises():
    with pytest.raises(ValueError):
        system_prompt_for("monthly_pulse")


def test_system_prompt_lists_banned_words():
    prompt = institution_profile_system_prompt()
    # Spot-check a representative subset rather than every entry.
    for required in ("unlock", "AI-powered", "next-generation", "leverage"):
        assert required in prompt, f"expected {required!r} in system prompt"


def test_render_user_prompt_embeds_context():
    context = {"institution": {"name": "Test Bank"}, "fees": []}
    text = render_user_prompt("institution", context)
    assert "Test Bank" in text
    assert "institution-profile report" in text


def test_render_user_prompt_unknown_kind_falls_back():
    # Unknown kind still renders rather than crashing -- the system_prompt_for
    # call is the gate, not this one.
    text = render_user_prompt("monthly_pulse", {"foo": "bar"})
    assert "foo" in text


def test_banned_phrase_detection_is_case_insensitive():
    body = "This will UNLOCK new value."
    violations = check_voice(body)
    assert any(v.rule == "banned_phrase" for v in violations)
