"""Statistical outlier detection.

Per-category median + IQR. A fee amount is flagged as an outlier when it
falls outside ``[Q1 - k*IQR, Q3 + k*IQR]`` for its (category, charter)
cohort. Default ``k = 3.0`` matches the contract in TECHNICAL_ARCHITECT.md.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np

DEFAULT_K = 3.0
MIN_COHORT_SIZE = 8


@dataclass(frozen=True)
class OutlierBounds:
    """Bounds used to decide whether an observation is a statistical outlier."""

    category: str
    charter_type: str
    n: int
    median: float
    q1: float
    q3: float
    iqr: float
    lower: float
    upper: float

    def is_outlier(self, amount: float) -> bool:
        return amount < self.lower or amount > self.upper


def compute_bounds(
    amounts: Iterable[float],
    category: str,
    charter_type: str,
    k: float = DEFAULT_K,
) -> OutlierBounds | None:
    """Compute IQR-based bounds for a single (category, charter) cohort.

    Returns ``None`` when the cohort is too small to be meaningful.
    """
    arr = np.asarray([a for a in amounts if a is not None], dtype=float)
    if arr.size < MIN_COHORT_SIZE:
        return None

    q1 = float(np.percentile(arr, 25))
    q3 = float(np.percentile(arr, 75))
    median = float(np.median(arr))
    iqr = q3 - q1
    lower = q1 - k * iqr
    upper = q3 + k * iqr
    return OutlierBounds(
        category=category,
        charter_type=charter_type,
        n=int(arr.size),
        median=median,
        q1=q1,
        q3=q3,
        iqr=iqr,
        lower=lower,
        upper=upper,
    )


def build_bounds_index(
    rows: Iterable[dict],
    k: float = DEFAULT_K,
) -> dict[tuple[str, str], OutlierBounds]:
    """Group ``rows`` by ``(fee_category, charter_type)`` and compute bounds.

    Each row must expose ``fee_category``, ``charter_type``, and ``amount``.
    """
    cohorts: dict[tuple[str, str], list[float]] = {}
    for row in rows:
        category = row.get("fee_category")
        charter = row.get("charter_type")
        amount = row.get("amount")
        if not category or not charter or amount is None:
            continue
        cohorts.setdefault((category, charter), []).append(float(amount))

    index: dict[tuple[str, str], OutlierBounds] = {}
    for (category, charter), amounts in cohorts.items():
        bounds = compute_bounds(amounts, category, charter, k=k)
        if bounds is not None:
            index[(category, charter)] = bounds
    return index
