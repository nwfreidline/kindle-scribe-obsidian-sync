"""OneNote API client and HTML-to-Markdown converter."""

import json
import re
from urllib.request import Request, urlopen

from .config import MS_GRAPH_URL


class OneNoteClient:
    """Client for Microsoft Graph OneNote API."""

    def __init__(self, get_token):
        self._get_token = get_token

    def list_notebooks(self) -> list[dict]:
        """List all OneNote notebooks."""
        data = self._graph_get("/me/onenote/notebooks")
        return data.get("value", [])

    def list_sections(self, notebook_id: str) -> list[dict]:
        """List sections in a notebook."""
        data = self._graph_get(f"/me/onenote/notebooks/{notebook_id}/sections")
        return data.get("value", [])

    def list_pages(self, section_id: str) -> list[dict]:
        """List pages in a section."""
        data = self._graph_get(f"/me/onenote/sections/{section_id}/pages")
        return data.get("value", [])

    def get_page_content(self, page_id: str) -> str:
        """Get the HTML content of a page."""
        return self._graph_get_html(f"/me/onenote/pages/{page_id}/content")

    def _graph_get(self, endpoint: str) -> dict:
        """Make an authenticated GET request returning JSON."""
        url = f"{MS_GRAPH_URL}{endpoint}"
        req = Request(url)
        req.add_header("Authorization", f"Bearer {self._get_token()}")
        req.add_header("Content-Type", "application/json")

        with urlopen(req) as resp:
            return json.loads(resp.read())

    def _graph_get_html(self, endpoint: str) -> str:
        """Make an authenticated GET request returning HTML."""
        url = f"{MS_GRAPH_URL}{endpoint}"
        req = Request(url)
        req.add_header("Authorization", f"Bearer {self._get_token()}")
        req.add_header("Accept", "text/html")

        with urlopen(req) as resp:
            return resp.read().decode("utf-8")


def html_to_markdown(html: str) -> str:
    """Convert OneNote HTML content to clean Markdown."""
    md = html

    # Remove XML declaration and head section
    md = re.sub(r"<\?xml[^>]*\?>", "", md, flags=re.IGNORECASE)
    md = re.sub(r"<head[^>]*>[\s\S]*?</head>", "", md, flags=re.IGNORECASE)
    md = re.sub(r"</?html[^>]*>", "", md, flags=re.IGNORECASE)
    md = re.sub(r"</?body[^>]*>", "", md, flags=re.IGNORECASE)

    # Convert headings
    md = re.sub(r"<h1[^>]*>([\s\S]*?)</h1>", r"# \1\n\n", md, flags=re.IGNORECASE)
    md = re.sub(r"<h2[^>]*>([\s\S]*?)</h2>", r"## \1\n\n", md, flags=re.IGNORECASE)
    md = re.sub(r"<h3[^>]*>([\s\S]*?)</h3>", r"### \1\n\n", md, flags=re.IGNORECASE)
    md = re.sub(r"<h4[^>]*>([\s\S]*?)</h4>", r"#### \1\n\n", md, flags=re.IGNORECASE)

    # Convert bold and italic
    md = re.sub(r"<(strong|b)[^>]*>([\s\S]*?)</(strong|b)>", r"**\2**", md, flags=re.IGNORECASE)
    md = re.sub(r"<(em|i)[^>]*>([\s\S]*?)</(em|i)>", r"*\2*", md, flags=re.IGNORECASE)
    md = re.sub(r"<u[^>]*>([\s\S]*?)</u>", r"\1", md, flags=re.IGNORECASE)

    # Convert lists
    md = re.sub(r"<li[^>]*>([\s\S]*?)</li>", r"- \1\n", md, flags=re.IGNORECASE)
    md = re.sub(r"</?[ou]l[^>]*>", "\n", md, flags=re.IGNORECASE)

    # Convert links
    md = re.sub(r'<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)</a>', r"[\2](\1)", md, flags=re.IGNORECASE)

    # Convert line breaks and paragraphs
    md = re.sub(r"<br\s*/?>", "\n", md, flags=re.IGNORECASE)
    md = re.sub(r"<p[^>]*>([\s\S]*?)</p>", r"\1\n\n", md, flags=re.IGNORECASE)
    md = re.sub(r"<div[^>]*>([\s\S]*?)</div>", r"\1\n", md, flags=re.IGNORECASE)
    md = re.sub(r"<span[^>]*>([\s\S]*?)</span>", r"\1", md, flags=re.IGNORECASE)

    # Remove remaining HTML tags
    md = re.sub(r"<[^>]+>", "", md)

    # Decode HTML entities
    md = md.replace("&amp;", "&")
    md = md.replace("&lt;", "<")
    md = md.replace("&gt;", ">")
    md = md.replace("&quot;", '"')
    md = md.replace("&#39;", "'")
    md = md.replace("&nbsp;", " ")

    # Clean up whitespace
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = md.strip()

    return md
