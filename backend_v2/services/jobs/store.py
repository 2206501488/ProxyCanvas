from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VALID_STATUSES = {
    "queued",
    "submitting",
    "running",
    "saving",
    "succeeded",
    "failed",
    "cancelled",
    "timeout",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


class JobStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._init_db()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_db(self) -> None:
        with self._lock, self.connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    status TEXT NOT NULL,
                    prompt TEXT,
                    params_json TEXT NOT NULL,
                    input_images_json TEXT NOT NULL,
                    external_task_id TEXT,
                    progress INTEGER NOT NULL DEFAULT 0,
                    result_json TEXT NOT NULL DEFAULT '[]',
                    error TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    max_attempts INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS job_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL,
                    level TEXT NOT NULL,
                    message TEXT NOT NULL,
                    data_json TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at)")
            connection.execute("CREATE INDEX IF NOT EXISTS idx_job_events_job ON job_events(job_id, id)")
            connection.commit()

    def create_job(
        self,
        *,
        provider: str,
        prompt: str,
        params: dict[str, Any],
        input_images: list[dict[str, Any]] | None = None,
        max_attempts: int = 1,
    ) -> dict[str, Any]:
        job_id = uuid.uuid4().hex
        timestamp = now_iso()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id, provider, status, prompt, params_json, input_images_json,
                    progress, result_json, attempts, max_attempts,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    provider,
                    "queued",
                    prompt,
                    json_dumps(params),
                    json_dumps(input_images or []),
                    0,
                    "[]",
                    0,
                    max(1, int(max_attempts or 1)),
                    timestamp,
                    timestamp,
                ),
            )
            connection.commit()
        self.add_event(job_id, "info", "任务已创建", {"provider": provider})
        return self.get_job(job_id) or {"id": job_id, "status": "queued"}

    def claim_next_job(self, provider_limits: dict[str, int] | None = None) -> dict[str, Any] | None:
        provider_limits = provider_limits or {}
        with self._lock, self.connect() as connection:
            queued = connection.execute(
                "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 20"
            ).fetchall()
            for row in queued:
                provider = str(row["provider"])
                limit = int(provider_limits.get(provider, provider_limits.get("*", 1)))
                running = connection.execute(
                    "SELECT COUNT(*) FROM jobs WHERE provider = ? AND status IN ('submitting', 'running', 'saving')",
                    (provider,),
                ).fetchone()[0]
                if running >= limit:
                    continue
                timestamp = now_iso()
                updated = connection.execute(
                    """
                    UPDATE jobs
                    SET status = 'submitting', attempts = attempts + 1, started_at = COALESCE(started_at, ?), updated_at = ?
                    WHERE id = ? AND status = 'queued'
                    """,
                    (timestamp, timestamp, row["id"]),
                )
                if updated.rowcount:
                    connection.commit()
                    return self.get_job(row["id"])
            return None

    def update_job(self, job_id: str, **fields: Any) -> None:
        if not fields:
            return
        fields["updated_at"] = now_iso()
        if "status" in fields and fields["status"] not in VALID_STATUSES:
            raise ValueError(f"invalid job status: {fields['status']}")
        encoded = {key: self._encode_value(value) for key, value in fields.items()}
        assignments = ", ".join(f"{key} = ?" for key in encoded)
        values = list(encoded.values()) + [job_id]
        with self._lock, self.connect() as connection:
            connection.execute(f"UPDATE jobs SET {assignments} WHERE id = ?", values)
            connection.commit()

    def finish_job(self, job_id: str, status: str, *, result: list[dict[str, Any]] | None = None, error: str = "") -> None:
        if result is None:
            current = self.get_job(job_id)
            result = (current or {}).get("result") or []
        self.update_job(
            job_id,
            status=status,
            progress=100 if status == "succeeded" else 0,
            result_json=result,
            error=error,
            finished_at=now_iso(),
        )

    def add_event(self, job_id: str, level: str, message: str, data: Any = None) -> None:
        with self._lock, self.connect() as connection:
            connection.execute(
                "INSERT INTO job_events (job_id, level, message, data_json, created_at) VALUES (?, ?, ?, ?, ?)",
                (job_id, level, message, json_dumps(data) if data is not None else "", now_iso()),
            )
            connection.commit()

    def get_job(self, job_id: str, *, include_events: bool = False) -> dict[str, Any] | None:
        with self._lock, self.connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                return None
            item = self._row_to_dict(row)
            if include_events:
                events = connection.execute(
                    "SELECT * FROM job_events WHERE job_id = ? ORDER BY id ASC",
                    (job_id,),
                ).fetchall()
                item["events"] = [self._event_to_dict(event) for event in events]
            return item

    def list_jobs(self, *, status: str | None = None, active: bool = False, limit: int = 100) -> list[dict[str, Any]]:
        query = "SELECT * FROM jobs"
        params: list[Any] = []
        if active:
            query += " WHERE status IN ('queued', 'submitting', 'running', 'saving')"
        elif status:
            query += " WHERE status = ?"
            params.append(status)
        query += " ORDER BY updated_at DESC LIMIT ?"
        params.append(max(1, min(500, int(limit or 100))))
        with self._lock, self.connect() as connection:
            rows = connection.execute(query, params).fetchall()
            return [self._row_to_dict(row) for row in rows]

    def cancel_job(self, job_id: str) -> dict[str, Any] | None:
        job = self.get_job(job_id)
        if not job:
            return None
        if job["status"] in {"succeeded", "failed", "cancelled", "timeout"}:
            return job
        self.finish_job(job_id, "cancelled", error="cancelled by user")
        self.add_event(job_id, "warn", "任务已取消")
        return self.get_job(job_id)

    def retry_job(self, job_id: str) -> dict[str, Any] | None:
        job = self.get_job(job_id)
        if not job:
            return None
        timestamp = now_iso()
        with self._lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE jobs
                SET status = 'queued', error = '', progress = 0, external_task_id = NULL, finished_at = NULL, updated_at = ?
                WHERE id = ?
                """,
                (timestamp, job_id),
            )
            connection.commit()
        self.add_event(job_id, "info", "任务已重新排队")
        return self.get_job(job_id)

    def delete_job(self, job_id: str) -> dict[str, Any] | None:
        job = self.get_job(job_id)
        if not job:
            return None
        with self._lock, self.connect() as connection:
            connection.execute("DELETE FROM job_events WHERE job_id = ?", (job_id,))
            connection.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            connection.commit()
        return job

    def delete_jobs(self, *, include_active: bool = True) -> int:
        params: list[Any] = []
        where = ""
        if not include_active:
            where = " WHERE status NOT IN (?, ?, ?, ?)"
            params.extend(["queued", "submitting", "running", "saving"])

        with self._lock, self.connect() as connection:
            rows = connection.execute(f"SELECT id FROM jobs{where}", params).fetchall()
            job_ids = [row["id"] for row in rows]
            if not job_ids:
                return 0

            placeholders = ", ".join("?" for _ in job_ids)
            connection.execute(f"DELETE FROM job_events WHERE job_id IN ({placeholders})", job_ids)
            connection.execute(f"DELETE FROM jobs WHERE id IN ({placeholders})", job_ids)
            connection.commit()
            return len(job_ids)

    def mark_interrupted_jobs(self, *, error: str = "backend restarted before job finished") -> int:
        timestamp = now_iso()
        with self._lock, self.connect() as connection:
            rows = connection.execute(
                "SELECT id FROM jobs WHERE status IN ('submitting', 'running', 'saving')"
            ).fetchall()
            if not rows:
                return 0
            connection.execute(
                """
                UPDATE jobs
                SET status = 'failed', error = ?, finished_at = ?, updated_at = ?
                WHERE status IN ('submitting', 'running', 'saving')
                """,
                (error, timestamp, timestamp),
            )
            connection.commit()
        for row in rows:
            self.add_event(row["id"], "error", "任务被后端重启中断", {"error": error})
        return len(rows)

    def _encode_value(self, value: Any) -> Any:
        if isinstance(value, (dict, list)):
            return json_dumps(value)
        return value

    def _row_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["params"] = json_loads(item.pop("params_json", ""), {})
        item["input_images"] = json_loads(item.pop("input_images_json", ""), [])
        item["result"] = json_loads(item.pop("result_json", ""), [])
        item["job_id"] = item["id"]
        return item

    def _event_to_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["data"] = json_loads(item.pop("data_json", ""), None)
        return item
