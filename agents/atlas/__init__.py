"""Atlas — fee schedule crawler agent.

Reads active fee-schedule URLs from institution_urls, fetches HTML/PDF
content via httpx, stores raw bytes in R2 (or stubs if no creds), and
writes one fees_raw row per fetch for Darwin to classify downstream.

No LLM extraction is performed here. Atlas is the I/O boundary; Darwin
is the cognition boundary.
"""

__all__ = ["AtlasAgent", "AtlasResult"]


def __getattr__(name):  # lazy re-export to avoid import cycles at package load
    if name in __all__:
        from agents.atlas.agent import AtlasAgent, AtlasResult

        return {"AtlasAgent": AtlasAgent, "AtlasResult": AtlasResult}[name]
    raise AttributeError(name)
