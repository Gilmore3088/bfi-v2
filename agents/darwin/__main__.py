"""CLI entrypoint for the Darwin agent.

Usage:
    python -m darwin drain [--limit N] [--dry-run] [-v]
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover -- optional dep
    load_dotenv = None

from .agent import drain


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="darwin",
        description="Darwin: classify fees_raw rows into the canonical taxonomy.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    drain_cmd = sub.add_parser("drain", help="Run one drain batch")
    drain_cmd.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum fees_raw rows to classify this run (default 100)",
    )
    drain_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="Run classification but write nothing to the DB",
    )
    drain_cmd.add_argument(
        "--state",
        type=str,
        default=None,
        help="Two-letter state code; scope drain to institutions in that state",
    )
    drain_cmd.add_argument(
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

    if args.command == "drain":
        state = (args.state or "").upper() or None
        summary = drain(limit=args.limit, dry_run=args.dry_run, state=state)
        print(
            f"darwin drain {summary['run_id']}: "
            f"processed={summary['processed']} "
            f"fees_extracted={summary.get('fees_extracted', 0)} "
            f"fees_auto_approved={summary.get('fees_auto_approved', 0)} "
            f"fees_pending={summary.get('fees_pending', 0)} "
            f"empty={summary.get('empty', 0)} "
            f"errors={summary.get('errors', 0)} "
            f"cost_cents={summary.get('cost_cents', 0)} "
            f"state={summary.get('state') or 'ALL'} "
            f"mode={summary['mode']}"
        )
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
