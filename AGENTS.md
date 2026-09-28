# Agent Instructions

## Project contract

Shakespeare is a Firefox Manifest V2 extension for Firefox 142 and newer. It sends selected text to an OpenAI-compatible chat-completions API and displays streamed correction and suggestion results. Preserve the default endpoint `http://127.0.0.1:8888`, keep the model and API key blank by default, and let the server select its loaded model unless the user explicitly configures an override.

## Architecture

Keep context menus, extension windows, privileged networking, and API orchestration in `src/background.ts`. Keep OpenAI-compatible request construction and SSE parsing in `src/api.ts`, persisted defaults and normalization in `src/config.ts`, settings behavior in `src/settings.ts`, and result rendering in `src/result.ts` and `src/sections.ts`. API requests must originate from the background page. For requests to `127.0.0.1` or `localhost`, preserve the scoped header interception that removes browser `Origin` and `Cookie` headers without removing an explicitly configured `Authorization` header.

## Code changes

Use TypeScript and existing browser APIs without adding runtime dependencies unless necessary. Keep settings compatible with both llama.cpp and the Unsloth Desktop keyless API. Do not store credentials in source, fixtures, documentation, or commits. Add comments only for non-obvious compatibility, safety, or protocol behavior; do not comment trivial code or restate identifiers.

## Validation

Before handoff, run `npx biome check .`, `npx tsc --noEmit`, `npm run build`, and `npm run verify`. Use `npm run format` only for intentional formatting changes. Treat `dist/` and versioned ZIP archives as generated output, keep them uncommitted, and preserve unrelated worktree changes.
