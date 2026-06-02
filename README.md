# ig-dm-md

`ig-dm-md` is a local-first Node.js/TypeScript CLI that turns Instagram/Meta direct-message exports into a durable, readable Markdown archive. The CLI binary is `igdm`.

## Privacy posture

This is private archival software for personal conversations. The app keeps everything local by default: no telemetry, no analytics, no scraping, no live Instagram DM API usage, and no external AI calls. Message contents are not logged. Google Drive support is designed only as an intake source for exports that the user already configured, and the app never deletes or mutates Drive files.

The rendered archive contains private messages. Do **not** casually commit it to git, publish it, or sync it to shared services.

## Architecture

Markdown is generated reading output, not the database. The pipeline is:

1. source adapters discover local export folders or ZIPs;
2. the importer reads/caches raw exports;
3. the Instagram parser normalizes `message_*.json` files;
4. SQLite in `.igdm/state.sqlite` is the canonical local store;
5. the renderer deterministically writes Markdown files.

Recurring exports commonly overlap. Messages are deduplicated in SQLite with stable SHA-256 fingerprints made from the source thread key, timestamp, sender, normalized content, media references, and share references. Archive mode is preservation-first: if a later export omits a previously imported message, the message is retained.

## Quick start with synthetic fixtures

```bash
npm install
npm test
npm run build
npm run sync:fixture
```

`npm run sync:fixture` imports fake Instagram-like data from `fixtures/exports` and writes a demo archive to `tmp/archive` without Google credentials.

You can also run the built CLI against a local export folder:

```bash
mkdir -p ./tmp/.igdm
node dist/cli.js sync --local-source ./fixtures/exports --output ./tmp/archive --state-dir ./tmp/.igdm
node dist/cli.js render --output ./tmp/archive --state-dir ./tmp/.igdm
node dist/cli.js doctor --state-dir ./tmp/.igdm
```

## Initializing a local config

```bash
npm run dev -- init
```

This creates `igdm.config.json`, `.igdm/`, `.igdm/cache/`, and safe `.gitignore` entries.

## Expected Instagram export layouts

The parser recursively discovers conversations and does not assume one exact root. It looks for paths such as:

- `messages/inbox/*/message_*.json`
- `messages/archived_threads/*/message_*.json`
- `messages/message_requests/*/message_*.json`
- `messages/filtered_threads/*/message_*.json`
- `your_instagram_activity/messages/**/message_*.json`
- nested `inbox`, `archived_threads`, `message_requests`, and `filtered_threads` folders

A conversation folder can contain `message_1.json`, `message_2.json`, additional `message_N.json` files, and media subfolders referenced by relative paths.

## Output and state locations

Technical state lives outside the rendered archive by default. Use `--state-dir <path>` with `sync`, `render`, or `doctor` when you want isolated manual test state instead of the configured `.igdm` directory.


- `.igdm/state.sqlite` — canonical SQLite store
- `.igdm/cache/` — extracted ZIP/cache area
- `.igdm/token.json` — future Google OAuth token
- `.igdm/logs/` — local logs if enabled

Rendered Markdown defaults to `instagram-dm-markdown-archive/` and includes:

- `README.md`
- `index.md`
- `conversations.md`
- `imports.md` (including skipped no-message sources when present)
- per-conversation `chat.md`
- per-conversation `metadata.json`
- `_unsupported/warnings.md`
- `_system/render-manifest.json`

## Watch mode

Local watch mode runs a sync at startup, watches the configured local folder with `chokidar`, and also polls periodically:

```bash
npm run dev -- watch
```

The default poll interval is 30 minutes and can be changed in `igdm.config.json`.

## Google Drive mode

Google Drive is not required for the first local milestone. The app includes CLI and module placeholders so Drive can be added as another source adapter without changing the parser/store/renderer pipeline. Planned behavior is OAuth desktop flow with read-only Drive scope, listing/downloading from a configured folder ID, local caching, and graceful non-secret failures when credentials are missing.

## Current limitations

- Google Drive list/download is intentionally deferred until the local pipeline is stable.
- Unknown Instagram message shapes are preserved in SQLite and rendered as placeholders with warnings when possible.
- Media copying is conservative and based on relative media paths in the export.
- The generated archive is a reading copy; use `.igdm/state.sqlite` as canonical state.
