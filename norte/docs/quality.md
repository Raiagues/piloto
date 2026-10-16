# Quality strategy

The current prototype is small enough to keep quality checks explicit and fast.

## Static validation

TypeScript strict mode is enabled for application code. ESLint runs with zero warnings allowed.

## Automated tests

Vitest covers mission-domain behavior independently from React. The current suite checks card word limits, inconsistency detection, phase closure rules, progress calculation and focused graph traversal.

## Build validation

Every CI execution produces a complete Vite production build. This catches unresolved imports, invalid TypeScript output and bundling errors before deployment.

## Deployment gate

GitHub Pages deployment has a separate build job that repeats the complete quality command. The deployment job depends on that build and cannot start when quality checks fail.

## Future additions

As persistent data and API services are introduced, the quality strategy should add schema validation, integration tests, accessibility checks and browser-level end-to-end tests for mission-critical user flows.
