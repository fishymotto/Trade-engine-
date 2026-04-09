# Trade Engine

Cyberpunk-themed Tauri desktop app for importing one PPro8 Trade Detail CSV, grouping executions into trades, exporting a Notion-ready CSV, and optionally importing new rows into Notion.

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

## TODO

- Verify the exact PPro8 Trade Detail header names against a real sample export and tighten the alias list in `src/lib/parser/csvParser.ts`.
- Add a proper duplicate review modal instead of the current confirm dialog.
- Add automated tests for grouping, flip handling, and tag rules.
