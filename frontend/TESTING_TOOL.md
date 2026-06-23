# Frontend Test CLI

`frontend/scripts/frontend-test-cli.mjs` is a zero-dependency test helper for this Vite + React frontend.

## Run

```bash
npm run test:cli
```

## Modes

```bash
npm run test:cli -- all
npm run test:cli -- structure
npm run test:cli -- routes
npm run test:cli -- navigation
npm run test:cli -- encoding
npm run test:cli -- build
```

## What it checks

- core frontend files exist
- routed components can be resolved
- navigation paths match declared routes
- role navigation blocks are populated
- source files contain possible garbled text
- build smoke test passes

## Output

The CLI writes a machine-readable report to:

`test-reports/frontend-cli-report.json`
