# Echo

A browser-based AI workspace with a React + TypeScript frontend, a separate Cloudflare Worker API, OpenRouter-powered chat, and Tripo 3D generation. This repository is independent of the portfolio repository.

## Implemented

- Responsive chat UI with dark/light mode, accent colors, settings, and mobile sidebar.
- Local conversation history: create, reopen, rename, delete, and clear.
- Markdown, tables, lists, and syntax-highlighted code.
- Streaming chat, stop, copy, regenerate, loading states, and error handling.
- Conversation-context toggle: when disabled, only the latest message is sent.
- Optional OpenRouter web-search plugin request.
- Tripo text-to-3D task creation, task status lookup, preview, and model link.
- Cloudflare Worker proxy keeps provider keys out of frontend code.
- GitHub Actions workflow builds and deploys to GitHub Pages.

## Not yet implemented

Voice input/text-to-speech, image/document upload processing, AI image generation, login, cross-device sync, and persistent server-side memory are not implemented. The attachment control is a placeholder. The 3D UI checks task status once; if the task is still running, check again later. The Worker has best-effort per-isolate throttling, not production-grade authentication or durable rate limiting.

## Architecture

- `src/` — React + TypeScript frontend.
- `worker/src/index.ts` — Cloudflare Worker API proxy.
- `worker/wrangler.toml` — Worker configuration.
- `.github/workflows/deploy.yml` — GitHub Pages workflow.
- `VITE_API_BASE_URL` — public API URL embedded in the frontend build, not a secret.
- `OPENROUTER_API_KEY` and `TRIPO_API_KEY` — private Worker secrets. Never put these into Vite variables, HTML, or Git.

## Requirements

Node.js 20+, a Cloudflare account for the Worker, an OpenRouter API key and enabled chat model, plus a Tripo API key and available credits for 3D generation. Tripo provides 3D/media generation, not general-purpose conversational chat.

## Local frontend development

1. Run `npm install` from the repository root.
2. Copy `.env.example` to `.env.local`.
3. Set `VITE_API_BASE_URL=http://localhost:8787` for a local Worker.
4. Run `npm run dev`.

Without a backend URL, the interface loads but live AI requests show a setup message.

## Configure and deploy the backend

1. Run `cd worker && npm install`.
2. For local testing, copy `worker/.dev.vars.example` to `worker/.dev.vars` and replace the example values. The real `.dev.vars` file is ignored by Git; never commit it.
3. From the `worker/` directory, configure secrets using the CLI prompts: `npx wrangler secret put OPENROUTER_API_KEY` and `npx wrangler secret put TRIPO_API_KEY`. Do not place key values in source files or commands.
4. In `worker/wrangler.toml`, set `ALLOWED_ORIGIN` to your site origin, without a path. For this repo: `https://liteempire.github.io`.
5. Deploy from `worker/` with `npx wrangler deploy`.
6. Copy the resulting Worker URL. For local development, set it as `VITE_API_BASE_URL` in `.env.local`. For the published site, create a GitHub Actions repository variable named `VITE_API_BASE_URL` with the Worker URL (not an API key).
7. Re-run the deployment workflow after changing the variable so the site is rebuilt with the URL.

The Worker uses OpenRouter's OpenAI-compatible chat-completions endpoint and Tripo's documented v3 text-to-model and task-query endpoints. It validates request shape and size, sets timeouts, restricts browser origins, and returns readable provider errors. The in-memory throttle is best-effort and can reset across Worker isolates; configure Cloudflare rate limiting and suitable authentication/abuse controls before public launch.

## GitHub Pages

1. Open [Pages settings](https://github.com/LiteEmpire/Echo/settings/pages).
2. Set the deployment source to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds the app and deploys `dist/` on pushes to `main`.
4. When the workflow succeeds, verify the expected site at [https://liteempire.github.io/Echo/](https://liteempire.github.io/Echo/).

Vite uses `/Echo/` as its base path in GitHub Actions and `/` for local development.

## Privacy and security

Chats and settings are stored in this browser's local storage. Other people with access to the same browser profile may be able to view them. Clearing local history does not erase requests already sent to providers. Chat prompts are sent to the configured chat provider; 3D prompts go to Tripo. Review their policies before sharing sensitive content. This app has no user login and is not yet a secured multi-user service. Model output can be wrong; verify important claims and generated code.

## Troubleshooting

- **Chat setup message:** Set the GitHub Actions variable `VITE_API_BASE_URL`, rerun deployment, and configure `OPENROUTER_API_KEY` as a Worker secret.
- **CORS error:** `ALLOWED_ORIGIN` must exactly match `https://liteempire.github.io`; do not add `/Echo/`. Redeploy the Worker after changing it.
- **Chat error or HTTP 429:** Check OpenRouter model availability, account limits, and provider rate limits.
- **3D unavailable:** Configure `TRIPO_API_KEY` and check Tripo credits and task status.
- **Pages workflow failure:** Confirm Pages is set to GitHub Actions and inspect the latest workflow logs.
