# Agent Instructions

## Project contract

Shakespeare is a Firefox Manifest V3 extension for Firefox 142 and newer. It sends selected text to an OpenAI-compatible chat-completions API and displays streamed correction and suggestion results. Preserve the default endpoint `http://127.0.0.1:8888`, keep the model and API key blank by default, and let the server select its loaded model unless the user explicitly configures an override.

## Architecture

Keep context menus, extension windows, privileged networking, and API orchestration in `src/background.ts`. Keep OpenAI-compatible request construction and SSE parsing in `src/api.ts`, persisted defaults and normalization in `src/config.ts`, settings behavior in `src/settings.ts`, and result rendering in `src/result.ts` and `src/sections.ts`. API requests must originate from the non-persistent background page. Discover reusable extension windows from browser state instead of relying on persistent global IDs. For requests to `127.0.0.1` or `localhost`, preserve the scoped header interception that removes browser `Origin` and `Cookie` headers without removing an explicitly configured `Authorization` header.

## Code changes

Use TypeScript and existing browser APIs without adding runtime dependencies unless necessary. Keep settings compatible with both llama.cpp and the Unsloth Desktop keyless API. Do not store credentials in source, fixtures, documentation, or commits. Add comments only for non-obvious compatibility, safety, or protocol behavior; do not comment trivial code or restate identifiers.

## Validation

Before handoff, run `npx biome check .`, `npx tsc --noEmit`, `npm run build`, and `npm run verify`. Use `npm run format` only for intentional formatting changes. Treat `dist/` and versioned ZIP archives as generated output, keep them uncommitted, and preserve unrelated worktree changes.

## Publishing

Keep the versions in `package.json`, `package-lock.json`, and `src/manifest.json` synchronized, then run `npm run package`. Validate the generated ZIP with the [Add-on Validator](https://addons.mozilla.org/en-US/developers/addon/validate). Use the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/en-US/developers/) as the publishing entry point and Mozilla's [submission documentation](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/) as the authoritative workflow. Upload or submit an add-on only when the user explicitly requests it.
