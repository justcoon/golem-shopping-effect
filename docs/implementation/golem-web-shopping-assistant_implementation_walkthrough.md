# Implementation Walkthrough: Direct Golem-Served Shopping Assistant Web Interface

## 1. Overview
We added a dedicated, zero-setup web interface directly served by Golem at `/assistant` (e.g. `http://localhost:9006/assistant`).
This interface communicates directly with the deployed `ShoppingAssistantAgent` HTTP endpoints without requiring a separate Node.js / Vite development server or CORS configuration.

---

## 2. Changes Made

### Golem Manifest (`golem.yaml`)
1. **Agent Files Mounting**:
   - Configured `agents.Web.files` to mount the local `./web/` directory into the component's virtual file system at `/web/` with `read-only` permissions:
   ```yaml
   agents:
     Web:
       files:
       - sourcePath: ./web/
         targetPath: /web/
         permissions: read-only
   ```
2. **HTTP API Deployment**:
   - Added `Web: {}` under `httpApi.deployments.local.agents` so incoming HTTP requests under the domain `localhost:9006` route to the `Web` router.

### Ephemeral HTTP Router (`src/web.ts` and `src/main.ts`)
1. **Router Registration (`src/web.ts`)**:
   - Defined an ephemeral HTTP router using `HttpRouter.define("Web", ...)` with:
     - `mount: Http.mount("/assistant", ...)`: Configures the base path prefix to `/assistant` with secure Content-Security-Policy and Referrer-Policy headers.
     - Static file routes:
       - `{ route: "/", path: "/web/index.html" }` (serves the web app for `/assistant` and `/assistant/`)
       - `{ route: "/assets/*", path: "/web/assets/$1" }` (serves CSS and JS assets from `/web/assets/`)
2. **Registration in Root (`src/main.ts`)**:
   - Imported `./web.js` for side-effect registration during component initialization.

### Web Application (`web/`)
1. **`web/index.html`**:
   - Standalone HTML page with user switching (`user-1` default), chat header, message transcript stream, quick prompt action chips, recommendations side drawer, and input bar with live character counting and status.
   - References CSS and JS assets using `/assistant/assets/...` so requests resolve correctly to the mount path whether accessed at `/assistant` or `/assistant/`.
2. **`web/assets/assistant.css`**:
   - Clean, modern design supporting light/dark theme variables, responsive layout, bubble styling for user/assistant messages, tool execution chips, streaming indicator, and mobile-friendly drawer.
3. **`web/assets/assistant.js` & `web/assets/assistant.css`**:
   - Direct SSE streaming client using Golem Durable Streams:
     - Issues `PUT /v1/assistant/{userId}/chat-stream` with `{ message }`.
     - Extracts the SSE stream location from the response header or falls back to `POST /v1/assistant/{userId}/chat`.
     - Real-time updates for text tokens (`text_delta`), tool execution start (`tool_start`), tool execution results (`tool_result`), and completion (`done`).
     - Loads message history from `GET /v1/assistant/{userId}/history`.
     - Resets message history via `POST /v1/assistant/{userId}/clear-history`.
     - Fetches and displays recommended products via `GET /v1/assistant/{userId}/recommended-items`.
   - **Post-Message Tool Placement & Collapsible Accordion**:
     - Tool executions are displayed *after* (below) the generated response text instead of before.
     - Wrapped in a collapsible `<details class="tools-details">` container with a count indicator (`🛠️ Tool Activity (N)`), open during streaming execution and collapsible at any time.
     - Historical messages load with tools collapsed by default to keep the transcript compact.
   - **Distinct Reuse (User Messages) & Retry (Agent Errors) with Timestamps and Compact Sizing**:
     - **Timestamps**: Every message (both user and assistant) displays a subtle, formatted local timestamp (e.g. `17:26` or `5:26 PM`) in a dedicated bubble header row.
     - **User messages**: Each user bubble has a sleek, compact `🔄 Reuse` button (20px height, 10.5px font) aligned cleanly to the top-right corner in the header row. Clicking it copies the user's message into the input field, focuses it, and scrolls to the input bar.
     - **Agent errors**: When an assistant turn fails (streaming defect or request error), a compact `🔄 Retry` button is displayed in the top-right corner of the error bubble header. Clicking it removes the failed response and automatically re-sends the original prompt to the agent.
     - **Compact bubble height & natural shrink-wrapping**: Fixed inflated bubble heights by scoping `white-space: pre-wrap` strictly to the actual text content elements (`.user-text`, `.text-content`) rather than the wrapper `.message-content`. Removed artificial right padding hacks (`padding-right: 78px`), used tight `8px 12px` padding, aligned flex items to `flex-start`, and trimmed trailing whitespace. Both single-word and multi-paragraph messages shrink-wrap naturally.

---

## 3. Verification & Validation

All verification commands succeeded:

| Check | Command | Result |
| :--- | :--- | :--- |
| **Type Check** | `npm run typecheck` | Passed (0 errors) |
| **Linting** | `npm run lint` | Passed (0 warnings, 0 errors) |
| **Unit Tests** | `npm test` | Passed (5 test suites, 28 tests passing) |
| **Formatting** | `npm run format:check` | Passed (All files match Prettier style) |
| **Golem Build** | `golem build --yes` | Passed (`Finished building [OK]`) |

---

## 4. How to Run & Access

1. Start the local Golem server (if not already running):
   ```bash
   golem server start
   ```
2. Deploy the application:
   ```bash
   golem deploy
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:9006/assistant
   ```
   Or visit directly with a specific user context:
   ```
   http://localhost:9006/assistant/
   ```

