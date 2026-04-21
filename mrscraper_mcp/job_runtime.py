"""In-memory async job runtime for long-running tool calls."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from fastmcp.tools.tool import ToolResult

from mrscraper_mcp.constants import MAX_ASYNC_JOB_HISTORY, SCRAPE_JOB_WIDGET_URI

JobStatus = Literal["queued", "running", "succeeded", "failed"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _truncate_text(text: str, max_len: int = 250) -> str:
    if len(text) <= max_len:
        return text
    return f"{text[: max_len - 3]}..."


@dataclass
class JobRecord:
    id: str
    tool_name: str
    status: JobStatus
    progress: int
    created_at: str
    updated_at: str
    input_preview: dict[str, Any]
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    result: dict[str, Any] | None = None
    message: str | None = None
    history: list[str] = field(default_factory=list)

    def to_dict(self, *, include_result: bool = False) -> dict[str, Any]:
        data: dict[str, Any] = {
            "jobId": self.id,
            "toolName": self.tool_name,
            "status": self.status,
            "progress": self.progress,
            "message": self.message or "",
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "error": self.error,
            "inputPreview": self.input_preview,
            "history": self.history[-12:],
            "isDone": self.status in {"succeeded", "failed"},
        }
        if include_result:
            data["result"] = self.result
        elif self.result is not None:
            data["resultStatusCode"] = self.result.get("status_code")
            data["resultHasError"] = bool(self.result.get("error"))
        return data


class AsyncJobStore:
    """Simple in-memory async job queue.

    Jobs are process-local and are cleared when the MCP server restarts.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._jobs: dict[str, JobRecord] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}

    async def enqueue(
        self,
        *,
        tool_name: str,
        input_preview: dict[str, Any],
        work: Awaitable[dict[str, Any]],
    ) -> JobRecord:
        now = _now_iso()
        job = JobRecord(
            id=str(uuid4()),
            tool_name=tool_name,
            status="queued",
            progress=0,
            created_at=now,
            updated_at=now,
            input_preview=input_preview,
            message="Queued for execution.",
            history=["Queued"],
        )
        async with self._lock:
            self._jobs[job.id] = job
            self._prune_locked()

        task = asyncio.create_task(self._run_job(job.id, work))
        self._tasks[job.id] = task
        task.add_done_callback(lambda _done: self._tasks.pop(job.id, None))
        return job

    async def _run_job(self, job_id: str, work: Awaitable[dict[str, Any]]) -> None:
        await self._update(job_id, status="running", progress=8, message="Job started.")
        try:
            result = await work
            error = result.get("error")
            status: JobStatus = "failed" if error else "succeeded"
            message = (
                "Job failed. Check error details."
                if error
                else "Job finished successfully."
            )
            await self._complete(
                job_id=job_id,
                status=status,
                result=result,
                error=_truncate_text(str(error), 500) if error else None,
                message=message,
            )
        except Exception as exc:  # pragma: no cover - defensive fallback
            await self._complete(
                job_id=job_id,
                status="failed",
                result=None,
                error=_truncate_text(str(exc), 500),
                message="Unhandled exception in background task.",
            )

    async def _update(
        self,
        job_id: str,
        *,
        status: JobStatus | None = None,
        progress: int | None = None,
        message: str | None = None,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = max(0, min(100, progress))
            if message is not None:
                job.message = message
                job.history.append(message)
            now = _now_iso()
            if status == "running" and not job.started_at:
                job.started_at = now
            job.updated_at = now

    async def _complete(
        self,
        *,
        job_id: str,
        status: JobStatus,
        result: dict[str, Any] | None,
        error: str | None,
        message: str,
    ) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            job.status = status
            job.progress = 100
            job.result = result
            job.error = error
            job.message = message
            job.history.append(message)
            now = _now_iso()
            job.updated_at = now
            job.finished_at = now

    async def get(self, job_id: str) -> JobRecord | None:
        async with self._lock:
            return self._jobs.get(job_id)

    async def list_recent(
        self,
        *,
        limit: int = 20,
        status: JobStatus | None = None,
    ) -> list[JobRecord]:
        async with self._lock:
            jobs = list(self._jobs.values())
        if status:
            jobs = [job for job in jobs if job.status == status]
        jobs.sort(key=lambda item: item.updated_at, reverse=True)
        return jobs[: max(1, min(limit, 100))]

    def _prune_locked(self) -> None:
        if len(self._jobs) <= MAX_ASYNC_JOB_HISTORY:
            return
        # Remove oldest finished jobs first to keep memory bounded.
        removable = sorted(
            (
                job
                for job in self._jobs.values()
                if job.status in {"succeeded", "failed"}
            ),
            key=lambda job: job.updated_at,
        )
        for job in removable:
            if len(self._jobs) <= MAX_ASYNC_JOB_HISTORY:
                return
            self._jobs.pop(job.id, None)


JOB_STORE = AsyncJobStore()


def async_tool_meta(
    invoking: str,
    invoked: str,
    *,
    visibility: list[str] | None = None,
) -> dict[str, Any]:
    effective_visibility = visibility or ["model", "app"]
    return {
        "ui": {
            "resourceUri": SCRAPE_JOB_WIDGET_URI,
            "visibility": effective_visibility,
        },
        "openai/outputTemplate": SCRAPE_JOB_WIDGET_URI,
        "openai/widgetAccessible": True,
        "openai/visibility": "private" if effective_visibility == ["app"] else "public",
        "openai/toolInvocation/invoking": invoking,
        "openai/toolInvocation/invoked": invoked,
    }


def plain_tool_meta(
    invoking: str,
    invoked: str,
    *,
    visibility: list[str] | None = None,
) -> dict[str, Any]:
    """ChatGPT Apps meta for tools that return JSON only (no job status widget)."""
    effective_visibility = visibility or ["model", "app"]
    return {
        "openai/visibility": "private" if effective_visibility == ["app"] else "public",
        "openai/toolInvocation/invoking": invoking,
        "openai/toolInvocation/invoked": invoked,
    }


def build_queued_tool_result(job: JobRecord) -> ToolResult:
    structured = {
        "jobId": job.id,
        "toolName": job.tool_name,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "isDone": False,
    }
    return ToolResult(
        content=(f"Started background job `{job.id}` for `{job.tool_name}`."),
        structured_content=structured,
        meta={
            "job": job.to_dict(include_result=False),
            "widgetPolling": {
                "tool": "get_scrape_job",
                "recommendedPollSeconds": 3,
            },
        },
    )
