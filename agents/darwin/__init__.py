"""Darwin agent: classifies fee content into the canonical 49-category taxonomy.

Third of the bfi-v2 five-agent fleet. Drains `fees_raw` rows that have not yet
been classified, calls Claude (or a deterministic stub when no API key is set),
validates the predicted category against the frozen taxonomy whitelist, and
writes `fees_verified` rows. Maintains price-change history via the
`superseded_by` chain.

Public surface:
    from darwin.agent import drain
    from darwin.taxonomy import CANONICAL_CATEGORIES, is_canonical
    from darwin.classifier import classify, Classification
"""

__version__ = "0.1.0"
