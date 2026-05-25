"""Hamilton agent: LLM research analyst for Bank Fee Index.

Fifth of the bfi-v2 five-agent fleet. Generates three report kinds —
institution profile, category deep-dive, and peer benchmark — from the
verified fee data in Postgres. Output is markdown persisted to the
``reports`` table; voice constraints from CMO.md and the editorial gate
from OPERATIONS_MANAGER.md are enforced post-render.

Public surface:
    from hamilton.agent import HamiltonAgent, ReportRequest, ReportResult, run
    from hamilton.prompts import check_voice, system_prompt_for
    from hamilton.data import build_institution_context
"""

__version__ = "0.1.0"
