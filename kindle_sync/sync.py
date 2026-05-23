"""Sync engine — routes OneNote sections to local folders based on config."""

import json
from datetime import datetime
from pathlib import Path

from .auth import MSAuth
from .onenote import OneNoteClient, html_to_markdown
from .config import load_routes


class SyncEngine:
    """Syncs OneNote sections to local folders based on routing config."""

    def __init__(self, auth: MSAuth):
        self.auth = auth
        self.client = OneNoteClient(auth.get_access_token)

    def sync_all(self, status_callback=None) -> dict:
        """Run sync for all configured routes. Returns summary."""
        results = {"synced": 0, "skipped": 0, "errors": []}

        notebooks = self.client.list_notebooks()
        notebook_map = {nb["displayName"]: nb for nb in notebooks}

        for route in load_routes():
            notebook_name = route["notebook"]
            section_name = route["section"]
            output_folder = Path(route["output_folder"])

            if status_callback:
                status_callback(f"Syncing: {notebook_name} / {section_name}")

            # Find notebook
            notebook = notebook_map.get(notebook_name)
            if not notebook:
                results["errors"].append(f"Notebook '{notebook_name}' not found")
                continue

            # Find section
            sections = self.client.list_sections(notebook["id"])
            section = next(
                (s for s in sections if s["displayName"] == section_name), None
            )
            if not section:
                available = [s["displayName"] for s in sections]
                results["errors"].append(
                    f"Section '{section_name}' not found in '{notebook_name}'. "
                    f"Available: {', '.join(available)}"
                )
                continue

            # Get pages
            pages = self.client.list_pages(section["id"])
            if status_callback:
                status_callback(f"Found {len(pages)} page(s) in {section_name}")

            # Ensure output folder exists
            output_folder.mkdir(parents=True, exist_ok=True)

            # Sync state file
            state_file = output_folder / ".kindle_sync_state.json"
            state = self._load_state(state_file)

            # Process each page
            for page in pages:
                page_id = page["id"]
                page_title = page.get("title", "Untitled")
                page_modified = page.get("lastModifiedDateTime", "")

                # Check if already synced and unchanged
                if page_id in state:
                    if state[page_id].get("modified") == page_modified:
                        results["skipped"] += 1
                        continue

                try:
                    # Fetch and convert content
                    html = self.client.get_page_content(page_id)
                    markdown = html_to_markdown(html)

                    # Build output with frontmatter
                    now = datetime.now()
                    output = self._build_note(page_title, now, markdown)

                    # Filename uses sync timestamp
                    # If this page was previously synced, overwrite the same file
                    if page_id in state and state[page_id].get("file"):
                        filename = state[page_id]["file"]
                    else:
                        # New page — filename uses section name + sync date
                        date_str = now.strftime("%Y-%m-%d")
                        filename = f"{section_name} Note_{date_str}.md"

                    filepath = output_folder / filename
                    filepath.write_text(output, encoding="utf-8")

                    # Update state
                    state[page_id] = {
                        "title": page_title,
                        "modified": page_modified,
                        "synced_at": now.isoformat(),
                        "file": filename,
                    }

                    results["synced"] += 1
                    if status_callback:
                        status_callback(f"Synced: {page_title} → {filename}")

                except Exception as e:
                    results["errors"].append(f"{page_title}: {e}")

            # Save state
            self._save_state(state_file, state)

        return results

    def _build_note(self, title: str, sync_time: datetime, content: str) -> str:
        """Build a markdown note with frontmatter."""
        synced_str = sync_time.strftime("%Y-%m-%d %H:%M")

        return (
            f"---\n"
            f'title: "{title}"\n'
            f"synced: {synced_str}\n"
            f"source: kindle-scribe\n"
            f"---\n\n"
            f"# {title}\n\n"
            f"{content}\n"
        )

    def _sanitize_filename(self, name: str) -> str:
        """Sanitize a string for use as a filename."""
        return "".join(c if c not in r'\/:*?"<>|' else "_" for c in name).strip()

    def _load_state(self, path: Path) -> dict:
        """Load sync state from file."""
        if path.exists():
            try:
                return json.loads(path.read_text())
            except (json.JSONDecodeError, IOError):
                return {}
        return {}

    def _save_state(self, path: Path, state: dict):
        """Save sync state to file."""
        path.write_text(json.dumps(state, indent=2))
