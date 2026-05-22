# Kindle Scribe → Obsidian Sync Plugin: Design Document

## Overview

An Obsidian community plugin that syncs handwritten notes from Amazon Kindle Scribe directly into an Obsidian vault. Supports incremental sync, configurable output formats, and AI-powered OCR transcription of handwritten content.

---

## Problem Statement

The Kindle Scribe syncs natively with Microsoft OneNote, but there's no first-class integration with Obsidian. Existing solutions (e.g., `k4rnaj1k/obsidian-kindle-scribe-notes-sync-plugin`) are underdeveloped, fragile, and lack key features like incremental sync, error handling, and output customization.

---

## Prior Art & Research

### Existing Solutions Reviewed

| Repo | Approach | Limitations |
|------|----------|-------------|
| [k4rnaj1k/obsidian-kindle-scribe-notes-sync-plugin](https://github.com/k4rnaj1k/obsidian-kindle-scribe-notes-sync-plugin) | Direct Amazon API via Electron cookies + OpenRouter OCR | Deprecated `electron.remote`, no incremental sync, US-only, fixed output path, heavy React UI |
| [ninth-life-insights/kindle-scribe-to-obsidian](https://github.com/ninth-life-insights/kindle-scribe-to-obsidian) | Gmail-based pipeline (Python) | Requires email forwarding, not an Obsidian plugin |
| [Happy-Friday-Food-for-Thought/kindle-notes-exporter](https://github.com/Happy-Friday-Food-for-Thought/kindle-notes-exporter) | Export to Notion/Obsidian | Minimal documentation, unclear status |

### Amazon Kindle Notebook API (Unofficial)

The existing plugin proves these endpoints work:

- **List notebooks:** `GET https://read.amazon.com/kindle-notebook/api/notes`
  - Returns `{ itemsList: FileData[] }` with notebook metadata
- **Open notebook:** `GET https://read.amazon.com/openNotebook?notebookId={id}&marketplaceId={marketplace}`
  - Returns `{ metadata, readingSessionId, renderingToken }`
  - Metadata includes: `currentPage`, `modificationTime`, `title`, `totalPages`
- **Render pages:** `GET https://read.amazon.com/renderPage?startPage={n}&endPage={n}&width={w}&height={h}&dpi={dpi}`
  - Requires `x-amzn-karamel-notebook-rendering-token` header
  - Returns tar archive containing page images
  - Pages fetched in batches of 3

**Authentication:** Uses Amazon session cookies from Electron's browser session. User logs in via a modal that loads Amazon's login page, then cookies are extracted from the session.

**Known marketplace IDs:**
- US: `ATVPDKIKX0DER`
- UK: `A1F83G8C2ARO7P`
- DE: `A1PA6795UKMFR9`
- FR: `A13V1IB3VIYBER`
- (Others to be researched)

---

## Architecture

### Project Structure

```
kindle-scribe-obsidian-plugin/
├── src/
│   ├── main.ts                  # Plugin entry point, commands, ribbon
│   ├── settings.ts              # Settings tab (Obsidian-native UI)
│   ├── api/
│   │   ├── auth.ts              # Amazon cookie/session management
│   │   ├── notebooks.ts         # Notebook listing & page fetching
│   │   └── types.ts             # API response type definitions
│   ├── sync/
│   │   ├── engine.ts            # Incremental sync orchestration
│   │   └── state.ts             # Sync state persistence (timestamps, hashes)
│   ├── processing/
│   │   ├── ocr.ts               # AI provider abstraction layer
│   │   └── providers/
│   │       ├── openrouter.ts    # OpenRouter integration
│   │       ├── openai.ts        # OpenAI Vision integration
│   │       └── anthropic.ts     # Claude Vision integration
│   └── output/
│       ├── markdown.ts          # Markdown file generation
│       ├── pdf.ts               # PDF export
│       └── templates.ts         # Configurable output templates
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
└── README.md
```

### Core Components

#### 1. Authentication (`api/auth.ts`)

Handles Amazon session management:
- Login modal using Obsidian's `Modal` class with an embedded webview
- Cookie extraction from Electron session
- Session validation (check if cookies are still valid before sync)
- Logout/clear session functionality

**Key consideration:** `electron.remote` is deprecated. We should use Obsidian's `requestUrl` where possible and find a more stable approach to cookie management. Options:
- Use `BrowserWindow` from Electron main process via IPC
- Store session tokens after initial login rather than re-reading cookies each time

#### 2. Notebook API (`api/notebooks.ts`)

- `listNotebooks()` — Fetch all notebooks with metadata
- `openNotebook(id, marketplace)` — Get rendering token and page count
- `fetchPages(renderingToken, totalPages)` — Download page images in batches
- `extractImages(tarBuffer)` — Unpack tar archives into individual page images

#### 3. Sync Engine (`sync/engine.ts`)

Incremental sync logic:
- On first sync: download everything, record state
- On subsequent syncs: compare `modificationTime` from API against stored state
- Only re-download notebooks that have changed
- Handle deleted notebooks (configurable: ignore, archive, or delete local copy)

State stored in plugin data:
```typescript
interface SyncState {
  lastSyncTime: number;
  notebooks: Record<string, {
    id: string;
    title: string;
    lastModified: number;
    pageCount: number;
    hash?: string;
  }>;
}
```

#### 4. OCR Processing (`processing/ocr.ts`)

Provider-agnostic interface:
```typescript
interface OCRProvider {
  name: string;
  transcribePages(images: string[], options?: OCROptions): Promise<string>;
}

interface OCROptions {
  format: 'markdown' | 'plain';
  includePageBreaks: boolean;
  language?: string;
}
```

Each provider implements this interface. Users select their preferred provider and supply an API key in settings.

#### 5. Output Generation (`output/`)

Configurable output with template support:
- **PDF mode:** Save raw pages as a PDF in the vault
- **Image mode:** Save page images inline in a markdown note
- **Transcribed mode:** AI-processed text as markdown
- **Combined mode:** Transcribed text with original images as reference

Template variables:
- `{{title}}` — Notebook name
- `{{date}}` — Sync date
- `{{modified}}` — Last modified date on Kindle
- `{{pages}}` — Page count
- `{{content}}` — Transcribed content or image embeds

---

## Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Output folder | string | `Kindle Scribe/` | Vault folder for synced notes |
| Marketplace | dropdown | US | Amazon marketplace region |
| Output format | dropdown | Combined | PDF / Images / Transcribed / Combined |
| AI Provider | dropdown | None | OpenRouter / OpenAI / Anthropic / None |
| API Key | password | — | Key for selected AI provider |
| AI Model | string | `google/gemini-2.5-flash` | Model identifier |
| Auto-sync | toggle | false | Sync on Obsidian startup |
| Sync interval | number | 0 | Minutes between auto-syncs (0 = disabled) |
| Note template | textarea | (default) | Customizable output template |
| Page DPI | number | 50 | Render quality (higher = better but slower) |

---

## User Flow

1. **First use:** User opens settings → enters marketplace → clicks "Login to Amazon"
2. **Login modal** opens Amazon sign-in page → user authenticates → cookies stored
3. **Sync triggered** (manual via ribbon/command, or automatic):
   - Fetch notebook list from API
   - Compare against stored sync state
   - Download new/changed notebooks
   - Process through OCR if configured
   - Write output files to vault
   - Update sync state
4. **Subsequent syncs** only process changed notebooks

---

## Commands & UI

- **Ribbon icon:** Notebook icon → triggers sync
- **Command palette:**
  - `Kindle Scribe: Sync notes` — Run incremental sync
  - `Kindle Scribe: Sync all notes` — Force full re-sync
  - `Kindle Scribe: Login to Amazon` — Open login modal
  - `Kindle Scribe: Logout` — Clear session
- **Status bar:** Show sync status/last sync time (optional)

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI framework | Obsidian-native (no React) | Lighter bundle, no extra dependencies, consistent with Obsidian UX |
| Build tool | esbuild | Standard for Obsidian plugins, fast |
| Tar parsing | `js-untar` or manual | Minimal dependency for unpacking page archives |
| PDF generation | `jspdf` | Proven, lightweight |
| State storage | `plugin.loadData()`/`saveData()` | Built-in Obsidian persistence |
| Auth approach | Electron session cookies (with fallback research) | Proven to work, but we should investigate more stable alternatives |

---

## Development Phases

### Phase 1: Core Sync (MVP)
- [ ] Plugin scaffold (manifest, build config, settings tab)
- [ ] Amazon login modal + cookie management
- [ ] Notebook listing API
- [ ] Page download + tar extraction
- [ ] PDF output to vault
- [ ] Basic sync state tracking

### Phase 2: OCR & Output
- [ ] AI provider abstraction
- [ ] OpenRouter provider implementation
- [ ] OpenAI Vision provider
- [ ] Markdown output with inline images
- [ ] Combined output mode (text + images)
- [ ] Configurable templates

### Phase 3: Polish & Features
- [ ] Incremental sync (only changed notebooks)
- [ ] Auto-sync on startup / interval
- [ ] Multi-marketplace support
- [ ] Retry logic with exponential backoff
- [ ] Progress notifications
- [ ] Status bar indicator
- [ ] Error recovery (partial sync resume)

### Phase 4: Community Release
- [ ] README with setup instructions
- [ ] Submit to Obsidian community plugins
- [ ] BRAT compatibility for early adopters

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Amazon API changes/breaks | High | Monitor for changes, version-pin known-good endpoints, graceful error messages |
| `electron.remote` deprecation | Medium | Research IPC-based alternatives, abstract auth layer for easy swap |
| Rate limiting by Amazon | Medium | Sequential fetching with delays, configurable batch size |
| Large notebooks (100+ pages) | Low | Chunked processing, progress indicators, timeout handling |
| AI API costs for OCR | Low | Clear cost estimates in docs, support free/local models |

---

## References

- [Obsidian Plugin Developer Docs](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Existing plugin source](https://github.com/k4rnaj1k/obsidian-kindle-scribe-notes-sync-plugin)
- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
