"""Voice constraints and system prompts for Hamilton.

The CMO brief specifies Hamilton's voice precisely: third person in
published reports, FT Lex x McKinsey associate, no hedge words, no
SaaS-y phrasing. The anti-pattern list below is enforced both at
prompt time (the model is told not to use these) and at QA time (the
validator rejects drafts that include them).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

# Words and phrases banned from any published report body. Case-insensitive.
# Source: docs/team/CMO.md section 7 and OPERATIONS_MANAGER.md section 3.
BANNED_PHRASES: tuple[str, ...] = (
    "unlock",
    "ai-powered",
    "ai powered",
    "next-generation",
    "next generation",
    "leverage",
    "leveraging",
    "synergy",
    "synergies",
    "revolutionize",
    "revolutionary",
    "game-changing",
    "game changing",
    "as an ai",
    "i am an ai",
    "might potentially",
    "could potentially",
    # Hedge words that erode the McKinsey voice.
    "we believe",
    "we feel",
)

# First-person markers are allowed in conversational mode only. M1 ships
# report bodies, so any of these in a draft is a violation.
FIRST_PERSON_MARKERS: tuple[str, ...] = (
    " i ",
    " i'm ",
    " i've ",
    " we ",
    " we're ",
    " we've ",
    " our ",
    " us ",
)

# Phrases hinting at forward-looking dollar predictions.
FUTURE_PREDICTION_PATTERNS: tuple[str, ...] = (
    r"\bby\s+20[3-9]\d\b",  # "by 2030", "by 2040", etc.
    r"\bwill\s+(rise|climb|grow|increase|fall|drop)\b",
    r"\bwe\s+predict\b",
    r"\bforecast(s|ed)?\b",
    r"\bprojected\s+to\s+(rise|climb|grow|reach|exceed)\b",
)


@dataclass(frozen=True)
class VoiceViolation:
    """A single editorial-gate finding."""

    rule: str
    excerpt: str

    def __str__(self) -> str:  # pragma: no cover -- formatting helper
        return f"[{self.rule}] {self.excerpt}"


def check_voice(body: str) -> list[VoiceViolation]:
    """Return a list of violations against the published-report voice rules.

    Empty list means the draft passes the automated portion of the editorial
    gate. A human still has to read it, per OPERATIONS_MANAGER.md section 3.
    """
    violations: list[VoiceViolation] = []
    lowered = body.lower()

    for phrase in BANNED_PHRASES:
        if phrase in lowered:
            violations.append(
                VoiceViolation(rule="banned_phrase", excerpt=phrase)
            )

    # First-person check: pad with spaces so word boundaries are simple.
    padded = f" {lowered} "
    for marker in FIRST_PERSON_MARKERS:
        if marker in padded:
            violations.append(
                VoiceViolation(rule="first_person", excerpt=marker.strip())
            )

    for pattern in FUTURE_PREDICTION_PATTERNS:
        match = re.search(pattern, lowered)
        if match:
            violations.append(
                VoiceViolation(rule="future_prediction", excerpt=match.group(0))
            )

    return violations


# -----------------------------------------------------------------------------
# System prompts
# -----------------------------------------------------------------------------

_VOICE_PREAMBLE = """\
You are Hamilton, the senior research analyst for Bank Fee Index. You
write like a composite of an FT Lex columnist and a McKinsey associate
partner briefing a client CEO: calm, declarative, opinionated, and
evidence-led. You lead with the finding, support with the data, and end
with the implication. You never apologize for being a model and never
say "as an AI."

Voice rules (non-negotiable):
- Third person throughout. Refer to the firm as "Bank Fee Index" or
  "this analysis." Do not use "I," "we," or "our."
- Open every report with a single bold claim, grounded in the data in
  the report itself.
- Use labeled "So what" callouts: one sentence each, falsifiable.
- Cite confidence intervals or sample sizes only when they matter.
- Every dollar figure must trace to a fee row supplied in the context.
  Do not invent numbers. Do not predict future fees. Do not project
  dollar revenue impact without a stated assumption.
- No hedge words ("might," "could potentially," "we believe").
- No SaaS-y phrasing. Banned words include: unlock, AI-powered,
  next-generation, leverage, synergy, revolutionize, game-changing.
- No emojis. Ever.
"""


def institution_profile_system_prompt() -> str:
    return _VOICE_PREAMBLE + (
        "\nReport kind: institution profile.\n\n"
        "Structure: (1) headline finding, (2) where this institution sits in "
        "its peer set, (3) two or three fee categories that drive the verdict, "
        "(4) a closing 'so what' for the executive reader. Aim for 1,500 to "
        "2,500 words. Every claim cites a fee row from the provided context."
    )


def category_deepdive_system_prompt() -> str:
    return _VOICE_PREAMBLE + (
        "\nReport kind: category deep-dive.\n\n"
        "Structure: (1) the category in one paragraph, (2) the distribution "
        "(median, P25-P75, range), (3) named outliers at both ends, (4) what "
        "the spread implies for a bank pricing this category today. 1,500 to "
        "2,500 words. Do not generalize beyond institutions in the context."
    )


def peer_benchmark_system_prompt() -> str:
    return _VOICE_PREAMBLE + (
        "\nReport kind: peer benchmark.\n\n"
        "Structure: (1) headline verdict on the subject vs. peers, (2) "
        "side-by-side table of focal categories, (3) two or three deltas that "
        "matter, (4) closing 'so what' implication. 1,500 to 2,500 words."
    )


def system_prompt_for(kind: str) -> str:
    """Dispatch to the report-kind-specific system prompt."""
    kinds = {
        "institution": institution_profile_system_prompt,
        "category": category_deepdive_system_prompt,
        "peer": peer_benchmark_system_prompt,
    }
    if kind not in kinds:
        raise ValueError(
            f"unknown report kind: {kind!r}; expected one of {sorted(kinds)}"
        )
    return kinds[kind]()


def render_user_prompt(kind: str, context: dict) -> str:
    """Render the user-message payload Claude sees alongside the system prompt.

    The context is the same dict passed to the Jinja2 template, so the model
    and the deterministic template agree on the underlying data.
    """
    import json

    header = {
        "institution": "Produce an institution-profile report from the data below.",
        "category": "Produce a category deep-dive report from the data below.",
        "peer": "Produce a peer-benchmark report from the data below.",
    }.get(kind, "Produce a report from the data below.")

    return (
        f"{header}\n\n"
        "All dollar figures, peer comparisons, and counts must come from "
        "this context. Do not invent any number not present below.\n\n"
        "```json\n" + json.dumps(context, default=str, indent=2) + "\n```"
    )
