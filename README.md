# Kindle Scribe → OneNote → Obsidian Sync

Syncs handwritten notes from your Kindle Scribe into Obsidian as clean markdown. Uses OneNote as the bridge — Kindle Scribe natively syncs converted text to OneNote, and this tool pulls it into your local vault.

## How It Works

```
Kindle Scribe  →  OneNote (automatic)  →  This tool  →  Local markdown files
   (write)         (text conversion)       (sync)         (Obsidian/any editor)
```

1. Write on your Kindle Scribe
2. Use Kindle's "Convert to text" feature
3. Notes sync automatically to OneNote
4. Run this tool to pull the text into local markdown files

## Features

- **Direct text sync** — no OCR or AI needed, uses Kindle's built-in text conversion
- **Section-to-folder routing** — map any OneNote section to any local folder
- **Incremental sync** — only downloads pages that have changed
- **Persistent auth** — login once, token refreshes automatically
- **GUI app** — customtkinter interface for managing routes and running syncs
- **Obsidian plugin** — alternative interface that runs inside Obsidian

## Quick Start

### Python App (Recommended)

1. Double-click `Kindle Sync Manager.pyw`
2. Click **Login to Microsoft** — enter the code at the URL shown
3. Go to the **Routes** tab to configure which OneNote sections sync where
4. Click **▶ Sync Now**

### Requirements

- Python 3.10+
- `customtkinter` (`pip install customtkinter`)
- A Microsoft account with OneNote access

### Obsidian Plugin (Alternative)

1. Copy `main.js`, `manifest.json`, `styles.css` to `.obsidian/plugins/kindle-scribe-sync/`
2. Enable the plugin in Obsidian settings
3. Run "Kindle Scribe: Login to Microsoft" from the command palette
4. Run "Kindle Scribe: Sync notes"

## Routing

Routes map OneNote notebook/section pairs to local folders. Configure via the app's Routes tab or edit `kindle_sync/routes.json` directly:

```json
[
  {
    "notebook": "Kindle Scribe",
    "section": "TPM",
    "output_folder": "C:\\path\\to\\local\\folder"
  },
  {
    "notebook": "Kindle Scribe",
    "section": "Personal Notes",
    "output_folder": "C:\\another\\folder"
  }
]
```

## Output Format

Each synced page becomes a markdown file with frontmatter:

```markdown
---
title: "Page Title"
synced: 2026-05-23 18:45
source: kindle-scribe
---

# Page Title

Your converted handwriting text here...
```

Files are named `[Section] Note_[sync date].md` and updated in place on subsequent syncs.

## Architecture

```
kindle_sync/
├── app.py          # GUI (customtkinter)
├── auth.py         # Microsoft OAuth2 device code flow
├── config.py       # Route management + settings
├── onenote.py      # OneNote API client + HTML→Markdown
└── sync.py         # Sync engine with state tracking
```

### Authentication

Uses Microsoft's device code OAuth2 flow:
- No app registration required (uses a public client ID)
- Tokens cached locally with refresh token for persistent sessions
- Scopes: `Notes.Read`, `User.Read`, `offline_access`

### Sync State

Each output folder contains a `.kindle_sync_state.json` that tracks:
- Which OneNote pages have been synced
- Their last modification time
- Which local file they map to

This enables incremental sync — only changed pages are re-downloaded.

## Development

```bash
git clone https://github.com/nwfreidline/kindle-scribe-obsidian-sync.git
cd kindle-scribe-obsidian-sync

# Python app
pip install customtkinter
python kindle_sync/app.py

# Obsidian plugin
npm install
npm run build
```

## License

MIT
