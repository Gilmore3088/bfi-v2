"""CLI entry point for Atlas.

Examples:
    python -m agents.atlas run --seed --dry-run -v
    python -m agents.atlas run --limit 50
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from agents.atlas.agent import AtlasAgent, DEFAULT_CONCURRENCY, DEFAULT_FRESHNESS_HOURS


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m agents.atlas",
        description="Atlas — fee schedule crawler",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Run one crawl pass over active URLs")
    run.add_argument("--seed", action="store_true", help="Use built-in demo URLs instead of DB")
    run.add_argument("--limit", type=int, default=50, help="Max URLs to process this run")
    run.add_argument("--dry-run", action="store_true", help="Fetch + store, but skip DB inserts")
    run.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help="Concurrent fetches (default %(default)s)",
    )
    run.add_argument(
        "--freshness-hours",
        type=int,
        default=DEFAULT_FRESHNESS_HOURS,
        help="Skip URLs fetched within this many hours (default %(default)s)",
    )
    run.add_argument("-v", "--verbose", action="count", default=0)
    return parser


def configure_logging(verbosity: int) -> None:
    level = logging.WARNING
    if verbosity == 1:
        level = logging.INFO
    elif verbosity >= 2:
        level = logging.DEBUG
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    configure_logging(getattr(args, "verbose", 0))

    if args.command == "run":
        agent = AtlasAgent(
            concurrency=args.concurrency,
            freshness_hours=args.freshness_hours,
            dry_run=args.dry_run,
        )
        result = agent.run(limit=args.limit, seed=args.seed)
        print(json.dumps(result.as_dict(), indent=2))
        # Partial success is success: only fail if NOTHING worked.
        # This lets the pipeline continue downstream when some URLs are dead
        # (which is normal for stale Magellan finds).
        if result.targets == 0:
            return 0  # nothing to do
        return 1 if result.stored == 0 and result.skipped == 0 else 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
