---
name: Gudang Pemaron orval codegen contract
description: How API params/schemas flow through openapi.yaml -> orval -> generated zod/react-query code, and the failure mode when a param is added ad-hoc.
---

The API layer (`lib/api-spec/openapi.yaml`) is the single source of truth. Running
`pnpm -C lib/api-spec run codegen` (orval) regenerates:
- `lib/api-zod/src/generated/**` (zod schemas/types used by the Express routes)
- `lib/api-client-react/src/generated/**` (react-query hooks used by the frontend)

**Rule:** any query param, body field, or response field a route handler or frontend
hook relies on must be declared in `openapi.yaml` first — never add it only to the
handler code or only pass it through fetch calls untyped.

**Why:** a `stockOnly` boolean query param on `/history` had been wired up directly in
the Express handler and the frontend call, without ever being added to `openapi.yaml`.
It worked by accident (JS is loose about extra query params) until an unrelated codegen
run regenerated `ListHistoryParams` from the spec and silently dropped the field,
breaking the frontend type. There was no compile error until the next full typecheck.

**How to apply:** before or immediately after adding a new query/body/response field
anywhere in the API, add it to the corresponding path/schema in `openapi.yaml`, then run
codegen, then typecheck both `artifacts/gudang` and `artifacts/api-server` to confirm
nothing else silently lost a field.
