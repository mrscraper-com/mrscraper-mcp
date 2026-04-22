from typing import Literal

from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult

from mrscraper_mcp.job_runtime import JOB_STORE, async_tool_meta, plain_tool_meta


def register_job_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=plain_tool_meta(
            "Loading scraper job...",
            "Scraper job loaded.",
        ),
        annotations={
            "readOnlyHint": True,
            "idempotentHint": True,
            "openWorldHint": False,
            "destructiveHint": False,
        },
    )
    async def get_scrape_job(job_id: str) -> ToolResult:
        """
        Returns the current state of a background scraper job from a `*_job` tool, and
        when the job has finished, includes the full API `result` payload (same dict the
        synchronous tool would return: typically status_code, data, headers, error).

        Args:
            job_id: The `jobId` from the tool that started the job.

        Returns:
            ToolResult with structured_content: job fields, `found`, and when the job has
            finished the full API `result`. Includes `meta["job"]` when the job exists
            (same as the old status/result tools). This tool uses `plain_tool_meta` only
            here so its invocation does not open the job widget.

        Notes:
            - Jobs live in server memory and disappear after restart.
            - Prefer calling when the user follows up; avoid tight polling loops.
        """
        job = await JOB_STORE.get(job_id)
        if not job:
            payload = {
                "jobId": job_id,
                "found": False,
                "status": "not_found",
                "message": "Unknown job ID. Jobs are stored in memory and reset on server restart.",
                "isDone": True,
            }
            return ToolResult(
                content=payload["message"],
                structured_content=payload,
            )

        include_result = job.status in {"succeeded", "failed"}
        payload = job.to_dict(include_result=include_result)
        payload["found"] = True

        if job.status in {"queued", "running"}:
            return ToolResult(
                content=(
                    f"Job `{job.id}` is `{job.status}` with {job.progress}% progress."
                ),
                structured_content=payload,
                meta={"job": payload},
            )
        return ToolResult(
            content=f"Final result for job `{job.id}` is ready.",
            structured_content=payload,
            meta={"job": payload},
        )

    @mcp.tool(
        meta=async_tool_meta(
            "Listing recent jobs...",
            "Recent jobs loaded.",
        ),
        annotations={
            "readOnlyHint": True,
            "idempotentHint": True,
            "openWorldHint": False,
            "destructiveHint": False,
        },
    )
    async def list_scrape_jobs(
        limit: int = 20,
        status: Literal["queued", "running", "succeeded", "failed"] | None = None,
    ) -> ToolResult:
        """
        Lists recent in-memory jobs from this MCP process (newest first).

        Args:
            limit: Max jobs to return (capped by the server, default 20).
            status: Optional filter: queued, running, succeeded, or failed.

        Returns:
            ToolResult with structured_content: count and jobs[] (each entry matches
            `get_scrape_job`-style fields without full result bodies).

        Notes:
            - Useful for debugging or “what was running?” questions; not a substitute
              for MrScraper’s `get_all_results` API.
            - History is bounded and cleared on server restart.
        """
        jobs = await JOB_STORE.list_recent(limit=limit, status=status)
        payload = {
            "count": len(jobs),
            "jobs": [job.to_dict(include_result=False) for job in jobs],
        }
        return ToolResult(
            content=f"Found {len(jobs)} jobs.",
            structured_content=payload,
            meta={"jobs": payload["jobs"]},
        )
