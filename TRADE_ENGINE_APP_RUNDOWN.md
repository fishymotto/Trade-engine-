# Trade Engine App Rundown

Last updated: June 26, 2026

## What Trade Engine Is

Trade Engine is a Windows desktop app for reviewing, journaling, and improving trading performance. It turns raw PPro8 Trade Detail CSV exports into grouped trades, then connects those trades to dashboards, reports, daily journals, playbooks, reviews, notes, and workspace sync tools.

The app is built to be local-first: it works as a desktop workspace on the current computer, with optional Supabase login for cloud sync and manual Send Workspace / Receive Workspace files for moving updates between machines.

## The Main Workflow

1. Import a trade CSV
   - Open Imports.
   - Load a PPro8 Trade Detail CSV.
   - The app parses the executions, groups fills into trades, calculates P&L/fees, and stages the result.

2. Save and review trades
   - Save the staged import into the local trade database.
   - Use Trades and Trade History to review each trade, edit status, assign playbooks, add mistakes, and inspect related executions.
   - Trade tags and overrides are saved so later reviews keep the same context.

3. Journal the day
   - Open Journal for a trading date.
   - Use the morning checklist, closing checklist, morning journal, closing journal, trade notes, screenshots, headlines, and weekly improvement goals.
   - Journal trade notes can stay linked to imported trades so review notes and trade context stay together.

4. Study performance
   - Dashboard gives the fast read: recent sessions, week/month metrics, MPP, best/worst days, top symbols, and intraday breakdowns.
   - Reports gives deeper filtering and comparisons by date range, playbook, symbol, status, game, execution, mistake, session, and time of day.

5. Build process memory
   - Library stores trading notes, trading/poker books, quotes, Strong Views, weekly reviews, monthly reviews, weekly improvement goals, and ticker groups.
   - Playbooks live inside the Library workspace and connect tagged trades, chart screenshots, A+ examples, notes, and performance back to each setup.

6. Export or sync when needed
   - Export a cleaned CSV for external use.
   - Import reviewed trades into Notion if the Notion token/database are configured.
   - Use Send Workspace and Receive Workspace to move selected dates or the full workspace between computers.
   - Optional Supabase sync can keep sessions, journals, settings, tags, reviews, charts, playbooks, library pages, headlines, select options, and templates in sync.

## Main Areas

- Dashboard: quick performance snapshot, filters, calendar view, MPP, risk bump indicators, session details, top symbols, and 30-minute P&L.
- Trades: focused review workspace for the currently loaded/imported trades.
- Trade History: saved trade database with search, filters, and bulk tag updates.
- Journal: daily journal pages with checklists, rich-text notes, screenshots, trade-note linking, headlines, and weekly goals.
- Library: notes, books, quotes, Strong Views, weekly/monthly reviews, ticker groups, chart library, and playbooks.
- Reports: period comparisons, filtered performance summaries, chart panels, playbook/mistake/execution breakdowns, and session analysis.
- Imports: PPro8 CSV import, cleaned CSV export, Notion import, Send Workspace, and Receive Workspace.
- Data: saved import/session manager.
- Settings: Notion/Twelve Data keys, export folder, desktop backup settings, attachment audit/cleanup, and workspace preferences.

## How The App Works Under The Hood

- Frontend: React + TypeScript in `src/`.
- Desktop shell/backend: Tauri + Rust in `src-tauri/`.
- App orchestration: `src/app/App.tsx` wires the routes, workspace state, imports, exports, sync, persistence, and cross-page actions.
- Feature folders: `src/features/` holds the major app areas such as dashboard, grouping/trades, journal, library, reports, imports, data, settings, and playbooks.
- Shared logic: `src/lib/` holds analytics, sync, storage, trade tags, journals, reviews, playbooks, workspace transfer, and utility code.
- Local storage and desktop backups protect the workspace even when cloud sync is unavailable.
- Supabase sync is optional and only active when the app is built/run with the configured Supabase environment values.

## Quick Run Notes

For development on Windows:

```powershell
npm install
npm run desktop:doctor
npm run desktop:dev
```

For a packaged Windows build:

```powershell
npm run desktop:work-pc
```

That creates installer output under `dist/work-pc/`. The packaged app can be installed and launched from Windows like a normal desktop app.

## Share-Safe Notes

This file is safe to share because it does not include API keys, Supabase credentials, Notion tokens, private trade data, or local machine paths beyond normal project folder examples.
