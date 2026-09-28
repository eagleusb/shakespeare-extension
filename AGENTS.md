# Agent Instructions

- This is a Firefox Manifest V3 extension. Keep API calls OpenAI-compatible and
  preserve the default local endpoint `http://127.0.0.1:8888`.
- The local server chooses its loaded model by default; keep the model field
  blank unless the user explicitly configures an override. Do not add API keys.
- Before handing off changes, run `npm run format:check`, `npm run lint`,
  `npm run build`, and `npm run verify`. Use `npm run format` for intentional
  formatting changes.
- Add comments only for non-obvious behavior, compatibility constraints, or
  safety requirements. Do not comment trivial code or restate names and steps.
- Keep generated `dist/` output uncommitted and preserve unrelated worktree
  changes.
