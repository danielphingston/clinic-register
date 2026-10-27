# Architecture

## Data

- All data lives in IndexedDB through Dexie (`src/db/db.ts`).
- Every synced record carries `id`, `createdAt`, `updatedAt` and `deleted`. Records are never hard-deleted; use `softDelete`, which leaves a tombstone so the deletion syncs.
- The remedy list is seeded from `src/data/remedies.json` on first sign-in, guarded by the `seed:remedies:v1` key-value flag. Seeded remedies have deterministic ids (`rem-<slug>`), so independent seeds on two devices merge cleanly.
- Attachment blobs are content-addressed (SHA-256) and write-once. Never modify a stored blob; only its `synced` flag changes.
- **Counter sales**: a bill line with `sale: true` takes its quantity out of stock through a `dispense` move whose `refId` is the bill id. Editing the bill corrects the move and voiding returns the stock (`syncBillSale` in `stockRepo.ts`). Lines copied from a visit don't set `sale`, because the visit has already moved the stock.

## Drive sync

- **Engine**: `src/sync/engine.ts`. `SyncEngine` takes a `ClinicDB` and a `DriveClient`, so tests can run two "devices" against `FakeDrive`.
- **App wiring**: `src/sync/service.ts` provides `syncService` and `useSyncStatus()`. The UI lives in `src/features/sync/`.
- **Drive layout** (all in `appDataFolder`):
  - `manifest.json`: maps tables to file ids, and holds the generation counter and encryption info.
  - `data-<table>.json`: a new file on every push. The manifest names the current one, and superseded copies are swept after an hour.
  - `blob-<sha256>`: attachments, with a `.g<N>` suffix after an encryption change.
  - `lock.json`
- **Change tracking**: Dexie hooks on every synced table, and on the `settings` key-value entry, bump counters in localStorage. Sync's own writes run in transactions tagged `SYNC_APPLY` and are not counted. A write that bypassed Dexie would not be synced.
- **What syncs**: of the key-value entries, only `settings`. Counters (`seq:*`), `sync:*` state, the cached key and `sync:owner` stay on each device. After a pull, counters are raised to the highest number in the data, and the newer of two records sharing an OP or bill number is renumbered, with a visible notice.
- **Mock Drive**: when `VITE_DRIVE_API_BASE` is a `localhost` or `127.0.0.1` URL (`isMockDrive()` in `src/sync/drive.ts`), `getToken()` returns a dummy token. This can never trigger against googleapis.com.
- **Tests**: the default Drive factory is disabled in Vitest. Tests install a fake with `syncService.setDriveFactory(...)`.

## Routing and code-splitting

- The app uses a data router (`createBrowserRouter`), which lets the visit form use `useBlocker` to prompt about unsaved changes.
- Only the dashboard is in the main chunk. Every other page, and each print view, is a lazy chunk loaded through `lazyPage()` (`src/app/lazyPage.ts`) and wrapped in an `ErrorBoundary` and `Suspense`.
- React, the router and Dexie are split into `vendor-*` chunks (`manualChunks` in `vite.config.ts`).
- If a chunk fails to load after a deploy, the app shows **A newer version is available → Reload**, which first activates the waiting service worker.
- Print views live under `/print/...`, outside the app layout. They print only when the user clicks Print.

### Heavy dependencies

Keep these confined to the modules below so they stay out of the main bundle:

| Library | Imported only from |
|---|---|
| FullCalendar (`@fullcalendar/*`) | `src/features/appointments/CalendarPage.tsx` |
| Recharts | `src/features/reports/ReportChart.tsx` |
| SheetJS (`xlsx`) | Dynamic `import('xlsx')` |
| pdf.js and pdf-lib | `src/lib/compress/pdf.ts`, via dynamic `import()` |

Shared appointment UI, such as the booking dialogs and the queue, must not import FullCalendar. The pdf.js worker is a `?url` asset, and its wasm decoders are emitted to `/pdfjs-wasm/` by the `pdfjsWasm` plugin in `vite.config.ts`. Both are precached so compression works offline.

## Reports

`src/features/reports/reportDefs.ts` builds each report as data from the queries in `reportQueries.ts`. The on-screen view, the print view (`/print/report/:type?from=&to=`) and the Excel export all render that same data.

## Service worker

`src/sw.ts` is a custom worker built with vite-plugin-pwa `injectManifest`. It handles:

- Workbox precaching, with `index.html` as the navigation fallback;
- `SKIP_WAITING`, used by the update prompt;
- `notificationclick`, which focuses the app and posts `{type: 'navigate', url}`;
- `periodicsync`, with the tag `daily-reminders`.

It is type-checked against the WebWorker lib by `tsconfig.sw.json`. Keep anything it imports free of DOM and `window` references, and don't import `src/db/db.ts`.

## Conventions

- **Live queries must be async functions**: write `useLiveQuery(async () => helper())`. Dexie keeps dependency tracking across `await`s only when the query function itself is `async`; with a plain `() => helper()`, tracking stops after the helper's first `await` and the UI silently misses later changes. ESLint enforces this (`no-restricted-syntax`).
- Sign-in is required once. After that the app opens offline; a Google token is needed only for Drive sync.
