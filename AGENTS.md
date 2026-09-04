# Cadence MQ

Cadence is a task queue system, inspired by Agenda design (worker processes, job definitions, etc.) but designed to be backend agnostic. It is used in the [Papra](https://papra.app) ecosystem.

## Validation

From the root of the monorepo:

- `pnpm check`: Lint, format-check, and typecheck with oxlint/oxfmt/ts-go. Use `pnpm check:fix` for available automatic fixes.
- `pnpm test`: Run all package tests. Pass a test file path to run a focused test.
- `pnpm build:packages`: Build all publishable packages.
