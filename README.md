# Kindle Scribe → Obsidian Sync

An Obsidian community plugin that syncs handwritten notes from your Amazon Kindle Scribe directly into your vault. Supports incremental sync, multiple output formats, and AI-powered OCR transcription of handwritten content.

## Features

- **Direct sync** from Kindle Scribe via Amazon's notebook API
- **Incremental sync** — only downloads notebooks that have changed since last sync
- **Multiple output formats:**
  - PDF export
  - Markdown with embedded page images
  - AI-transcribed text (handwriting → markdown)
  - Combined mode (transcription + original images)
- **AI provider support:** OpenRouter, OpenAI, and Anthropic for OCR transcription
- **Configurable templates** with frontmatter and custom variables
- **Auto-sync** on startup or at configurable intervals
- **Multi-marketplace** support (US, UK, DE, FR, and more)

## Installation

### From Community Plugins (coming soon)

1. Open Obsidian Settings → Community Plugins
2. Search for "Kindle Scribe Sync"
3. Install and enable

### Manual / BRAT

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Place them in your vault's `.obsidian/plugins/kindle-scribe-sync/` folder
3. Enable the plugin in Settings → Community Plugins

### For Development

```bash
git clone https://github.com/nwfreidline/kindle-scribe-obsidian-sync.git
cd kindle-scribe-obsidian-sync
npm install
npm run dev
```

Copy the built files to your vault's plugin folder for testing.

## Setup

1. Open Settings → Kindle Scribe Sync
2. Select your Amazon marketplace (US, UK, DE, etc.)
3. Click **Login to Amazon** and sign in with your Amazon account
4. Configure your preferred output format and folder
5. (Optional) Set up an AI provider for handwriting transcription

## Usage

- **Ribbon icon** (notebook) — triggers incremental sync
- **Command palette:**
  - `Kindle Scribe: Sync notes` — sync only changed notebooks
  - `Kindle Scribe: Sync all notes` — force re-download everything
  - `Kindle Scribe: Login to Amazon` — open login modal
  - `Kindle Scribe: Logout` — clear session

## Settings

| Setting | Description |
|---------|-------------|
| Output folder | Where synced notes are saved in your vault |
| Marketplace | Your Amazon region (US, UK, DE, FR, etc.) |
| Output format | PDF / Images / Transcribed / Combined |
| AI Provider | OpenRouter, OpenAI, or Anthropic |
| API Key | Your key for the selected AI provider |
| AI Model | Model identifier (e.g., `google/gemini-2.5-flash`) |
| Auto-sync | Sync automatically on Obsidian startup |
| Sync interval | Minutes between auto-syncs (0 = disabled) |
| Note template | Customizable output template with `{{variables}}` |
| Page DPI | Render quality (25–150, higher = better but slower) |

## Template Variables

Customize your note output with these variables:

- `{{title}}` — Notebook name
- `{{date}}` — Sync date
- `{{modified}}` — Last modified date on Kindle
- `{{pages}}` — Page count
- `{{content}}` — Transcribed content or image embeds

## Architecture

```
src/
├── main.ts              # Plugin entry point
├── settings.ts          # Settings tab (Obsidian-native UI)
├── api/
│   ├── auth.ts          # Amazon session/cookie management
│   ├── notebooks.ts     # Notebook API client
│   └── types.ts         # Type definitions
├── sync/
│   ├── engine.ts        # Sync orchestration
│   └── state.ts         # State persistence
├── processing/
│   ├── ocr.ts           # OCR provider interface
│   └── providers/       # OpenRouter, OpenAI, Anthropic
└── output/
    ├── markdown.ts      # Markdown generation
    ├── pdf.ts           # PDF export
    └── templates.ts     # Template engine
```

## Development Status

This plugin is under active development.

- [x] Plugin scaffold and build pipeline
- [x] Settings tab with full configuration
- [x] Amazon authentication (login modal + cookie management)
- [x] Notebook API client (list, open, render pages)
- [x] Tar archive extraction for page images
- [x] Incremental sync engine with state tracking
- [x] PDF output generation
- [x] Markdown output with inline images
- [x] AI provider abstraction (OpenRouter, OpenAI, Anthropic)
- [x] Configurable note templates
- [ ] End-to-end testing with live Amazon account
- [ ] Retry logic with exponential backoff
- [ ] Progress notifications / status bar
- [ ] Error recovery (partial sync resume)
- [ ] Community plugin submission

## How It Works

The plugin uses Amazon's unofficial Kindle Notebook API (the same endpoints used by `read.amazon.com`) to:

1. Authenticate via Amazon's login page (cookies stored locally)
2. List all notebooks in your Kindle Scribe account
3. Open each notebook to get a rendering token
4. Download page images in batches (returned as tar archives)
5. Optionally transcribe handwriting via AI vision models
6. Write output to your vault in the configured format

## Disclaimer

This plugin uses unofficial Amazon APIs. It may break if Amazon changes their endpoints. Use at your own risk.

## License

MIT
