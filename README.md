# Clinic Register

Offline-first outpatient register for a homeopathy clinic. It is an installable PWA: data lives in the browser (IndexedDB) and syncs to the clinic's own Google Drive (the hidden app-data folder), optionally encrypted.

See `../opd-register-requirements.md` and `../opd-register-design.md` for scope and design.

## Features

- **Patients:** OP numbers (`OP-2026-00001`), search by name, phone or OP number, age from DOB or years, OP slip with QR code.
- **Visits:** tabbed case notes (complaint, history, mentals, generals, modalities, constitution), prescriptions with remedy autocomplete (seeded homeopathic remedy list plus your own), potency/dose/repetition presets, "repeat last prescription", follow-up dates. Leaving a visit with unsaved changes asks first.
- **Appointments:** day/week/month calendar, booking with overlap checks, walk-ins, today's queue with tokens, arrived → visit → done.
- **Billing:** bills from a visit (consultation fee + dispensed medicines), counter sales from stock, discounts, part payments, FIFO collection across bills, receipts (amount in words), voids and payment reversals, dues list with ageing and WhatsApp reminders.
- **Stock:** medicines by remedy/potency/form, purchases, adjustments, dispensing from the visit or a counter sale, full history, low-stock alerts.
- **Reports:** OP register, patients, revenue, collections, dues, top remedies, stock usage, appointments; date presets, charts, A4 print and Excel export.
- **Attachments:** photos and PDFs per patient/visit, compressed on the device, synced to Drive.
- **Reminders:** header bell and optional daily notifications (appointments, follow-ups, overdue dues, low stock).
- **Sync and safety:** works fully offline; automatic Drive sync across devices; optional passphrase encryption of the Drive copy; JSON backup/restore and "Export all data" to Excel.

## Daily use (short user guide)

1. **Morning:** open the app (it works offline). The dashboard shows today's queue, follow-ups due, overdue dues and low stock. The bell in the header counts what needs attention.
2. **Patient arrives:** find them under Patients (or "+ New patient"), or mark the booked appointment **Arrived** in Today's queue to give a token. **Start visit** opens the case form.
3. **Visit:** write the case notes, add remedies (type a few letters and press Enter), pick the stock item and quantity to dispense, set a follow-up. **Save & print Rx** or **Save & bill**.
4. **Billing:** the bill is prefilled with the consultation fee and dispensed medicines. Enter what was paid now; the balance gets a due date and appears under Billing → Dues. Use **+ Medicine from stock** for a counter sale (it takes the quantity out of stock; voiding or editing the bill puts it back).
5. **Evening:** check Reports → OP Register for the day and today's collection on the dashboard.

**How sync works.** Every change is saved on the device first. When online, the app syncs to your Google Drive about 30 seconds after edits, when the tab is hidden, when it comes back online, and when you press **Sync now** (header chip). Each device needs to sign in with the same Google account. If two devices change the same record, the newer edit wins; duplicate OP or bill numbers are renumbered with a notice. A banner warns if another device was active in the last few minutes.

**Encryption warning.** Settings → Sync & Security → *Encrypt Drive backup* encrypts the Drive copy with a passphrase. If you forget the passphrase, **the Drive copy cannot be recovered**; data on devices that still have it is not affected. Other devices ask for the passphrase once.

**Backups.** Drive sync is your continuous backup. In addition, Settings → Sync & Security → *Download a backup file (.json)* saves everything (optionally with attachments); *Import backup* merges such a file back (newer records win, nothing is deleted). Settings → *Export all data to Excel* writes a workbook for your accountant or records. Keep a monthly copy somewhere other than Google Drive. Clearing the browser's site data deletes the local copy: sync first.

## Production setup

### 1. Google Cloud OAuth client

1. In Google Cloud Console, create a project.
2. Under **APIs & Services → Library**, enable the **Google Drive API**.
3. Set up the **OAuth consent screen** (Google Auth Platform → Branding / Audience / Data access):
   - User type **External** (or Internal on Google Workspace).
   - Scopes: `openid`, `email`, `profile` and `https://www.googleapis.com/auth/drive.appdata`. The app only sees its own hidden app-data folder, never the user's Drive files.
   - **Testing vs In production.** In *Testing*, only the listed test users (up to 100) can sign in, and Google may ask them to grant consent again after a while. The 7-day refresh-token expiry of testing mode doesn't apply here, because the app uses the browser token flow (short-lived access tokens, no refresh tokens). For a single clinic, Testing with the doctor's and staff's accounts as test users is fine. *In production* lets any Google account sign in; `drive.appdata` is not a sensitive or restricted scope, but Google may still ask you to verify the app's branding (name, logo, privacy policy link) before the consent screen stops showing the "unverified app" notice.
4. **Credentials → Create credentials → OAuth client ID**, type **Web application**:
   - **Authorised JavaScript origins:** your production URL (e.g. `https://clinic.example.com`), plus `http://localhost:5173` and `http://localhost:4173` for development. Origins must match exactly (scheme, host and port; no trailing slash or path).
   - No redirect URIs: the app uses the Google Identity Services token popup.
5. Copy the client ID into `VITE_GOOGLE_CLIENT_ID`.

### 2. Environment variables

| Variable | Needed | Meaning |
|---|---|---|
| `VITE_GOOGLE_CLIENT_ID` | yes | OAuth web client ID. Without it the app shows "Google sign-in is not configured". It is public (it ends up in the JS bundle). |
| `VITE_BASE` | only for sub-path hosting | Path the app is served from, with leading and trailing slash (e.g. `/clinic-register/` for GitHub Pages). Defaults to `/`. |
| `VITE_DRIVE_API_BASE`, `VITE_DRIVE_UPLOAD_BASE` | **never in production** | Dev/E2E only: point sync at `scripts/mock-drive.mjs`. A `localhost` value also turns on a dummy-token bypass. Leave unset for real deployments. |

These are build-time variables (Vite inlines them), so set them in the hosting provider's build settings or `.env.production.local`, then rebuild.

### 3a. Deploy to GitHub Pages (set up)

`.github/workflows/deploy.yml` runs lint, tests and the build on every push to `master`, then publishes to `https://<user>.github.io/<repo>/`. One-time setup:

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Repo **Settings → Secrets and variables → Actions → Variables** tab → add `VITE_GOOGLE_CLIENT_ID`. It is a variable, not a secret, because the client ID is public.
3. In Google Cloud, add `https://<user>.github.io` to the OAuth client's authorised JavaScript origins. Use the origin only: no `/clinic-register` path.
4. Push to `master`, or run the workflow manually from the Actions tab.

The workflow builds with `VITE_BASE=/<repo>/` and copies `index.html` to `404.html`. GitHub Pages has no rewrite rules, so this is what lets a deep link like `/clinic-register/patients/…` load the app on first visit; after that the service worker serves every route. `_redirects`/`_headers` are ignored by GitHub Pages. Pages sets a 10-minute cache on everything, so a new deploy can take up to 10 minutes before the update prompt appears.

### 3b. Deploy to Netlify or Cloudflare Pages

Any static host works. Settings for both providers:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 20 or newer (`NODE_VERSION=20`) |
| Env | `VITE_GOOGLE_CLIENT_ID=<your client id>` |

`public/_redirects` and `public/_headers` are copied into `dist/` and are read by both Netlify and Cloudflare Pages:

- `_redirects`: `/* /index.html 200`, the SPA fallback, so deep links like `/patients/…` load the app.
- `_headers`: `Cache-Control: no-cache` for `/sw.js`, `/index.html` (and `/`) and the manifest, so a new deploy is noticed; hashed `/assets/*` are cached for a year.

After deploying, add the site URL to the OAuth client's authorised origins. On first visit the app precaches everything for offline use. Later deploys show "A new version is available → Update"; the app never reloads itself mid-visit. It must be served over HTTPS (except on localhost) for the service worker, install prompt and notifications.

**Install:** Chrome/Edge show an install button in the address bar (desktop) or "Install app" in the menu (Android). On iPhone/iPad use Safari → Share → *Add to Home Screen*. Icons are generated from `public/icon.svg` by `node scripts/make-icons.mjs`.

## Development

```bash
npm install
cp .env.example .env.local   # then fill in VITE_GOOGLE_CLIENT_ID (optional for tests)
npm run dev                  # http://localhost:5173
```

- **Demo data:** in `npm run dev`, open `/dev/seed` (dev-only route, absent from production builds) to add about 3 months of visits, bills, stock and appointments for 20 patients.
- **Mock Drive:** `node scripts/mock-drive.mjs --port 4180 --dir /tmp/mock-drive`, then build with `VITE_DRIVE_API_BASE=http://localhost:4180/drive/v3 VITE_DRIVE_UPLOAD_BASE=http://localhost:4180/upload/drive/v3 npm run build` and `npm run preview`. Two browser profiles act as two devices. Admin endpoints: `/__admin/files`, `/__admin/file?name=`, `/__admin/fail?status=503&count=N`.
- **Tests:** `npm test` runs everything in jsdom with fake-indexeddb and the clock in IST (`TZ=Asia/Kolkata`, set in `vitest.config.ts`). `npx vitest run src/features/billing` runs one folder; `npx vitest --sequence.shuffle` checks for order dependence. Google is mocked; no credentials needed. The test setup stops the sync service after every test.
- **Accessibility check:** `axe-core` is a dev dependency; inject `node_modules/axe-core/axe.min.js` into a page and run `axe.run()`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check and production build (with service worker) |
| `npm run preview` | Serve the production build on :4173 (test PWA install/offline here) |
| `npm test` | Unit + UI tests (Vitest, jsdom, fake-indexeddb). Google is mocked and the client ID is forced blank, so no credentials are needed. |
| `npm run lint` | ESLint (must be clean: 0 errors, 0 warnings) |
| `node scripts/make-icons.mjs` | Regenerate the PNG app icons from `public/icon.svg` |

## Layout

```
src/
  app/        layout, sign-in, PWA update prompt, error boundary, lazy-route helper
  auth/       Google Identity Services token flow, auth context (useAuth in useAuth.ts)
  db/         Dexie schema, types, repository helpers (+ tests)
  features/   one folder per screen
  lib/        small shared hooks/utilities (format, age, debounce, compress)
  sync/       Drive sync engine: REST client, merge, crypto, change tracking, backup file
  print/      A4 print views (routes outside the app layout)
  data/       remedies.json seed list
  dev/        /dev/seed demo data (dev builds only)
  sw.ts       service worker
scripts/
  mock-drive.mjs   dev/E2E-only stand-in for the Drive v3 endpoints (never bundled)
  make-icons.mjs   PNG icons from public/icon.svg (sharp)
public/
  icon.svg, icon-192/512.png, icon-maskable-512.png, apple-touch-icon.png, screenshots/
  _redirects, _headers   SPA fallback and cache headers for Netlify / Cloudflare Pages
```

## Notes

- Sign-in is required once. After that the app opens offline; a Google token is only needed for Drive sync.
- All synced records carry `id`, `createdAt`, `updatedAt` and `deleted` (a tombstone). Never hard-delete synced records: use `softDelete`.
- The remedy master is seeded from `src/data/remedies.json` on first sign-in (guarded by the `seed:remedies:v1` kv flag). Seeded remedies have deterministic ids (`rem-<slug>`) so independent seeds on two devices merge cleanly.
- Print views live at `/print/...` outside the layout; they print only when the user clicks Print.
- The calendar (`/calendar`) is lazy-loaded so FullCalendar stays out of the main bundle. Import `@fullcalendar/*` only from `src/features/appointments/CalendarPage.tsx`; shared appointment UI (booking/details dialogs, queue) must not import it.
- Attachment compression lives in `src/lib/compress/`. pdf.js and pdf-lib are imported only from `pdf.ts` via dynamic `import()`, so they stay in a lazy chunk; never import them elsewhere. The pdf.js worker is a `?url` asset and its wasm decoders are emitted to `/pdfjs-wasm/` by the `pdfjsWasm` plugin in `vite.config.ts`; both are precached (`globPatterns` includes `mjs`/`wasm`, size limit 5 MB) so compression works offline.
- Blobs are content-addressed (SHA-256) and write-once: never modify a stored blob, only its `synced` flag.
- The service worker is custom (`src/sw.ts`, vite-plugin-pwa `injectManifest`): workbox precache + `index.html` navigation fallback, `SKIP_WAITING` for the update prompt, `notificationclick` (focuses the app and posts `{type:'navigate', url}`), and `periodicsync` tag `daily-reminders`. It is type-checked by `tsconfig.sw.json` (WebWorker lib); keep anything it imports free of DOM/`window` and of `src/db/db.ts`.
- Reports (`/reports`, lazy) are built as data by `src/features/reports/reportDefs.ts` from the pure-ish queries in `reportQueries.ts`; the screen, `/print/report/:type?from=&to=` and the Excel export all render that same data. Recharts is imported only from `ReportChart.tsx` and SheetJS (`xlsx`, from the SheetJS CDN tarball) only via dynamic `import('xlsx')`.
- Routes: only the dashboard is in the main chunk; every other page (and each print view) is a lazy chunk via `lazyPage()` in `src/app/lazyPage.ts`, wrapped in a route `ErrorBoundary` + `Suspense` (Layout and the print `Page` wrapper). React, the router and Dexie are split into `vendor-*` chunks (`manualChunks` in `vite.config.ts`). Everything is precached, so lazy routes still open offline. A chunk that fails to load (stale deploy) shows "A newer version is available → Reload", which activates the waiting service worker first.
- The app uses a data router (`createBrowserRouter`) so the visit form can use `useBlocker` for its unsaved-changes prompt.
- Live queries must be async functions: `useLiveQuery(async () => helper())`. Dexie only keeps dependency tracking across `await`s when the querier itself is `async`; a plain `() => helper()` stops tracking after the helper's first await and the UI silently misses later changes. ESLint enforces this (`no-restricted-syntax`).
- Counter sales: a bill line with `sale: true` (added with "+ Medicine from stock") takes its `qty` out of stock through a `dispense` move with `refId` = bill id; editing the bill corrects it and voiding returns it (`syncBillSale` in `stockRepo.ts`). Lines copied from a visit's dispensing don't have `sale` set, because the visit already moved the stock.

## Drive sync (phase 7)

- Engine: `src/sync/engine.ts` (`SyncEngine` takes a `ClinicDB` and a `DriveClient`, so tests run two "devices" against `FakeDrive`). App glue: `src/sync/service.ts` (`syncService`, `useSyncStatus()`); UI in `src/features/sync/`.
- Drive layout (appDataFolder): `manifest.json` (tables → file ids, `gen`, encryption info), `data-<table>.json` (a new file per push; the manifest says which is current; superseded copies are swept after 1 h), `blob-<sha256>` (`.g<N>` suffix after an encryption change), `lock.json`.
- Local change tracking: Dexie hooks on every synced table (and the `settings` kv entry) bump counters in localStorage. Sync's own writes run in transactions tagged `SYNC_APPLY` and are not counted. Writes that bypass Dexie (none today) would not be synced.
- Only kv `settings` syncs; counters (`seq:*`), `sync:*` state, the cached key and `sync:owner` stay per device. After a pull the counters are raised to the highest number in the data; duplicate OP/bill numbers are renumbered (newer record) with a visible notice.
- Testing against the mock Drive:
  ```bash
  node scripts/mock-drive.mjs --port 4180 --dir /tmp/mock-drive &
  VITE_DRIVE_API_BASE=http://localhost:4180/drive/v3 \
  VITE_DRIVE_UPLOAD_BASE=http://localhost:4180/upload/drive/v3 npm run build
  ```
  **Auth bypass gate:** when `VITE_DRIVE_API_BASE` is a `localhost`/`127.0.0.1` URL (`isMockDrive()` in `src/sync/drive.ts`), `getToken()` returns a dummy token. It cannot trigger against googleapis.com; never set these variables in a real deployment build.
- In Vitest the default Drive factory is off (`MODE === 'test'`); tests install a fake with `syncService.setDriveFactory(...)`.
