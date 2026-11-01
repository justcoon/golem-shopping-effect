# Feature Plan: Direct Golem-Served Shopping Assistant Web Interface

## 1. Problem Statement & Motivation
Currently, interacting with the shopping assistant requires running an external frontend application (such as the Vite/Vue app under `frontend/`). The user wants to add a standalone web interface served directly by Golem, dedicated specifically to the Shopping Assistant.

Serving web assets directly from Golem via an ephemeral `HttpRouter` and Golem's virtual initial file system provides:
1. **Zero-Setup Web UI**: Instant access to the shopping assistant on `http://localhost:9006/assistant` without running a separate Node dev server.
2. **Direct First-Party Golem Routing**: HTML/JS/CSS files served natively by Golem's static HTTP router, with direct access to `/v1/assistant/{userId}/...` endpoints on the same origin (no CORS or proxy configuration required).
3. **Full Interactive Assistant Experience**: Real-time streaming response generation (Durable Streams SSE), tool execution activity indicators, message history inspection, history reset, and recommendations display.

---

## 2. Architecture & Design

Using Golem's native static file hosting and ephemeral `HttpRouter`:
- Static assets live in `./web/` (`index.html`, `assets/*`).
- `golem.yaml` provisions `./web/` into the agent's filesystem at `/web/` with `read-only` permissions under agent `Web`.
- `src/web.ts` defines an ephemeral router with `HttpRouter.define("Web", { mount: Http.mount("/assistant", ...), static: [...] }).register()`.
- `src/main.ts` imports `./web.js` for side-effect registration.
- `golem.yaml` includes `Web: {}` in the `httpApi` deployment.

---

## 3. Proposed Changes

### A. Golem Manifest Updates (`golem.yaml`)
1. Add `Web` agent with initial file mounting:
   ```yaml
   agents:
     Web:
       files:
       - sourcePath: ./web/
         targetPath: /web/
         permissions: read-only
   ```
2. Add `Web: {}` to `httpApi.deployments.local.agents`:
   ```yaml
   httpApi:
     deployments:
       local:
       - domain: localhost:9006
         agents:
           PricingAgent: {}
           ProductAgent: {}
           ProductSearchAgent: {}
           ShoppingAssistantAgent: {}
           CartAgent: {}
           OrderAgent: {}
           Web: {}
   ```

### B. Ephemeral HTTP Router (`src/web.ts` and `src/main.ts`)
1. Create `src/web.ts`:
   Mounted at `/assistant` so it is served from `http://localhost:9006/assistant` (leaving root `/` available):
   ```typescript
   import { Http, HttpRouter } from "@golemcloud/effect-golem";

   HttpRouter.define("Web", {
     mount: Http.mount("/assistant", {
       fileResponseHeaders: {
         "Referrer-Policy": "no-referrer",
         "Content-Security-Policy":
           "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
       },
     }),
     static: [
       { route: "/", path: "/web/index.html" },
       { route: "/assets/*", path: "/web/assets/$1" },
     ],
   }).register();
   ```
2. Import `src/web.ts` in `src/main.ts`:
   ```typescript
   import "./web.js";
   ```

### C. Web Frontend Directory (`web/`)
1. `web/index.html`:
   - Clean, modern layout focused solely on the Shopping Assistant.
   - User identity selector / badge (defaults to e.g. `user-1` with option to switch or edit).
   - Chat transcript container showing:
     - User message bubbles.
     - Assistant responses with markdown formatting.
     - Interactive tool execution pills/badges (e.g. `🔍 Searching products`, `🛒 Cart updated: 2 items, $120.00`).
     - Live streaming text indicator while the model is responding.
   - Input bar with textarea (Enter to submit, Shift+Enter for newline), Send button, and "Clear History" button.
   - Recommended items sidebar / drawer showing suggested products from conversation context.
2. `web/assets/assistant.css`:
   - Responsive, elegant layout (custom properties, dark/light adaptive color scheme, smooth typography, scrollable chat timeline, polished message bubbles and tool badges).
3. `web/assets/assistant.js`:
   - Direct communication with `/v1/assistant/{userId}/...`:
     - `GET /v1/assistant/{userId}/history`: Loads existing conversation on startup.
     - `PUT /v1/assistant/{userId}/chat-stream`: Opens SSE session via Durable Streams (`Location` header -> EventSource on `$result` stream).
     - Fallback to `POST /v1/assistant/{userId}/chat` if SSE connection is unavailable.
     - Handles normalized `ChatChunk` variants (`text_delta`, `tool_start`, `tool_result`, `done`, `error`).
     - `POST /v1/assistant/{userId}/clear-history`: Resets conversation state.
     - `GET /v1/assistant/{userId}/recommendations`: Loads recommended items.

---

## 4. Verification Plan

1. **Static Validation**:
   - `npm run format:check` and `npm run format`
   - `npm run lint`
   - `npm run typecheck`
2. **Unit & Integration Tests**:
   - `npm test`
3. **Golem Component Build**:
   - `golem build --yes` (verifying QuickJS WASM injection and pre-initialization including static file mapping).
4. **Walkthrough Document**:
   - Create `docs/implementation/golem-web-shopping-assistant_implementation_walkthrough.md`.

---

## 5. User Review Required

> [!IMPORTANT]
> **Port and Route Configuration**:
> - The new web interface will be served at `http://localhost:9006/assistant` (and `/assistant/`) directly from Golem's HTTP API.
> - Static assets will be served from `/assistant/assets/*` (`/web/assets/*`).
> - The existing REST API endpoints (`/v1/assistant/...`, `/v1/cart/...`, etc.) on `localhost:9006` remain completely unaffected and accessible from the same host/port.

