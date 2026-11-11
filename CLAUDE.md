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

Every change must be covered by tests: add or update tests for each new behaviour and each bug fixed, including UI changes (Testing Library UI tests).

Every pull request must include a **Tests** section in its body. For each test file, list the tests added or changed, by their `describe` › `it` names, with one line on what each one checks. End the section with the result of the full `npm test` run (files and test counts), plus lint and build.
