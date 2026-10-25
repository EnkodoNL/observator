Real lockfiles generated from `package.json` in this directory on 2026-10-25, inside
`node:26.12.1-alpine`:

- `package-lock.json`: npm 12.2.1 (`npm install --package-lock-only`)
- `yarn-v1.lock`: yarn 1.22.22
- `yarn-berry.lock`: yarn 4.18.1 (`nodeLinker: node-modules`)
- `pnpm-lock.v9.yaml`: pnpm 12.15.0 (lockfile format 9.0, identical to pnpm 9 output)
- `pnpm-lock.v6.yaml`: pnpm 8.15.9 (lockfile format 6.0)

The package.json covers a scoped package, an `npm:` alias, a peer dependency
(react-dom -> react), dev dependencies, and the same package at several versions
(debug 2.6.9 via express, debug 4.3.4 as dev dependency).
