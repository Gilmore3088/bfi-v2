"""Atlas orchestration.

Selects active institution_urls that haven't been fetched in the last
24 hours, downloads them concurrently, stores raw bytes in R2 (or
stubs), and writes one fees_raw row per fetch. Idempotent on
(institution_id, content_hash).
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from typing import Iterable, Optional

import httpx

from agents.atlas.extractor import extract_text
from agents.atlas.fetcher import DEFAULT_TIMEOUT, DEFAULT_USER_AGENT, FetchResult, fetch_url
from agents.atlas.storage import StoredObject, put_object, r2_configured
from agents.atlas.validator import validate_text

logger = logging.getLogger(__name__)

EXTRACTOR_VERSION = "atlas-0.1.0"
DEFAULT_CONCURRENCY = 4
DEFAULT_FRESHNESS_HOURS = 24


@dataclass
class CrawlTarget:
    institution_id: int
    url: str


@dataclass
class AtlasResult:
    targets: int = 0
    fetched: int = 0
    stored: int = 0
    inserted: int = 0
    skipped: int = 0
    failed: int = 0
    stub_uploads: int = 0
    validation_rejected: int = 0
    validation_breakdown: dict = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    run_id: str | None = None

    def as_dict(self) -> dict:
        return {
            "targets": self.targets,
            "fetched": self.fetched,
            "stored": self.stored,
            "inserted": self.inserted,
            "skipped": self.skipped,
            "failed": self.failed,
            "stub_uploads": self.stub_uploads,
            "validation_rejected": self.validation_rejected,
            "validation_breakdown": dict(self.validation_breakdown),
            "errors": self.errors,
        }


SELECT_TARGETS_SQL = """
SELECT iu.institution_id, iu.url
FROM institution_urls iu
WHERE iu.is_active = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM fees_raw fr
    WHERE fr.source_url = iu.url
      AND fr.extracted_at > now() - (%s || ' hours')::interval
  )
ORDER BY iu.institution_id
LIMIT %s
"""

INSERT_FEES_RAW_SQL = """
INSERT INTO fees_raw (
    institution_id, source_url, r2_key, raw_text, raw_payload,
    extractor_version, content_hash
)
VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s)
ON CONFLICT (institution_id, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
RETURNING id
"""


class AtlasAgent:
    def __init__(
        self,
        *,
        dsn: Optional[str] = None,
        concurrency: int = DEFAULT_CONCURRENCY,
        freshness_hours: int = DEFAULT_FRESHNESS_HOURS,
        user_agent: str = DEFAULT_USER_AGENT,
        dry_run: bool = False,
    ) -> None:
        self.dsn = dsn or os.environ.get("DATABASE_URL")
        self.concurrency = max(1, concurrency)
        self.freshness_hours = freshness_hours
        self.user_agent = user_agent
        self.dry_run = dry_run

    # --- target selection -------------------------------------------------

    def fetch_targets(self, limit: int) -> list[CrawlTarget]:
        if not self.dsn:
            raise RuntimeError("DATABASE_URL is not set")
        import psycopg2  # local import to keep tests lightweight

        with psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(SELECT_TARGETS_SQL, (str(self.freshness_hours), limit))
            return [CrawlTarget(institution_id=row[0], url=row[1]) for row in cur.fetchall()]

    def seed_targets(self, limit: int) -> list[CrawlTarget]:
        """Static demo set used when --seed is passed; safe for local dry-runs."""
        demo = [
            (1, "https://example.com/fee-schedule.html"),
            (2, "https://example.org/fees.pdf"),
        ]
        return [CrawlTarget(i, u) for i, u in demo[:limit]]

    # --- main loop --------------------------------------------------------

    async def run_async(
        self,
        *,
        targets: Optional[Iterable[CrawlTarget]] = None,
        limit: int = 50,
        seed: bool = False,
    ) -> AtlasResult:
        import uuid as _uuid
        import psycopg2
        result = AtlasResult()
        run_id = _uuid.uuid4()
        result.run_id = str(run_id)

        # Record agent_runs row upfront so live dashboards reflect activity.
        if self.dsn:
            try:
                with psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO agent_runs (run_id, agent, status, trigger_source) "
                        "VALUES (%s, 'atlas', 'in_progress', 'manual') "
                        "ON CONFLICT (run_id) DO NOTHING",
                        (str(run_id),),
                    )
                    conn.commit()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Atlas: failed to insert agent_runs row: %s", exc)

        try:
            if targets is None:
                targets = self.seed_targets(limit) if seed else self.fetch_targets(limit)
            targets = list(targets)
            result.targets = len(targets)

            if not targets:
                logger.info("Atlas: no targets to crawl")
                return result

            if not r2_configured():
                logger.info("Atlas: R2 not configured — running in STUB upload mode")

            sem = asyncio.Semaphore(self.concurrency)
            async with httpx.AsyncClient(
                timeout=DEFAULT_TIMEOUT,
                follow_redirects=True,
                headers={"User-Agent": self.user_agent},
            ) as client:
                async def process(t: CrawlTarget) -> None:
                    async with sem:
                        await self._process_target(t, client, result)

                await asyncio.gather(*(process(t) for t in targets), return_exceptions=False)

            return result
        finally:
            # Finalize the run row regardless of success/failure.
            if self.dsn:
                try:
                    has_failures = result.failed > 0 and result.stored == 0
                    final_status = "failed" if has_failures and result.targets > 0 else "succeeded"
                    with psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
                        cur.execute(
                            "UPDATE agent_runs SET status=%s, ended_at=now(), "
                            "items_processed=%s, items_failed=%s "
                            "WHERE run_id=%s",
                            (final_status, result.stored, result.failed, str(run_id)),
                        )
                        conn.commit()
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Atlas: failed to update agent_runs row: %s", exc)

    def run(self, **kwargs) -> AtlasResult:
        return asyncio.run(self.run_async(**kwargs))

    # --- per-target -------------------------------------------------------

    async def _process_target(
        self,
        target: CrawlTarget,
        client: httpx.AsyncClient,
        result: AtlasResult,
    ) -> None:
        try:
            fetched = await fetch_url(target.url, user_agent=self.user_agent, client=client)
        except Exception as exc:  # noqa: BLE001
            result.failed += 1
            msg = f"fetch failed institution={target.institution_id} url={target.url}: {exc}"
            logger.warning(msg)
            result.errors.append(msg)
            return

        result.fetched += 1
        if fetched.http_status >= 400:
            result.failed += 1
            result.errors.append(
                f"http {fetched.http_status} institution={target.institution_id} url={target.url}"
            )
            return

        stored = put_object(
            institution_id=target.institution_id,
            content=fetched.content,
            content_hash=fetched.content_hash,
            extension=fetched.extension,
        )
        result.stored += 1
        if stored.stub:
            result.stub_uploads += 1

        raw_text = extract_text(fetched.content, fetched.extension)
        payload = self._build_payload(target, fetched, stored)

        validation = validate_text(raw_text, fetched.content_type)
        payload["validation_reason"] = validation.reason
        payload["validation_score"] = validation.score
        if not validation.is_fee_schedule:
            result.skipped += 1
            result.validation_rejected += 1
            result.validation_breakdown[validation.reason] = (
                result.validation_breakdown.get(validation.reason, 0) + 1
            )
            logger.warning(
                "Atlas: skipping non-fee content institution=%s url=%s reason=%s score=%.2f",
                target.institution_id,
                target.url,
                validation.reason,
                validation.score,
            )
            return

        if self.dry_run:
            result.skipped += 1
            logger.info(
                "DRY-RUN: would insert fees_raw institution=%s key=%s hash=%s",
                target.institution_id,
                stored.key,
                fetched.content_hash[:12],
            )
            return

        inserted = self._insert_fees_raw(
            institution_id=target.institution_id,
            source_url=target.url,
            r2_key=stored.key,
            raw_text=raw_text,
            payload=payload,
            content_hash=fetched.content_hash,
        )
        if inserted:
            result.inserted += 1
        else:
            result.skipped += 1

    def _build_payload(
        self,
        target: CrawlTarget,
        fetched: FetchResult,
        stored: StoredObject,
    ) -> dict:
        return {
            "fetched_at": None,  # DB sets extracted_at via DEFAULT now()
            "final_url": fetched.url,
            "http_status": fetched.http_status,
            "content_type": fetched.content_type,
            "content_length": fetched.content_length,
            "extension": fetched.extension,
            "stub_upload": stored.stub,
        }

    def _insert_fees_raw(
        self,
        *,
        institution_id: int,
        source_url: str,
        r2_key: str,
        raw_text: Optional[str],
        payload: dict,
        content_hash: str,
    ) -> bool:
        import json

        import psycopg2

        if not self.dsn:
            raise RuntimeError("DATABASE_URL is not set")

        with psycopg2.connect(self.dsn) as conn, conn.cursor() as cur:
            cur.execute(
                INSERT_FEES_RAW_SQL,
                (
                    institution_id,
                    source_url,
                    r2_key,
                    raw_text,
                    json.dumps(payload),
                    EXTRACTOR_VERSION,
                    content_hash,
                ),
            )
            row = cur.fetchone()
            conn.commit()
            return row is not None
