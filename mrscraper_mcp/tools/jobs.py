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
        annotations={"readOnlyHint": True, "idempotentHint": True},
    )
    async def get_scrape_job_status(
        job_id: str,
        include_result: bool = False,
    ) -> ToolResult:
        """
        Get the current state of an asynchronous scraper job.

        Use this when a tool has returned a `job_id` and you need the latest job state.
        Returns progress and terminal status information. If the job has succeeded,
        `get_scrape_job_result(job_id)` can be used to retrieve the final structured result.
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
        annotations={"readOnlyHint": True, "idempotentHint": True},
    )
    async def get_scrape_job_result(
        job_id: str,
    ) -> ToolResult:
        """
        Get the final structured result of an asynchronous scraper job.

        Use this when a completed job's output is needed for downstream reasoning or
        follow-up tool calls. If the job is not finished, this returns the current job
        state without the final result payload.
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
        annotations={"readOnlyHint": True, "idempotentHint": True},
    )
    async def list_scrape_jobs(
        limit: int = 20,
        status: Literal["queued", "running", "succeeded", "failed"] | None = None,
    ) -> ToolResult:
        """
        Lists recent background scraper jobs for quick monitoring and troubleshooting.
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
