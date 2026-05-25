"""Knox CLI entry point.

Usage:
    python -m knox review [--limit N] [--dry-run] [-v]
"""

from __future__ import annotations

import argparse
import logging
import sys

from dotenv import load_dotenv

from .agent import review


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="knox",
        description="Adversarial reviewer agent for Bank Fee Index v2.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    review_cmd = subparsers.add_parser(
        "review",
        help="Run one Knox review pass over fees_verified rows.",
    )
    review_cmd.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Maximum number of fees_verified rows to examine (default: 500).",
    )
    review_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute findings but do not write to agent_events.",
    )
    review_cmd.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable debug logging.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = _build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.command == "review":
        summary = review(limit=args.limit, dry_run=args.dry_run)
        print(
            f"examined={summary['rows_examined']} "
            f"findings={summary['findings']} "
            f"emitted={summary['events_emitted']} "
            f"skipped_dup={summary['events_skipped_dup']}"
        )
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
