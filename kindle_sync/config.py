"""
Routing configuration for OneNote → local folder sync.

Each entry maps a OneNote section to a local folder.
Format:
    {
        "notebook": "Kindle Scribe",       # OneNote notebook name
        "section": "TPM",                  # OneNote section name
        "output_folder": "C:/path/to/folder",  # Local destination
    }
"""

import json
from pathlib import Path

# Config file location (next to this module)
_CONFIG_DIR = Path(__file__).parent.resolve()
_ROUTES_FILE = _CONFIG_DIR / "routes.json"

# Microsoft OAuth settings
MS_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
MS_AUTH_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0"
MS_GRAPH_URL = "https://graph.microsoft.com/v1.0"
MS_SCOPES = ["Notes.Read", "User.Read", "offline_access"]

# Token cache file (stores refresh token so you don't re-login each time)
TOKEN_CACHE_FILE = "token_cache.json"

# Default routes (used if routes.json doesn't exist yet)
_DEFAULT_ROUTES = [
    {
        "notebook": "Kindle Scribe",
        "section": "TPM",
        "output_folder": r"C:\Users\nwf\Documents\00 TPM\TPM Kiro Projects\TPM Tracking\Kindle",
    },
]


def load_routes() -> list[dict]:
    """Load routes from the JSON config file."""
    if _ROUTES_FILE.exists():
        try:
            return json.loads(_ROUTES_FILE.read_text())
        except (json.JSONDecodeError, IOError):
            return _DEFAULT_ROUTES
    # First run — create the file with defaults
    save_routes(_DEFAULT_ROUTES)
    return _DEFAULT_ROUTES


def save_routes(routes: list[dict]):
    """Save routes to the JSON config file."""
    _ROUTES_FILE.write_text(json.dumps(routes, indent=2))


def add_route(notebook: str, section: str, output_folder: str):
    """Add a new route and save."""
    routes = load_routes()
    routes.append({
        "notebook": notebook,
        "section": section,
        "output_folder": output_folder,
    })
    save_routes(routes)


def remove_route(index: int):
    """Remove a route by index and save."""
    routes = load_routes()
    if 0 <= index < len(routes):
        routes.pop(index)
        save_routes(routes)
