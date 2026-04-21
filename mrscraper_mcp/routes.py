from fastmcp import FastMCP
from starlette.requests import Request
from starlette.responses import PlainTextResponse

from mrscraper_mcp.constants import OPENAI_APPS_CHALLENGE_TOKEN


async def openai_apps_challenge(_request: Request) -> PlainTextResponse:
    return PlainTextResponse(OPENAI_APPS_CHALLENGE_TOKEN)


def register_routes(mcp: FastMCP) -> None:
    mcp.custom_route(path="/.well-known/openai-apps-challenge", methods=["GET"])(
        openai_apps_challenge
    )
