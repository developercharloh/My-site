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
- **Critical fixes applied**:
  1. `rsbuild.config.ts` — XML files use `asset/source` (not `raw-loader`); PORT read from env var
  2. `scripts/translations-patcher-loader.cjs` — custom rspack pre-loader that patches `@deriv-com/translations` dist files. The loader replaces the bundled `jsx-runtime` file with a redirect to the host React's `react/jsx-runtime`, fixing two issues: (a) the CJS dynamic `require('react')` call in dev mode, and (b) the element symbol mismatch between the bundled rolldown jsx-runtime (uses `react.transitional.element`) and host React 18.3.1 (uses `react.element`)
  3. `src/mocks/quill-icons-illustration.tsx` + alias in rsbuild — provides a fallback SVG for `@deriv/quill-icons/Illustration` which has a broken `exports` field in v2.4.18 (the actual dir is `Illustrative`, not `Illustration`)
  4. `resolve.alias` for `react` and `react-dom` — ensures all packages share the same React singleton
  5. `source.define` for env vars (APP_ENV=staging, TRANSLATIONS_CDN_URL, etc.)

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
