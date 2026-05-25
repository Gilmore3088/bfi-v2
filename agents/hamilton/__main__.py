"""CLI entrypoint for the Hamilton agent.

Usage:
    python -m hamilton generate --type institution --target jpmorgan-chase
    python -m hamilton generate --type category --target overdraft
    python -m hamilton generate --type peer --target jpmorgan-chase --peers bank-of-america,wells-fargo
    python -m hamilton generate --type institution --target jpmorgan-chase --dry-run -v
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

from .agent import run as run_agent


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hamilton",
        description="Hamilton: LLM research analyst for Bank Fee Index.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="Generate a report")
    gen.add_argument(
        "--type",
        choices=["institution", "category", "peer"],
        required=True,
        help="Report kind",
    )
    gen.add_argument(
        "--target",
        required=True,
        help="Subject slug (institution) or canonical category name",
    )
    gen.add_argument(
        "--peers",
        default="",
        help="Comma-separated peer slugs (peer kind only)",
    )
    gen.add_argument(
        "--requested-by",
        default=None,
        help="Username or system identifier requesting the report",
    )
    gen.add_argument(
        "--dry-run",
        action="store_true",
        help="Render and validate but do not write to the DB",
    )
    gen.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable DEBUG logging",
    )
    gen.add_argument(
        "--print-body",
        action="store_true",
        help="Print the rendered markdown body to stdout after the summary line",
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
        level=logging.DEBUG if getattr(args, "verbose", False) else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    if args.command == "generate":
        peers: tuple[str, ...] = tuple(
            p.strip() for p in args.peers.split(",") if p.strip()
        )
        if args.type == "peer" and not peers:
            parser.error("peer reports require --peers a,b,c")

        try:
            summary = run_agent(
                kind=args.type,
                target=args.target,
                peers=peers,
                requested_by=args.requested_by,
                dry_run=args.dry_run,
            )
        except Exception as exc:  # noqa: BLE001
            logging.exception("hamilton: run failed")
            print(f"hamilton: ERROR: {exc}", file=sys.stderr)
            return 2

        print(
            f"hamilton report {summary['report_id']}: "
            f"kind={summary['kind']} target={summary['target']} "
            f"status={summary['status']} cost_cents={summary['cost_cents']} "
            f"mode={summary['mode']}"
        )
        if summary["violations"]:
            print(
                "  editorial violations: " + "; ".join(summary["violations"]),
                file=sys.stderr,
            )
        if args.print_body:
            # Re-render to get the body; cheap and avoids returning huge dicts.
            from .agent import HamiltonAgent, ReportRequest

            agent = HamiltonAgent()
            req = ReportRequest(
                kind=args.type,
                target=args.target,
                peers=peers,
                requested_by=args.requested_by,
            )
            result = agent.generate(req, dry_run=True)
            print()
            print(result.body)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
