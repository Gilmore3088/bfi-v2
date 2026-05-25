"""Magellan agent: discovers fee-schedule URLs for institutions.

First of the bfi-v2 five-agent fleet. Reads institutions from Postgres,
generates fee-schedule URL candidates from known site patterns, probes
each candidate over HTTP, and records findings.

Public surface:
    from magellan.agent import run, run_for_institution
    from magellan.candidates import generate_candidates
"""

__version__ = "0.1.0"
