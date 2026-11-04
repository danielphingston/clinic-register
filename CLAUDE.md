# Clinic Register

Offline-first clinic register PWA (React, TypeScript, Vite, Dexie). See `docs/` for architecture and development notes.

## Checks

Run all three before committing:

```bash
npm test
npm run lint
npm run build
```

## Pull requests

Every pull request must include the following.

### 1. Screenshots of every UI change

- Take screenshots of each screen or state the change affects (e.g. empty, filled, error, hover, mobile). Take at least one at phone width (Playwright `devices['iPhone 13']`) when the layout is responsive.
- Use Playwright against `VITE_GOOGLE_CLIENT_ID=x npx vite --port 5199`, at `deviceScaleFactor: 2`.
  - To skip sign-in, set `localStorage['auth:profile']` to `{"sub":"1","email":"d@x.com","name":"D"}`, reload, and click **Continue without restoring** if it appears.
  - To seed demo data, use `page.evaluate(async () => { const { db } = await import('/src/db/db.ts'); ... })`. This uses the same module instance as the app.
  - Element screenshots on long pages can catch the sticky header. Scroll the element below the header and take a viewport screenshot instead.
- Look at every image before using it.
- Commit the images to `docs/pr-screenshots/<short-feature-name>/`, numbered in reading order (`1-…png`, `2-…png`).
- Embed them in the PR body with
  `![caption](https://github.com/danielphingston/clinic-register/blob/<branch>/docs/pr-screenshots/<feature>/<file>.png?raw=true)`.
  This form renders for private repositories too.
- If there is no visible change, say so in a **Screenshots** section instead of leaving the section out.

### 2. The tests added or changed

Add a **Tests** section to the PR body. For each test file, list the tests added or changed, by their `describe` › `it` names, with one line on what each one checks. End the section with the result of the full `npm test` run (files and test counts), plus lint and build.
