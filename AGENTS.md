# Agent Instructions

## Project

- Shakespeare is a Firefox Manifest V3 extension for Firefox 142 and newer. It sends selected text to an OpenAI-compatible chat-completions API and streams corrections and suggestions.
- Keep the default endpoint `http://127.0.0.1:8888`. Leave the model and API key blank by default so the server can use its loaded model without authentication.
- Preserve compatibility with llama.cpp and the Unsloth Desktop keyless API.

## Code ownership

- `src/background.ts`: context menus, extension windows, privileged networking, and API orchestration. Send API requests from its non-persistent background page and discover reusable windows from browser state.
- `src/api.ts`: OpenAI-compatible requests and SSE parsing.
- `src/config.ts`: defaults, persistence keys, and normalization.
- `src/settings.ts`: settings behavior. `src/result.ts` and `src/sections.ts`: result rendering.
- For `127.0.0.1` and `localhost`, keep header interception scoped to extension requests. Remove browser `Origin` and `Cookie` headers while preserving configured `Authorization`.

## Code changes

- Use TypeScript and existing browser APIs. Add no runtime dependencies unless needed.
- Do not store credentials in source, fixtures, documentation, or commits.
- Comment only non-obvious compatibility, safety, or protocol behavior. Do not comment trivial code or restate identifiers.
- Commit `bun.lock`; do not add npm lockfiles.

## Validation and artifacts

- After changes, run `bun run check`, `bun run typecheck`, `bun run build`, and `bun run verify`. Run `bun run package` after these checks pass.
- `bun run package` rebuilds, verifies, and writes a versioned ZIP to `artifacts/`. CI performs validation and packaging on pushes and pull requests, then uploads the ZIP as a workflow artifact.
- Use `bun run format` only for intentional formatting changes. Keep `dist/` and `artifacts/` uncommitted and preserve unrelated worktree changes.

## Publishing

- Keep the versions in `package.json` and `src/manifest.json` synchronized. Regenerate `bun.lock` when package metadata or dependencies change.
- Test the ZIP with the [Add-on Validator](https://addons.mozilla.org/en-US/developers/addon/validate).
- Use the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/en-US/developers/) and Mozilla's [submission documentation](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
- Upload or submit an add-on only when the user explicitly requests it.
