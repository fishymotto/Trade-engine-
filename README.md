# Trade Engine

Cyberpunk-themed Tauri desktop app for importing one PPro8 Trade Detail CSV, grouping executions into trades, exporting a Notion-ready CSV, and optionally importing new rows into Notion.

## Project Structure

- `src/app/`: React app entry + root `App` orchestration.
- `src/features/`: Feature folders (pages + feature-specific UI/logic).
  - `src/features/import/`: CSV import + staging.
  - `src/features/grouping/`: Execution grouping + trade review UI.
  - `src/features/export/`: CSV export logic.
  - `src/features/notion/`: Notion export/sync logic.
- `src/components/`: Shared, reusable UI components used across features.
- `src/lib/`: Shared utilities/wrappers (cross-feature logic).
- `src/types/`: Shared TypeScript types.
- `src/styles/`: Global styles.
- `src-tauri/src/`: Rust (Tauri) backend.
  - `src-tauri/src/main.rs`: App bootstrap + command registration (keep minimal).
  - `src-tauri/src/commands/`: Tauri command handlers (`#[tauri::command]`).
  - `src-tauri/src/services/`: Business logic / HTTP clients.
  - `src-tauri/src/models/`: Rust structs/types (serde models).
  - `src-tauri/src/utils/`: Helpers (paths, etc).

## Running On A New Windows Computer

This app is a Tauri desktop project, so a fresh machine needs a few native dependencies before `npm run desktop:dev` will work.

1. Install Node.js LTS.
2. Install Rust, then make sure the MSVC toolchain is active with `rustup default stable-msvc`.
3. Install Visual Studio 2022 Build Tools with the C++ workload.
4. Make sure Microsoft Edge WebView2 Runtime is installed.
5. In the repo, run `npm install`.
6. Run `npm run desktop:doctor` to verify the machine is ready.
7. Run `npm run desktop:dev`.

Helpful install commands on Windows:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
rustup default stable-msvc
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" --accept-package-agreements --accept-source-agreements
```

WebView2 download:

https://developer.microsoft.com/en-us/microsoft-edge/webview2/

If `npm run desktop:dev` still fails on a new machine, run `npm run desktop:doctor` first. The preflight script now checks for Node, npm, Cargo, the MSVC Rust toolchain, Visual Studio Build Tools, WebView2, and whether this repo's dependencies have been installed.

## Cross-Device Data Sync (Supabase)

This app supports syncing your workspace (sessions, journal pages, settings, tags, reviews, charts, playbooks, library notes, etc.) across machines via Supabase.

1. Create a Supabase project (or use an existing one).
2. In Supabase, open the SQL editor and run `scripts/supabase.sql`.
3. Create a local env file by copying `.env.example` to `.env.local` and set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Run the app and sign in (or create an account) in the in-app auth screen.

Notes:
- Data is cached locally (offline-first) and synced to Supabase after login.
- Attachments saved by the desktop app are currently stored on the local machine; only the attachment paths are stored in synced data.

## TODO

- Verify the exact PPro8 Trade Detail header names against a real sample export and tighten the alias list in `src/features/import/lib/csvParser.ts`.
- Add a proper duplicate review modal instead of the current confirm dialog.
- Add automated tests for grouping, flip handling, and tag rules.
