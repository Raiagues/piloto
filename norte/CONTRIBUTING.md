# Contributing

Norte uses a mandatory quality gate for every change.

## Development

```bash
# From the repository root:
./setup   # prepares tools, dependencies, configuration and the frontend build
./start   # runs in the background; ./stop ends it
```

See [Run locally](../README.md#executar) for the integrated installation. For frontend/API development, run `npm run dev` from `norte/`; the meeting worker is started by the root launcher.

Before opening a pull request, run

```bash
npm --prefix norte run quality
```

This command performs the TypeScript typecheck, ESLint validation, unit tests and the production Vite build.

## Pull requests

Keep changes focused. New mission rules should be implemented in the domain model and covered by tests before being exposed in the interface. Platform-controlled text must be added in both Portuguese and English.

Do not close a mission phase by changing interface state alone. Phase validation rules belong in the mission domain model so the same rules can later be used by an API or other clients.
