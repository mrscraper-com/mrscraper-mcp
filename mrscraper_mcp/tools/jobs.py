from typing import Literal

from fastmcp import FastMCP
from fastmcp.tools.tool import ToolResult

from mrscraper_mcp.job_runtime import JOB_STORE, async_tool_meta


def register_job_tools(mcp: FastMCP) -> None:
    @mcp.tool(
        meta=async_tool_meta(
            "Checking scraper job...",
            "Scraper job status loaded.",
        ),
        annotations={
            "readOnlyHint": True,
            "idempotentHint": True,
            "openWorldHint": False,
            "destructiveHint": False,
        },
    )
    async def get_scrape_job_status(
        job_id: str,
        include_result: bool = False,
    ) -> ToolResult:
        """
        Returns the latest state of a background scraper job created by a `*_job` tool.

        Args:
            job_id: The `jobId` value from the tool that started the job.
            include_result: If True and the job finished, may embed result summary fields;
                usually leave False and call `get_scrape_job_result` for the full payload.

        Returns:
            ToolResult with structured_content including jobId, toolName, status (queued |
            running | succeeded | failed), progress (0–100), message, timestamps,
            inputPreview, isDone, and optionally truncated result hints.

        Notes:
            - Jobs live in server memory and disappear after restart.
            - Call when the user returns to the thread or asks for status—not on a tight timer.
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

        payload = job.to_dict(include_result=include_result)
        payload["found"] = True
        return ToolResult(
            content=(
                f"Job `{job.id}` is `{job.status}` with {job.progress}% progress."
                if job.status in {"queued", "running"}
                else f"Job `{job.id}` completed with status `{job.status}`."
            ),
            structured_content=payload,
            meta={"job": payload},
        )

    @mcp.tool(
        meta=async_tool_meta(
            "Loading scraper result...",
            "Scraper result loaded.",
        ),
        annotations={
            "readOnlyHint": True,
            "idempotentHint": True,
            "openWorldHint": False,
            "destructiveHint": False,
        },
    )
    async def get_scrape_job_result(
        job_id: str,
    ) -> ToolResult:
        """
        Fetches the completed output for a background job (same dict the synchronous
        counterpart tool would have returned: typically status_code, data, headers, error).

        Args:
            job_id: The `jobId` from the job-starting tool.

        Returns:
            If still queued or running: ToolResult explaining that the result is not ready,
            with current job state in structured_content.
            If succeeded or failed: ToolResult whose structured_content includes the full
            `result` object from the MrScraper API call.

        Notes:
            - Prefer invoking after `get_scrape_job_status` shows isDone or when the user
              asks for scraped output.
            - Avoid polling this in a loop; jobs can run for minutes.
        """
        job = await JOB_STORE.get(job_id)
        if not job:
            return ToolResult(
                content="Unknown job ID. Jobs are in-memory and cleared after server restarts.",
                structured_content={
                    "jobId": job_id,
                    "found": False,
                    "status": "not_found",
                    "isDone": True,
                },
            )
        if job.status in {"queued", "running"}:
            return ToolResult(
                content="Result is not ready yet. Poll get_scrape_job_status until it finishes.",
                structured_content=job.to_dict(include_result=False),
                meta={"job": job.to_dict(include_result=False)},
            )
        return ToolResult(
            content=f"Final result for job `{job.id}` is ready.",
            structured_content=job.to_dict(include_result=True),
            meta={"job": job.to_dict(include_result=True)},
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
            `get_scrape_job_status`-style fields without full result bodies).

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
