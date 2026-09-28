# Shakespeare

Shakespeare is a Firefox extension that corrects and improves selected English or French text through a local OpenAI-compatible API. Select text on any page, open the context menu, and choose **shakespeare correction (selection)** to stream a corrected version and an alternative suggestion into a reusable result window.

https://github.com/user-attachments/assets/a50a3734-835a-484f-a3fa-4595baa300c8

## Requirements

- Firefox 142 or newer.
- Node.js and npm for development builds.
- llama.cpp, Unsloth Desktop, or another OpenAI-compatible server exposing `/v1/chat/completions`.

The default API base URL is `http://127.0.0.1:8888`. The extension omits `model` and `Authorization` when their settings are blank, allowing a keyless server to use its currently loaded model. Local requests are sent from the Firefox background page without browser origin or cookie headers, which keeps the same build compatible with llama.cpp and the Unsloth Desktop keyless API.

## Install for development

```bash
npm ci
npm run build
```

Open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose `dist/manifest.json`. Rebuild and reload the temporary extension after source changes.

## Start a local API

Start an OpenAI-compatible server on port `8888`. A minimal llama.cpp example is:

```bash
llama-server \
  -hf unsloth/gemma-4-E2B-it-GGUF:Q4_K_S \
  --port 8888
```

For Unsloth Desktop, load a model and expose its keyless OpenAI-compatible API on the same port. Confirm that the server is reachable with:

```bash
curl http://127.0.0.1:8888/v1/models
```

## Settings

Use **Open settings** in the correction window or **shakespeare settings** in the context menu. The 900-pixel settings window provides the API base URL, optional model and API key, temperature, maximum tokens, top-p, frequency penalty, and presence penalty. English and French correction and suggestion prompts can be edited in focused dialogs and restored to their defaults.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Rebuild continuously during development |
| `npx biome check .` | Check formatting, lint rules, and import organization |
| `npx tsc --noEmit` | Type-check without emitting files |
| `npm run build` | Validate and create `dist/` |
| `npm run verify` | Validate the built Firefox extension |
| `npm run package` | Build and create the versioned ZIP archive |

The main implementation lives in `src/background.ts` for extension orchestration, `src/api.ts` for streaming API transport, `src/config.ts` for defaults and persisted settings, and `src/result.ts`, `src/settings.ts`, and `src/sections.ts` for the correction and settings interfaces.

## Privacy

The extension does not declare telemetry or data collection. Selected text is sent only to the API base URL configured by the user, and settings are stored locally through Firefox extension storage. Review the configured endpoint before sending sensitive text.

## Disclaimer

This project was created with LLM assistance, then adjusted, refactored, and manually reviewed for personal use. It was inspired by the [Proton Pass extension](https://github.com/ProtonMail/WebClients/tree/main/applications/pass-extension).
