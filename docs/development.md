# Development

## Setup

```bash
npm install
cp .env.example .env.local   # set VITE_GOOGLE_CLIENT_ID (not needed for tests)
npm run dev                  # http://localhost:5173
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and create a production build, including the service worker |
| `npm run preview` | Serve the production build on port 4173 (use this to test installation and offline mode) |
| `npm test` | Run unit and UI tests |
| `npm run lint` | Run ESLint. The codebase is kept at 0 errors and 0 warnings. |
| `node scripts/make-icons.mjs` | Regenerate the PNG app icons from `public/icon.svg` |

## Demo data

In development builds, open `/dev/seed` to generate about three months of visits, bills, stock and appointments for 20 patients. The route is not included in production builds.

## Mock Google Drive

`scripts/mock-drive.mjs` stands in for the Drive v3 endpoints, so you can test sync without a Google account:

```bash
node scripts/mock-drive.mjs --port 4180 --dir /tmp/mock-drive
VITE_DRIVE_API_BASE=http://localhost:4180/drive/v3 \
VITE_DRIVE_UPLOAD_BASE=http://localhost:4180/upload/drive/v3 \
npm run build && npm run preview
```

Two browser profiles act as two devices. The admin endpoints are `/__admin/files`, `/__admin/file?name=` and `/__admin/fail?status=503&count=N`, the last of which injects failures.

When `VITE_DRIVE_API_BASE` points at `localhost`, the app skips Google sign-in and uses a dummy token. Never set these variables in a production build.

## Tests

- Tests run in jsdom with `fake-indexeddb`, with the clock set to IST (`TZ=Asia/Kolkata`, configured in `vitest.config.ts`).
- Google is mocked and the client ID is forced to blank, so no credentials are needed.
- To run one folder: `npx vitest run src/features/billing`.
- To check for order dependence: `npx vitest --sequence.shuffle`.
- The test setup stops the sync service after every test.
- Accessibility: `axe-core` is a dev dependency. Inject `node_modules/axe-core/axe.min.js` into a page and call `axe.run()`.

## Project layout

```
src/
  app/        layout, sign-in, PWA update prompt, error boundary, lazy-route helper
  auth/       Google Identity Services token flow and auth context
  db/         Dexie schema, types and repository helpers
  features/   one folder per screen
  lib/        shared hooks and utilities (formatting, age, WhatsApp, compression)
  sync/       Drive sync engine: REST client, merge, crypto, change tracking, backups
  print/      A4 print views (routes outside the app layout)
  data/       seed remedy list
  dev/        demo data generator (development builds only)
  sw.ts       service worker
scripts/
  mock-drive.mjs   development stand-in for the Drive v3 API (never bundled)
  make-icons.mjs   generates PNG icons from public/icon.svg
public/
  icons, screenshots, privacy.html, terms.html
  _redirects, _headers   SPA fallback and cache headers for Netlify / Cloudflare Pages
```

See [Architecture](architecture.md) for design details and the conventions to follow when changing the code.
