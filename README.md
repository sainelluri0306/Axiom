# Papertrails

Node.js frontend (Vite + React) ready to integrate with a backend that exposes APIs (e.g. for LLMs).

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Backend integration

The app talks to your backend over HTTP. Configure the API base URL:

1. Copy `.env.example` to `.env`.
2. Set `VITE_API_BASE_URL` to your backend origin (e.g. `http://localhost:8080`). Leave empty to use the same origin and rely on the Vite proxy.

### Expected API shape

The UI uses these endpoints (implement them on your backend):

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/completion` | `{ prompt: string, model?: string, max_tokens?: number }` | One-shot completion. Return `{ text }` or `{ content }` or a string. |

Optional (for chat UIs):

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/chat` | `{ messages: Array<{role, content}>, model?: string, stream?: boolean }` | Chat completion. Return JSON or stream. |

### Using the API client in your code

```js
import { get, post, completion, chat } from './api/client';

// One-shot completion
const data = await completion({ prompt: 'Hello', model: 'gpt-4', max_tokens: 256 });

// Chat (if your backend supports it)
const reply = await chat({ messages: [{ role: 'user', content: 'Hi' }], model: 'gpt-4' });

// Generic GET/POST
const list = await get('/api/models');
await post('/api/action', { id: 1 });
```

## Scripts

- `npm run dev` — start dev server (port 3000)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build locally

## Proxy (development)

In `vite.config.js`, `/api` is proxied to `http://localhost:8080` by default. Change the `proxy['/api'].target` to match your backend, or set `VITE_API_BASE_URL` and the frontend will call the backend directly (backend must send CORS headers).
