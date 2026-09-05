# Contributing to CadenceMQ

Thank you for your interest in CadenceMQ.

> CadenceMQ is undergoing a full rewrite. The public API and internal architecture are not stable yet.

## Prerequisites

- Node.js 26 (see [`.nvmrc`](./.nvmrc))
- pnpm 11.22.0 (see [`package.json`](./package.json))

## Setup

```bash
git clone https://github.com/papra-hq/cadence-mq.git
cd cadence-mq
pnpm install --frozen-lockfile
```

## Commands

Run these commands from the repository root:

- `pnpm check` — lint, format-check, and typecheck the repository
- `pnpm check:fix` — apply available lint and formatting fixes
- `pnpm test` — run all package tests
- `pnpm test:watch` — run package tests in watch mode
- `pnpm build:packages` — build publishable packages
- `pnpm build:packages:watch` — build publishable packages in watch mode

## Repository structure

```text
packages/core/           Core contracts, client, and worker
packages/driver-memory/  In-memory queue driver
packages/driver-libsql/  Durable LibSQL queue driver
```

## Pull requests

Before opening a pull request:

1. Run `pnpm check`.
2. Run `pnpm test`.
3. Run `pnpm build:packages`.
4. Add tests for new behavior.
5. Update the relevant package README when behavior changes.

Keep changes focused. Do not introduce a new public API or architectural direction without discussing it first.

## License

By contributing to CadenceMQ, you agree that your contributions are licensed under the repository's [MIT License](./LICENSE).
