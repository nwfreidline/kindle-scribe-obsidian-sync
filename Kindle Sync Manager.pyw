"""Double-click this file to launch the Kindle Scribe Sync Manager."""

import sys
from pathlib import Path

# Point to the kindle_sync package location
APP_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(APP_DIR))

# Hide console (redundant for .pyw but kept for safety)
if sys.platform == "win32":
    import ctypes
    console_window = ctypes.windll.kernel32.GetConsoleWindow()
    if console_window:
        ctypes.windll.user32.ShowWindow(console_window, 0)

from kindle_sync.app import run
run()
