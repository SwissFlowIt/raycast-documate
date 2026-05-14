# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — `ray develop`: hot-reload the extension inside Raycast.
- `npm run build` — `ray build -e dist -o dist`.
- `npm run lint` / `npm run fix-lint` — `ray lint` (uses `@raycast/eslint-config`).
- `npm run publish` — publish to the Raycast Store. Do NOT use `npm publish`; a `prepublishOnly` script intentionally aborts npm publishing.

No test suite is configured.

## Architecture

This is a Raycast extension that surfaces pages from a ServiceNow app called Documate. It has two entry points declared in [package.json](package.json):

1. **`search-pages`** (`mode: view`) — a list UI. Entry [src/search-pages.tsx](src/search-pages.tsx) re-exports [src/commands/search-pages/Command.tsx](src/commands/search-pages/Command.tsx).
2. **`search-pages-with-ai`** (Raycast AI tool) — natural-language search invoked by Raycast's AI runtime. Entry [src/tools/search-pages-with-ai.ts](src/tools/search-pages-with-ai.ts) (default export is `async (input: { query }) => string`).

Both talk directly to a ServiceNow instance via the REST Table API (`/api/now/table/x_sft_documate_*`). There is no intermediate backend.

### ServiceNow integration

- Credentials come from Raycast preferences (`instance`, `username`, `password`). The generated `Preferences` type is in [raycast-env.d.ts](raycast-env.d.ts) — regenerated from `package.json`, never hand-edit.
- Helpers in [src/lib/servicenow.ts](src/lib/servicenow.ts):
  - `getInstanceUrl(instance)` accepts either a bare identifier (becomes `https://<id>.service-now.com`) or a full `https://…` URL.
  - `createBasicAuthorizationHeader` builds the Basic auth header.
  - `serviceNowFetchOptions` returns `useFetch` options with a shared error toast handler and `keepPreviousData: true`.
- Tables used: `x_sft_documate_page`, `x_sft_documate_workspace`, `x_sft_documate_workspace_user`, `live_profile`.
- Documate page URL in-app: `…/x_sft_documate_app.do?w=<workspace>&p=<sys_id>`; backend record: `…/x_sft_documate_page.do?sys_id=<sys_id>`.

### `search-pages` view command

- Uses `@raycast/utils` `useFetch` with pagination — server-side LIKE query against `title/subtitle/content/workspace.name/parent.title` built from the search text, plus an optional `workspace` filter.
- Search text is normalized (NFD + strip diacritics + lowercase) by [src/lib/searchText.ts](src/lib/searchText.ts) `normalizeText`, then tokenized by `parseSearchText` which extracts `"quoted phrases"` separately from bare terms.
- `filtering={false}` — filtering happens on the server; the client only normalizes and sends.
- Results are grouped into time-ago sections ("Just now", "5 minutes ago", …) via [src/lib/getSectionTitle.ts](src/lib/getSectionTitle.ts). Note: ServiceNow returns timestamps without a timezone — code appends `" UTC"` / `" GMT"` before `new Date()`.
- View state (`show-details`, `show-preview`, `show-record-information`, `selected-workspace`) is persisted with `useCachedState`.
- The list renders `null` until `users.length > 0` because rows look up the updater's avatar/name in `userByName` and assume the user record exists.

### `search-pages-with-ai` AI tool

This is the more involved file. Pipeline:

1. **Plan generation** — sends a long structured prompt to `AI.ask` asking the model to return a `SearchPlan` JSON: `{ strategy: "snippets" | "full", blocks: [{ text_search?, filters? }], sort_by?, sort_order?, limit }`. The model is told to translate the query to English, separate retrieval anchors from answer goals, and avoid stuffing role/recency words into `text_search`.
2. **Robust JSON extraction** — `extractFirstJsonObject` strips code fences and grabs the first `{…}` block; failures fall back to `DEFAULT_PLAN` with a single `text_search` block of the raw query.
3. **Post-processing** (`postProcessSearchPlan`) — strips recency qualifiers (`latest`, `newest`, `último`, …) and removes author names from `text_search` when the same name already appears as a `sys_*_by` filter.
4. **Encoded-query construction** (`buildEncodedQuery`) — emits ServiceNow's full-text token `123TEXTQUERY321=<terms>` joined with structured filters via `^`. Knows about unary ops (`ISEMPTY`, …) and relative-date ops (`RELATIVEGE`, …, normalized by `normalizeRelativeFilterValue` into `@unit@ago@N` form). Adds `ORDERBY[DESC]<field>`. The whole string is `encodeURIComponent`'d before being injected into a URL.
5. **Fan-out** — **ServiceNow does not support `^NQ` (OR) with `123TEXTQUERY321`**, so when there are multiple blocks with text searches, the tool fires one request per block in parallel (`Promise.allSettled`) and merges/dedupes by `sys_id`. Single-block plans use one request.
6. **Sorting + slicing** — client-side `sortPages` by `plan.sort_by`/`sort_order`, then slice to `limit` (clamped 2–10).
7. **Context formatting** — for each surviving page, either the full content (`strategy: "full"`) or up to a few ~240-char snippets centered on matched tokens (`buildSnippets` reuses `normalizeText` + `parseSearchText` and maps normalized offsets back to original code-unit offsets via `normalizeWithIndexMap`). Output is a plain string returned to Raycast AI with a "include the Documate URL for any page you cite" guidance line.

When changing the AI tool, keep in mind:
- The output is a *retrieval plan*, not the final answer. The prompt explicitly warns against putting role words like "contact person" into `text_search`.
- `LIKE`-family filter values must be raw substrings — `normalizeLikeFilterValue` strips wrapping quotes and `%` wildcards.
- The text-search sanitizer collapses `^` and newlines because they would break the encoded query.

## Conventions

- Path aliases are not configured; imports are relative.
- Prettier and ESLint config come from `@raycast/eslint-config` — no custom config files.
- Keep imports of `lodash` narrow (currently only `groupBy`); the dep is in the bundle.

## Releasing

`CHANGELOG.md` follows the Raycast Store format with `{PR_MERGE_DATE}` placeholders that get rewritten on merge — don't replace them with real dates manually.
