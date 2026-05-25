"""CLI entrypoint for the Magellan agent.

Usage:
    python -m magellan run --seed
    python -m magellan run --limit 50
    python -m magellan run --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover -- optional dep
    load_dotenv = None

from .agent import run as run_agent


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="magellan",
        description="Magellan: discover fee-schedule URLs for institutions.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run_cmd = sub.add_parser("run", help="Run a discovery pass")
    run_cmd.add_argument(
        "--seed",
        action="store_true",
        help="Load the 22 SPEC.md seed institutions instead of querying the DB",
    )
    run_cmd.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum institutions to process this run",
    )
    run_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="Run discovery but write nothing to the DB",
    )
    run_cmd.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable DEBUG logging",
    )
    return parser


def _load_env() -> None:
    """Best-effort load of .env.local at the repo root."""
    if load_dotenv is None:
        return
    here = Path(__file__).resolve()
    # Walk up looking for .env.local up to repo root (max 5 levels).
    for parent in [here.parent, *here.parents][:6]:
        candidate = parent / ".env.local"
        if candidate.exists():
            load_dotenv(candidate)
            return


def main(argv: list[str] | None = None) -> int:
    _load_env()
    parser = _build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.command == "run":
        summary = asyncio.run(
            run_agent(seed=args.seed, limit=args.limit, dry_run=args.dry_run)
        )
        print(
            f"magellan run {summary['run_id']}: "
            f"processed={summary['processed']} found={summary['found']} mode={summary['mode']}"
        )
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
