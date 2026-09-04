# Cadence MQ

Cadence is a task queue system, inspired by Agenda design (worker processes, job definitions, etc.) but designed to be backend agnostic. It is used in the [Papra](https://papra.app) ecosystem.

## Validation

From the root of the monorepo:

- `pnpm check`: Lint, format-check, and typecheck with oxlint/oxfmt/ts-go. Use `pnpm check:fix` for available automatic fixes.
- `pnpm test`: Run all package tests. Pass a test file path to run a focused test.
- `pnpm build:packages`: Build all publishable packages.

## Writing tests

- Do not use vitest's magic mocking and fake timers. Use dependency injection and the clock system (with the controlled clock for tests).
- Tests title should not start with "should" or "it".
- Tests title should describe the behavior, not the implementation. For example, "a failed job is retried" instead of "should call the retry function when the job fails".
