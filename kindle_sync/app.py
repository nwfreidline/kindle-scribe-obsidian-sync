"""Main application — GUI for Kindle Scribe OneNote Sync."""

import customtkinter as ctk
from pathlib import Path
from threading import Thread
from tkinter import filedialog

from .auth import MSAuth
from .sync import SyncEngine
from .config import load_routes, save_routes, add_route, remove_route


APP_DIR = Path(__file__).parent.resolve()


class KindleSyncApp(ctk.CTk):
    """Main application window."""

    def __init__(self):
        super().__init__()

        self.title("Kindle Scribe Sync Manager")
        self.geometry("700x600")
        self.minsize(600, 500)

        # Center window
        self.update_idletasks()
        x = (self.winfo_screenwidth() // 2) - (700 // 2)
        y = (self.winfo_screenheight() // 2) - (600 // 2)
        self.geometry(f"+{x}+{y}")

        # Auth
        self.auth = MSAuth(APP_DIR)

        # Tabview for main sections
        self.tabview = ctk.CTkTabview(self)
        self.tabview.pack(fill="both", expand=True, padx=15, pady=15)

        self.tabview.add("Sync")
        self.tabview.add("Routes")

        self._build_sync_tab()
        self._build_routes_tab()
        self._update_status()

    # ─── Sync Tab ───────────────────────────────────────────────────────

    def _build_sync_tab(self):
        """Build the sync tab UI."""
        tab = self.tabview.tab("Sync")

        # Header
        header = ctk.CTkLabel(
            tab, text="Kindle Scribe → OneNote → Local",
            font=ctk.CTkFont(size=18, weight="bold"),
        )
        header.pack(pady=(10, 5))

        subtitle = ctk.CTkLabel(
            tab, text="Syncs converted handwriting from OneNote sections to local folders",
            font=ctk.CTkFont(size=12), text_color="gray",
        )
        subtitle.pack(pady=(0, 15))

        # Status
        self.status_label = ctk.CTkLabel(tab, text="", font=ctk.CTkFont(size=12))
        self.status_label.pack(pady=5)

        # Buttons
        btn_frame = ctk.CTkFrame(tab, fg_color="transparent")
        btn_frame.pack(pady=10)

        self.login_btn = ctk.CTkButton(
            btn_frame, text="Login to Microsoft",
            command=self._login, width=160,
        )
        self.login_btn.pack(side="left", padx=5)

        self.sync_btn = ctk.CTkButton(
            btn_frame, text="▶ Sync Now",
            command=self._sync, width=160,
            fg_color="#28a745",
        )
        self.sync_btn.pack(side="left", padx=5)

        self.logout_btn = ctk.CTkButton(
            btn_frame, text="Logout",
            command=self._logout, width=100,
            fg_color="#dc3545",
        )
        self.logout_btn.pack(side="left", padx=5)

        # Log area
        self.log_text = ctk.CTkTextbox(tab, height=200, font=ctk.CTkFont(family="Consolas", size=11))
        self.log_text.pack(fill="both", expand=True, padx=5, pady=(5, 5))

    # ─── Routes Tab ─────────────────────────────────────────────────────

    def _build_routes_tab(self):
        """Build the routes management tab."""
        tab = self.tabview.tab("Routes")

        header = ctk.CTkLabel(
            tab, text="Sync Routes",
            font=ctk.CTkFont(size=16, weight="bold"),
        )
        header.pack(pady=(10, 5))

        ctk.CTkLabel(
            tab, text="Each route maps a OneNote notebook/section to a local folder.",
            font=ctk.CTkFont(size=11), text_color="gray",
        ).pack(pady=(0, 10))

        # Routes list (scrollable)
        self.routes_frame = ctk.CTkScrollableFrame(tab, height=200)
        self.routes_frame.pack(fill="both", expand=True, padx=5, pady=5)

        self._refresh_routes_list()

        # Add new route section
        add_frame = ctk.CTkFrame(tab)
        add_frame.pack(fill="x", padx=5, pady=10)

        ctk.CTkLabel(add_frame, text="Add New Route", font=ctk.CTkFont(weight="bold")).grid(
            row=0, column=0, columnspan=3, sticky="w", padx=10, pady=(10, 5)
        )

        ctk.CTkLabel(add_frame, text="Notebook:").grid(row=1, column=0, sticky="w", padx=(10, 5), pady=3)
        self.new_notebook_entry = ctk.CTkEntry(add_frame, placeholder_text="Kindle Scribe", width=200)
        self.new_notebook_entry.grid(row=1, column=1, columnspan=2, sticky="w", padx=5, pady=3)
        self.new_notebook_entry.insert(0, "Kindle Scribe")

        ctk.CTkLabel(add_frame, text="Section:").grid(row=2, column=0, sticky="w", padx=(10, 5), pady=3)
        self.new_section_entry = ctk.CTkEntry(add_frame, placeholder_text="Section Name", width=200)
        self.new_section_entry.grid(row=2, column=1, columnspan=2, sticky="w", padx=5, pady=3)

        ctk.CTkLabel(add_frame, text="Output Folder:").grid(row=3, column=0, sticky="w", padx=(10, 5), pady=3)
        self.new_folder_entry = ctk.CTkEntry(add_frame, placeholder_text="C:\\path\\to\\folder", width=300)
        self.new_folder_entry.grid(row=3, column=1, sticky="w", padx=5, pady=3)

        browse_btn = ctk.CTkButton(add_frame, text="Browse", width=70, command=self._browse_folder)
        browse_btn.grid(row=3, column=2, padx=5, pady=3)

        add_btn = ctk.CTkButton(
            add_frame, text="+ Add Route", command=self._add_route,
            fg_color="#28a745", width=120,
        )
        add_btn.grid(row=4, column=1, sticky="w", padx=5, pady=(10, 10))

    def _refresh_routes_list(self):
        """Refresh the routes list display."""
        # Clear existing
        for widget in self.routes_frame.winfo_children():
            widget.destroy()

        routes = load_routes()

        if not routes:
            ctk.CTkLabel(
                self.routes_frame, text="No routes configured. Add one below.",
                text_color="gray",
            ).pack(pady=20)
            return

        for i, route in enumerate(routes):
            row_frame = ctk.CTkFrame(self.routes_frame)
            row_frame.pack(fill="x", pady=3, padx=5)

            # Route info
            info_text = f"{route['notebook']}  /  {route['section']}"
            ctk.CTkLabel(
                row_frame, text=info_text,
                font=ctk.CTkFont(weight="bold", size=12),
            ).pack(anchor="w", padx=10, pady=(5, 0))

            ctk.CTkLabel(
                row_frame, text=f"→ {route['output_folder']}",
                font=ctk.CTkFont(family="Consolas", size=10),
                text_color="gray",
            ).pack(anchor="w", padx=10, pady=(0, 5))

            # Delete button
            del_btn = ctk.CTkButton(
                row_frame, text="✕", width=30, height=25,
                fg_color="#dc3545", hover_color="#c82333",
                command=lambda idx=i: self._remove_route(idx),
            )
            del_btn.place(relx=1.0, rely=0.5, anchor="e", x=-10)

    def _browse_folder(self):
        """Open folder picker dialog."""
        folder = filedialog.askdirectory(title="Select output folder")
        if folder:
            self.new_folder_entry.delete(0, "end")
            self.new_folder_entry.insert(0, folder)

    def _add_route(self):
        """Add a new route from the form inputs."""
        notebook = self.new_notebook_entry.get().strip()
        section = self.new_section_entry.get().strip()
        folder = self.new_folder_entry.get().strip()

        if not section:
            self._log("Error: Section name is required.")
            return
        if not folder:
            self._log("Error: Output folder is required.")
            return

        add_route(notebook or "Kindle Scribe", section, folder)
        self._log(f"Added route: {notebook}/{section} → {folder}")

        # Clear inputs
        self.new_section_entry.delete(0, "end")
        self.new_folder_entry.delete(0, "end")

        # Refresh list
        self._refresh_routes_list()

    def _remove_route(self, index: int):
        """Remove a route by index."""
        routes = load_routes()
        if 0 <= index < len(routes):
            removed = routes[index]
            remove_route(index)
            self._log(f"Removed route: {removed['notebook']}/{removed['section']}")
            self._refresh_routes_list()

    # ─── Actions ────────────────────────────────────────────────────────

    def _update_status(self):
        """Update the status label based on auth state."""
        if self.auth.is_authenticated():
            self.status_label.configure(text="✓ Logged in", text_color="green")
            self.sync_btn.configure(state="normal")
        else:
            self.status_label.configure(text="Not logged in", text_color="orange")
            self.sync_btn.configure(state="disabled")

    def _log(self, message: str):
        """Append a message to the log area."""
        self.log_text.insert("end", message + "\n")
        self.log_text.see("end")

    def _login(self):
        """Run the device code login flow."""
        self._log("Starting login...")
        self.login_btn.configure(state="disabled")

        def do_login():
            success = self.auth.login(
                status_callback=lambda msg: self.after(0, self._log, msg)
            )
            def on_done():
                self.login_btn.configure(state="normal")
                if success:
                    self._log("Login successful!")
                else:
                    self._log("Login failed or timed out.")
                self._update_status()
            self.after(0, on_done)

        Thread(target=do_login, daemon=True).start()

    def _sync(self):
        """Run the sync."""
        self._log("Starting sync...")
        self.sync_btn.configure(state="disabled")

        def do_sync():
            engine = SyncEngine(self.auth)
            results = engine.sync_all(
                status_callback=lambda msg: self.after(0, self._log, msg)
            )
            def on_done():
                self.sync_btn.configure(state="normal")
                self._log(f"\nDone! Synced: {results['synced']}, Skipped: {results['skipped']}")
                if results["errors"]:
                    for err in results["errors"]:
                        self._log(f"  Error: {err}")
            self.after(0, on_done)

        Thread(target=do_sync, daemon=True).start()

    def _logout(self):
        """Clear the session."""
        self.auth.logout()
        self._log("Logged out.")
        self._update_status()


def run():
    """Entry point."""
    ctk.set_appearance_mode("dark")
    ctk.set_default_color_theme("blue")
    app = KindleSyncApp()
    app.mainloop()
