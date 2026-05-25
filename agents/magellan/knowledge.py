"""Per-state pattern knowledge for Magellan.

Loads historical pattern success rates for a given state and reorders
candidate URL patterns by success_rate before probing. After each probe,
writes back hit/miss counts so the next run for that state is smarter.

All writes are idempotent via ON CONFLICT (agent, state_code, kind, key).
"""

from __future__ import annotations

import logging
from typing import Sequence

from .candidates import Candidate


logger = logging.getLogger(__name__)


AGENT = "magellan"
KIND_URL_PATTERN = "url_pattern"

# Patterns need at least this many attempts in a state before their
# learned success_rate overrides the static base confidence ordering.
MIN_ATTEMPTS_FOR_REORDER = 3

# Weight applied to success_rate when re-scoring candidates.
LEARNED_WEIGHT = 0.6


def load_state_patterns(conn, state_code: str) -> dict[str, float]:
    """Return {pattern: success_rate} for the given state.

    Patterns with zero attempts are omitted. Returned dict is unsorted;
    callers that need ordering should sort by value desc.
    """
    if not state_code:
        return {}
    out: dict[str, float] = {}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT key, hit_count, miss_count
            FROM agent_knowledge
            WHERE agent = %s AND state_code = %s AND kind = %s
            """,
            (AGENT, state_code, KIND_URL_PATTERN),
        )
        for key, hits, misses in cur.fetchall():
            attempts = (hits or 0) + (misses or 0)
            if attempts <= 0:
                continue
            out[key] = float(hits or 0) / attempts
    return out


def reorder_candidates_by_knowledge(
    candidates: Sequence[Candidate],
    knowledge: dict[str, float],
) -> list[Candidate]:
    """Move candidates with high historical success_rate to the front.

    Scoring: base_confidence + LEARNED_WEIGHT * (success_rate - 0.5).
    Patterns with no knowledge keep their base confidence. Patterns with
    a non-trivial learned rate (positive or negative) shift accordingly.
    Returns a new list; input is not mutated.
    """
    if not knowledge:
        return list(candidates)

    def score(c: Candidate) -> float:
        rate = knowledge.get(c.pattern)
        if rate is None:
            return c.confidence
        # Anchor around 0.5: rate > 0.5 boosts, rate < 0.5 penalises.
        return c.confidence + LEARNED_WEIGHT * (rate - 0.5)

    return sorted(candidates, key=score, reverse=True)


def record_pattern_outcome(
    conn,
    state_code: str | None,
    pattern: str,
    hit: bool,
    notes: dict | None = None,
) -> None:
    """Upsert into agent_knowledge — increment hit_count or miss_count.

    state_code may be None to record cross-state (national) knowledge.
    notes is shallow-merged into the existing JSONB.
    """
    if not pattern:
        return
    notes_payload = notes or {}
    import json

    with conn.cursor() as cur:
        if hit:
            cur.execute(
                """
                INSERT INTO agent_knowledge
                    (agent, state_code, key, kind, hit_count, miss_count,
                     last_hit_at, notes)
                VALUES (%s, %s, %s, %s, 1, 0, now(), %s::jsonb)
                ON CONFLICT (agent, state_code, kind, key) DO UPDATE
                  SET hit_count   = agent_knowledge.hit_count + 1,
                      last_hit_at = now(),
                      notes       = agent_knowledge.notes || EXCLUDED.notes,
                      updated_at  = now()
                """,
                (AGENT, state_code, pattern, KIND_URL_PATTERN,
                 json.dumps(notes_payload)),
            )
        else:
            cur.execute(
                """
                INSERT INTO agent_knowledge
                    (agent, state_code, key, kind, hit_count, miss_count,
                     last_miss_at, notes)
                VALUES (%s, %s, %s, %s, 0, 1, now(), %s::jsonb)
                ON CONFLICT (agent, state_code, kind, key) DO UPDATE
                  SET miss_count   = agent_knowledge.miss_count + 1,
                      last_miss_at = now(),
                      notes        = agent_knowledge.notes || EXCLUDED.notes,
                      updated_at   = now()
                """,
                (AGENT, state_code, pattern, KIND_URL_PATTERN,
                 json.dumps(notes_payload)),
            )
