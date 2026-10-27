# Frontend conventions (frontend/)

Vite 6 + React 19 + TypeScript + react-router-dom 7. Applies to everything under `frontend/`; the root CLAUDE.md still applies.

## Commands
- `npm install`, `npm run dev` (http://localhost:5173; `/api` is proxied to http://localhost:5080)
- `npm run build` runs `tsc -b && vite build`; it must pass before you finish.

## Rules
- TypeScript strict mode stays on (`tsconfig.app.json` also sets `noUnusedLocals`/`noUnusedParameters`). No `any`; no `@ts-ignore` without a comment saying why.
- Every screen handles loading, empty and error states by rendering through `src/components/StateView.tsx` with the `useAsync` hook (`src/hooks/useAsync.ts`). Give `StateView` a specific `emptyText`.
- All HTTP goes through `src/api/client.ts` (`getJson`, `ApiError`). No `fetch` calls in components or pages. Add per-resource functions in `src/api/*.ts` and DTO types in `src/api/types.ts`. If you need POST/PUT, add the helper to `client.ts` and keep its ProblemDetails error handling.
- Pages live in `src/pages/`, shared UI in `src/components/`. Routes are wired in `src/App.tsx`.
- Keep API shapes in step with the backend DTOs; the backend is the source of truth.

## Tests
- Name tests `AC_NN_Description` (for example `AC_12_BoardShowsEmptyStateWhenNoRooms`), matching the acceptance criteria in `docs/specs/`.
- Use React Testing Library for component tests or Playwright for end-to-end. Neither is installed yet: add the runner and its `npm` script in the same change as the first test.
- Mock at the `src/api/client.ts` boundary, not `fetch`, for component tests. Cover loading, empty and error for each screen.
