# Trade Engine

Cyberpunk-themed Tauri desktop app for importing one PPro8 Trade Detail CSV, grouping executions into trades, exporting a Notion-ready CSV, and optionally importing new rows into Notion.

## TODO

- Verify the exact PPro8 Trade Detail header names against a real sample export and tighten the alias list in `src/lib/parser/csvParser.ts`.
- Add a proper duplicate review modal instead of the current confirm dialog.
- Add automated tests for grouping, flip handling, and tag rules.
