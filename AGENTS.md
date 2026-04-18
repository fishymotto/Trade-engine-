# Agent Navigation Guide

This repo is a Tauri desktop app:

- `src/` is the React/TypeScript frontend.
- `src-tauri/` is the Rust backend.

## Frontend conventions

- App boot + wiring lives in `src/app/` (entry + root app). Keep this minimal and avoid feature logic here when possible.
- Feature code lives in `src/features/<feature>/`:
  - pages/components/hooks/services that are specific to a feature stay inside that feature folder.
- Shared UI components live in `src/components/` (only reusable components used across multiple features).
- Shared utilities/wrappers live in `src/lib/`.
- Shared types live in `src/types/`.
- Global styles live in `src/styles/`.

## Backend conventions

- Keep `src-tauri/src/main.rs` small: module declarations + `invoke_handler` registration only.
- Put Tauri command handlers in `src-tauri/src/commands/`.
- Put business logic (HTTP clients, processing) in `src-tauri/src/services/`.
- Put structs/types in `src-tauri/src/models/`.
- Put helper utilities (paths, small helpers) in `src-tauri/src/utils/`.

