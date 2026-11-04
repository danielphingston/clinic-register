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

### 1. Screenshots

Never commit screenshots or other images made for a PR to the repository. GitHub has no API for attaching images to a PR, so PRs carry no screenshots.

- Still take screenshots of every UI change, to check it yourself before opening the PR (e.g. empty, filled, error, hover, and phone width with Playwright `devices['iPhone 13']`).
  - Use Playwright against `VITE_GOOGLE_CLIENT_ID=x npx vite --port 5199`.
  - To skip sign-in, set `localStorage['auth:profile']` to `{"sub":"1","email":"d@x.com","name":"D"}`, reload, and click **Continue without restoring** if it appears.
  - To seed demo data, use `page.evaluate(async () => { const { db } = await import('/src/db/db.ts'); ... })`. This uses the same module instance as the app.
  - Element screenshots on long pages can catch the sticky header. Scroll the element below the header and take a viewport screenshot instead.
  - Save them in the scratchpad, never in the repository, and look at every image.
- In the PR body, add a **Screenshots** section. Say what changed on screen in a few lines, or that there is no visible change.

### 2. The tests added or changed

Add a **Tests** section to the PR body. For each test file, list the tests added or changed, by their `describe` › `it` names, with one line on what each one checks. End the section with the result of the full `npm test` run (files and test counts), plus lint and build.
