# Mr CharlohFX

Automated Deriv trading bot platform — build, run, and optimise trading bots on Volatility indices without coding.

## Run & Operate

- `pnpm --filter @workspace/my-site run dev` — run the frontend (port 19578, rsbuild)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 18, rsbuild, MobX, Tailwind CSS, SCSS
- Bot engine: Blockly (no-code visual builder), Deriv API WebSocket
- Charts: @deriv/deriv-charts
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle for API)

## Where things live

- `artifacts/my-site/` — main frontend app (React + rsbuild)
- `artifacts/my-site/src/external/bot-skeleton/` — Blockly bot engine
- `artifacts/my-site/src/stores/` — MobX stores
- `artifacts/my-site/src/pages/` — page components (dashboard, bot-builder, tutorials, etc.)
- `artifacts/my-site/src/components/` — shared UI components
- `artifacts/my-site/src/utils/` — utility helpers
- `artifacts/my-site/public/` — static assets (logo, manifest, service worker)
- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/db/src/schema/` — Drizzle DB schema

## Architecture decisions

- Uses rsbuild (not Vite) for faster builds with Rspack bundler
- `@/utils/tmp/dummy` provides a stub `Icon` component for legacy @deriv/components icons that were removed from the main package
- Bot strategies defined in XML files under `src/xml/` and `src/external/bot-skeleton/examples/`
- MobX for global state management (stores pattern)
- PWA-enabled with service worker for offline support

## Product

- No-code bot builder using Blockly visual programming
- Speed bots for Volatility indices
- Real-time Deriv charts and market data via WebSocket
- Quick strategy templates (Martingale, D'Alembert, etc.)
- Live trade monitoring, journal, and transaction history

## User preferences

- Imported from GitHub: https://github.com/developercharloh/My-site
- Preserve original project structure and branding

## Gotchas

- `@/utils/tmp/dummy` is a stub for legacy @deriv/components Icon — it must stay
- rsbuild config reads `process.env.PORT` (defaults to 5000); artifact.toml sets PORT=19578
- Some rsbuild aliases: `@/external`, `@/components`, `@/hooks`, `@/utils`, `@/constants`, `@/stores`, `@/mocks`
- `@deriv/quill-icons/Illustration` is aliased to `src/mocks/quill-icons-illustration.tsx`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
