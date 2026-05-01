# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Artifacts

### my-site (`artifacts/my-site`)
- **Source**: Imported from https://github.com/developercharloh/My-site
- **Type**: React app using rsbuild (not Vite) + Rspack
- **Description**: Deriv Bot — a trading workspace application
- **Build tool**: rsbuild v1.7.5
- **Key dependencies**: MobX, Blockly, Deriv API, Deriv Charts, TailwindCSS v4, i18next
- **Dev server**: `pnpm --filter @workspace/my-site run dev` (port 19578)
- **Notes**: Uses `asset/source` (not `raw-loader`) for XML files. Config in `rsbuild.config.ts`.

### api-server (`artifacts/api-server`)
- Express 5 API server, serves at `/api`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/my-site run dev` — run my-site dev server

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
