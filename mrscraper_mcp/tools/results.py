from typing import Literal
from urllib.parse import urlencode

from fastmcp import FastMCP

from mrscraper_mcp.auth import resolve_api_token
from mrscraper_mcp.constants import RESULTS
from mrscraper_mcp.http_helpers import api_get
from mrscraper_mcp.job_runtime import plain_tool_meta


def register_result_tools(mcp: FastMCP, *, chatgpt_plain_meta: bool = False) -> None:
    async def get_all_results(
        sort_field: Literal[
            "createdAt",
            "updatedAt",
            "id",
            "type",
            "url",
            "status",
            "error",
            "tokenUsage",
            "runtime",
        ] = "updatedAt",
        sort_order: Literal["ASC", "DESC"] = "DESC",
        page_size: int = 10,
        page: int = 1,
        search: str = None,
        date_range_column: str = None,
        start_at: str = None,
        end_at: str = None,
        token: str | None = None,
    ) -> dict:
        """
        Retrieves a paginated list of all scraping results with advanced filtering, sorting, and search capabilities.
        This tool allows you to browse, search, and filter all results from your scrapers, making it easy to
        find specific data or monitor scraping activity. Results are returned in pages for efficient handling
        of large datasets.

        Args:
            token: MrScraper API token (optional if set via MCP `Authorization` header or
                   `MRSCRAPER_API_TOKEN`)
            sort_field: Field name to sort results by (default: 'updatedAt').
                        Valid options: 'createdAt', 'updatedAt', 'id', 'type', 'url', 'status', 'error', 'tokenUsage', 'runtime'.
                        Use 'updatedAt' or 'createdAt' for time-based sorting, 'id' for ID-based sorting,
                        'url' for URL-based sorting, 'status' or 'error' for status-based sorting,
                        'tokenUsage' for token usage sorting, or 'runtime' for execution time sorting.
            sort_order: Sort direction, either 'ASC' for ascending or 'DESC' for descending (default: 'DESC').
            page_size: Number of results to return per page (default: 10).
                       Use smaller values (10-50) for faster responses, larger values (100-500) for bulk retrieval.
                       Maximum value may be limited by API constraints.
            page: Page number to retrieve, starting from 1 (default: 1).
                  Use this with page_size to paginate through all results.
                  Example: page=1 gets first page, page=2 gets second page, etc.
            search: Optional search query to filter results by text content (default: None).
                    Searches across result data fields. Leave as None to return all results.
                    Examples: "product", "2024", "example.com"
            date_range_column: Column name to use for date range filtering (default: None).
                               Must be set along with start_at and/or end_at to enable date filtering.
                               Common options: 'updatedAt', 'createdAt', 'scrapedAt'
                               Leave as None if not using date range filtering.
            start_at: Start date/time for date range filtering (default: None).
                      Format should match API expectations (typically ISO 8601: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS').
                      Only results with date_range_column >= start_at will be returned.
                      Requires date_range_column to be set. Leave as None to not filter by start date.
            end_at: End date/time for date range filtering (default: None).
                    Format should match API expectations (typically ISO 8601: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS').
                    Only results with date_range_column <= end_at will be returned.
                    Requires date_range_column to be set. Leave as None to not filter by end date.

        Returns:
            A dictionary containing:
            - status_code: HTTP status code of the response
            - data: Paginated results object containing:
                    - results: Array of result objects with extracted data, metadata, and IDs
                    - pagination: Information about total pages, current page, total results, etc.
                    - Each result includes fields like result ID, scraper ID, URL, extracted data, timestamps
            - headers: Response headers from the API
            - error: Error message if the request failed (if applicable)

        Example:
            Get the 20 most recently updated results from the last 7 days:
            get_all_results(
                token="MRSCRAPER_API_TOKEN",
                sort_field="updatedAt",
                sort_order="DESC",
                page_size=20,
                page=1,
                date_range_column="updatedAt",
                start_at="2024-01-01",
                end_at="2024-01-08"
            )

            Search for results containing "product" and sort by creation date:
            get_all_results(
                token="MRSCRAPER_API_TOKEN",
                search="product",
                sort_field="createdAt",
                sort_order="DESC",
                page_size=50
            )
        """
        api_token = resolve_api_token(token)
        headers = {
            "Content-Type": "application/json",
            "accept": "application/json",
            "x-api-token": api_token,
        }
        params = {
            "sortField": sort_field,
            "sortOrder": sort_order,
            "pageSize": page_size,
            "page": page,
        }
        if search:
            params["search"] = search
        if date_range_column:
            params["dateRangeColumn"] = date_range_column
        if start_at:
            params["startAt"] = start_at
        if end_at:
            params["endAt"] = end_at

        full_url = f"{RESULTS}?{urlencode(params)}"
        return await api_get(full_url, headers=headers)

    async def get_result_by_id(
        result_id: str,
        token: str | None = None,
    ) -> dict:
        """
        Retrieves detailed information for a specific scraping result by its unique result ID.
        This tool provides complete result data including all extracted fields, metadata, timestamps,
        and associated scraper information. Use this when you have a result ID (from get_all_results
        or scraper execution responses) and need the full details of that specific result.

        Args:
            result_id: The unique identifier of the result to retrieve (required).
            token: MrScraper API token (optional if set via MCP `Authorization` header or
                   `MRSCRAPER_API_TOKEN`)
                       Result IDs are returned from scraper runs (`rerun_ai_scraper`,
                       `bulk_rerun_ai_scraper`, `rerun_manual_scraper`, etc.) and inside
                       `get_all_results` rows.

        Returns:
            A dictionary containing:
            - status_code: HTTP status code of the response
            - data: Complete result object containing:
                    - result_id: The unique identifier for this result
                    - scraper_id: ID of the scraper that generated this result
                    - url: The URL that was scraped
                    - extracted_data: The actual data extracted by the scraper (structure depends on scraper configuration)
                    - metadata: Additional information like timestamps (createdAt, updatedAt), status, etc.
                    - Any other fields specific to the result type
            - headers: Response headers from the API
            - error: Error message if the request failed (if applicable)

        Example:
            Retrieve detailed information for a specific scraping result:
            get_result_by_id(
                token="MRSCRAPER_API_TOKEN",
                result_id="result_12345"
            )
        """
        endpoint_url = f"{RESULTS}/{result_id}"
        api_token = resolve_api_token(token)
        headers = {
            "Content-Type": "application/json",
            "accept": "application/json",
            "x-api-token": api_token,
        }
        return await api_get(endpoint_url, headers=headers)

    if chatgpt_plain_meta:
        mcp.tool(
            meta=plain_tool_meta(
                "Loading scraping results...", "Scraping results loaded."
            ),
            annotations={
                "readOnlyHint": True,
                "openWorldHint": False,
                "destructiveHint": False,
            },
        )(get_all_results)
        mcp.tool(
            meta=plain_tool_meta("Loading result details...", "Result details loaded."),
            annotations={
                "readOnlyHint": True,
                "openWorldHint": False,
                "destructiveHint": False,
            },
        )(get_result_by_id)
    else:
        mcp.tool(get_all_results)
        mcp.tool(get_result_by_id)
