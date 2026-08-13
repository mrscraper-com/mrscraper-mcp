from mrscraper_mcp.content import convert_html, format_fetch_result, html_to_document


HTML = """
<html lang="en">
  <head>
    <title>Example Product</title>
    <meta name="description" content="A useful item">
    <script>window.secret = true</script>
  </head>
  <body>
    <h1>Example Product</h1>
    <a href="/buy">Buy now</a>
    <img src="/item.jpg" alt="Item">
  </body>
</html>
"""


def test_markdown_conversion_removes_scripts_and_resolves_links():
    markdown = convert_html(HTML, "markdown", "https://shop.example/item")
    assert "# Example Product" in markdown
    assert "https://shop.example/buy" in markdown
    assert "window.secret" not in markdown


def test_json_conversion_returns_clean_document():
    document = html_to_document(HTML, "https://shop.example/item")
    assert document == {
        "url": "https://shop.example/item",
        "title": "Example Product",
        "description": "A useful item",
        "language": "en",
        "text": "Example Product Buy now",
        "links": [
            {"text": "Buy now", "url": "https://shop.example/buy"},
        ],
        "images": [
            {"alt": "Item", "url": "https://shop.example/item.jpg"},
        ],
    }


def test_fetch_format_preserves_response_metadata():
    result = format_fetch_result(
        {
            "status_code": 200,
            "data": HTML,
            "headers": {"x-request-id": "one"},
            "unblocker": {"requested": "never"},
        },
        format="json",
        url="https://shop.example/item",
    )
    assert result["format"] == "json"
    assert result["url"] == "https://shop.example/item"
    assert result["data"]["title"] == "Example Product"
    assert result["headers"] == {"x-request-id": "one"}
