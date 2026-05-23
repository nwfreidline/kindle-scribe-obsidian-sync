"""Microsoft OAuth2 authentication using device code flow."""

import json
import time
import webbrowser
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode

from .config import MS_CLIENT_ID, MS_AUTH_URL, MS_SCOPES, TOKEN_CACHE_FILE


class MSAuth:
    """Handles Microsoft OAuth2 device code flow with token caching."""

    def __init__(self, cache_dir: Path):
        self.cache_file = cache_dir / TOKEN_CACHE_FILE
        self.token = self._load_cache()

    def is_authenticated(self) -> bool:
        """Check if we have a token (access or refresh)."""
        if not self.token:
            return False
        # We're authenticated if we have a refresh token (can always get new access token)
        # or if the access token is still valid
        return bool(self.token.get("refresh_token")) or self.token.get("expires_at", 0) > time.time()

    def get_access_token(self) -> str:
        """Get a valid access token, refreshing if needed."""
        if not self.token:
            raise RuntimeError("Not authenticated. Please login first.")

        if self.token.get("expires_at", 0) <= time.time() + 300:
            self._refresh_token()

        return self.token["access_token"]

    def login(self, status_callback=None) -> bool:
        """Run the device code login flow. Returns True on success."""
        # Request device code
        data = urlencode({
            "client_id": MS_CLIENT_ID,
            "scope": " ".join(MS_SCOPES),
        }).encode()

        req = Request(f"{MS_AUTH_URL}/devicecode", data=data)
        req.add_header("Content-Type", "application/x-www-form-urlencoded")

        with urlopen(req) as resp:
            device_code_data = json.loads(resp.read())

        user_code = device_code_data["user_code"]
        verification_uri = device_code_data["verification_uri"]
        device_code = device_code_data["device_code"]
        interval = device_code_data.get("interval", 5)
        expires_in = device_code_data.get("expires_in", 900)

        if status_callback:
            status_callback(f"Code: {user_code}\nGo to: {verification_uri}")

        # Open browser
        webbrowser.open(verification_uri)

        # Poll for token
        deadline = time.time() + expires_in
        while time.time() < deadline:
            time.sleep(interval)

            try:
                token_data = urlencode({
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                    "client_id": MS_CLIENT_ID,
                    "device_code": device_code,
                }).encode()

                token_req = Request(f"{MS_AUTH_URL}/token", data=token_data)
                token_req.add_header("Content-Type", "application/x-www-form-urlencoded")

                with urlopen(token_req) as resp:
                    token_response = json.loads(resp.read())

                # Success
                self.token = {
                    "access_token": token_response["access_token"],
                    "refresh_token": token_response.get("refresh_token", ""),
                    "expires_at": time.time() + token_response.get("expires_in", 3600),
                }
                self._save_cache()
                return True

            except Exception as e:
                error_msg = str(e)
                if "400" in error_msg:
                    # authorization_pending — keep polling
                    if status_callback:
                        status_callback(f"Code: {user_code}\nWaiting for approval...")
                    continue
                else:
                    if status_callback:
                        status_callback(f"Error: {error_msg}")
                    return False

        return False

    def logout(self):
        """Clear the cached token."""
        self.token = None
        if self.cache_file.exists():
            self.cache_file.unlink()

    def _refresh_token(self):
        """Refresh the access token."""
        if not self.token or not self.token.get("refresh_token"):
            raise RuntimeError("No refresh token. Please login again.")

        data = urlencode({
            "grant_type": "refresh_token",
            "client_id": MS_CLIENT_ID,
            "refresh_token": self.token["refresh_token"],
            "scope": " ".join(MS_SCOPES),
        }).encode()

        req = Request(f"{MS_AUTH_URL}/token", data=data)
        req.add_header("Content-Type", "application/x-www-form-urlencoded")

        with urlopen(req) as resp:
            token_response = json.loads(resp.read())

        self.token = {
            "access_token": token_response["access_token"],
            "refresh_token": token_response.get("refresh_token", self.token["refresh_token"]),
            "expires_at": time.time() + token_response.get("expires_in", 3600),
        }
        self._save_cache()

    def _load_cache(self) -> dict | None:
        """Load token from cache file."""
        if self.cache_file.exists():
            try:
                with open(self.cache_file) as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return None
        return None

    def _save_cache(self):
        """Save token to cache file."""
        if self.token:
            self.cache_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.cache_file, "w") as f:
                json.dump(self.token, f)
