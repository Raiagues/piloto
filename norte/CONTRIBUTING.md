# Contributing

Norte uses a mandatory quality gate for every change.

## Development

```bash
./setup   # Node.js 24.20, npm packages, .env and the local database
./start   # runs in the background; ./stop ends it
```

See [Run locally](README.md#run-locally) for details, or [manual setup](README.md#manual-setup) to use `npm run dev` directly.

Before opening a pull request, run

```bash
npm run quality
```

This command performs the TypeScript typecheck, ESLint validation, unit tests and the production Vite build.

## Pull requests

Keep changes focused. New mission rules should be implemented in the domain model and covered by tests before being exposed in the interface. Platform-controlled text must be added in both Portuguese and English.

Do not close a mission phase by changing interface state alone. Phase validation rules belong in the mission domain model so the same rules can later be used by an API or other clients.
