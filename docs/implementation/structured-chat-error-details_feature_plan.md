# Feature Implementation Plan: Structured Clean Chat Error Handling

## 1. Overview & Goals

Currently in `golem-shopping-effect`, when any failure occurs during AI chat execution (e.g. HTTP 503 high demand, 429 rate limit, 401 invalid API key, missing configuration, network or streaming parsing failures):
1. The backend prefixes or dumps technical error text / raw JSON payloads into chat responses.
2. The streaming loop emits a fake `ChatChunk::text_delta` carrying the error string, immediately followed by a `ChatChunk::error`.
3. In the frontend and web clients, receiving a fake text delta causes the UI to render raw error text / JSON inside standard assistant speech bubbles, or causes unnecessary synchronous fallback attempts when a stream cleanly signals an operational error.

This plan establishes a clean, disciplined error handling architecture across the backend, web assets, and frontend.

### Key Goals
- **Zero Schema Pollution**: Keep `ChatMessage`, `ChatResponse`, and `ChatChunk` clean and standard. Do not introduce extraneous transport or debug fields into durable conversation history.
- **Log Technical Details on Backend**: Raw HTTP status codes, stack traces, and upstream JSON response bodies belong in server logs via `Effect.logError`, where developers can inspect them with `golem agent logs` or server console.
- **Polite User-Facing Error Messages**: The backend returns clean, user-friendly messages:
  - `503` / UNAVAILABLE $\rightarrow$ *"The AI assistant is currently experiencing high demand. Please try again in a few moments."*
  - `429` / Rate Limit $\rightarrow$ *"The AI assistant is temporarily busy due to rate limits. Please try again shortly."*
  - `401` / `403` / Auth $\rightarrow$ *"AI authentication failed. Please check your API key configuration."*
  - Default / Other $\rightarrow$ *"The AI assistant is temporarily unavailable. Please try again later."*
- **Eliminate Fake `text_delta` on Error**: Stop emitting `_tag: "text_delta"` on failure. Operational errors must emit **only** `_tag: "error"` and `_tag: "done"`.
- **Clean Frontend UI**:
  - Store: In `assistantStore.ts`, if streaming finishes with `streamHadError` and `streamingText` is empty, record the error message directly from `error.value.message` without delay.
  - View: In `ShoppingAssistantView.vue`, render `msg.content` cleanly inside an error bubble (`<template v-if="msg.type === 'error'">`) with distinct error styling and retry actions.
- **Web Client Parity (`web/assets/`)**:
  - `chat-common.js`: Update tool card summaries with the bullet divider `<span class="tool-summary-divider">•</span>`, robust list nesting, tag normalization (`PascalCase`, `kebab-case`, `_tag`), and tool name extraction.
  - `assistant.js` & `manager.js`: Handle `tag === "error"` cleanly (close EventSource, set error bubble styling, show retry button, resolve without triggering redundant sync fallback), support both camelCase and snake_case tool call properties, and show retry button on reload if `msg.type === "error"`.
  - `assistant.css`: Add `.tool-summary-divider` subtle opacity divider style.

---

## 2. Architecture & Design

### 2.1 Backend Error Mapping (`src/ai/error-formatter.ts`)
Add status code extraction and user-friendly error mapping functions:
```ts
export function extractHttpStatus(text: string, defaultStatus?: number): number;
export function mapHttpErrorToUserMessage(status: number, rawDetail?: string): string;
export function mapLlmErrorToUserMessage(raw: string): string;
```
- Maps 503 $\rightarrow$ *"The AI assistant is currently experiencing high demand. Please try again in a few moments."*
- Maps 429 $\rightarrow$ *"The AI assistant is temporarily busy due to rate limits. Please try again shortly."*
- Maps 401 / 403 $\rightarrow$ *"AI authentication failed. Please check your API key configuration."*
- Maps fallback $\rightarrow$ *"The AI assistant is temporarily unavailable. Please try again later."*
- Preserves existing utilities (`extractLlmErrorMessage`, `formatLlmErrorMessage`, `fixMojibake`, `formatUnknownError`) for backward compatibility.

### 2.2 Agent Execution Loop (`src/ai/agent-loop.ts`)
1. **Eliminate Fake `text_delta` for Missing API Key**:
   When `!apiKey`, offer only:
   ```ts
   Queue.offerUnsafe(queue, errorChunk(missingApiKeyMessage));
   Queue.offerUnsafe(queue, doneChunk(""));
   ```
   and pass `chunks: [errorChunk(missingApiKeyMessage), doneChunk("")]` into `onTurnComplete`.
2. **Eliminate Fake `text_delta` on Failure**:
   When `isError` is true:
   - Log technical details via `yield* Effect.logError(...)`.
   - Resolve user-friendly message via `mapLlmErrorToUserMessage(raw)`.
   - Offer only `errorChunk(finalReply)` and `doneChunk("")`.
3. **Keep State History Clean**:
   `assistantMsg` is stored in agent state with `type: "error"` and the clean user-facing message in `content`, preventing upstream JSON dumps from poisoning subsequent conversation turns.

### 2.3 Vue Frontend (`frontend/src/`)
1. **`assistantStore.ts`**:
   When a stream finishes with `streamHadError` and `streamingText` is empty, push an assistant message:
   ```ts
   messages.value.push({
     role: "assistant",
     content: error.value.message,
     timestamp: new Date().toISOString(),
     type: "error",
   });
   ```
2. **`ShoppingAssistantView.vue`**:
   - Render `msg.type === 'error'` inside `.error-bubble-content` with `<p class="error-primary-message">{{ msg.content }}</p>`.
   - Add styles for `.error-bubble-content` and `.error-primary-message`.

### 2.4 Embedded Web Clients (`web/assets/`)
1. **`web/assets/chat-common.js`**:
   - Parse `"done"` strings and PascalCase/kebab-case/tagged event keys.
   - Use bullet divider `•` in tool card formatting.
   - Provide `getToolName(toolCall)`.
2. **`web/assets/assistant.js` & `web/assets/manager.js`**:
   - Handle `tag === "error"` by rendering the error bubble, setting `.error` class, showing retry, and resolving EventSource without triggering redundant synchronous POST fallback.
   - When loading history, check `msg.type === "error"` and attach error styling and retry button.
   - Support both `toolCalls` and `tool_calls` / `tool_calls_used` shapes.
3. **`web/assets/assistant.css`**:
   - Add `.tool-summary-divider` styling.

---

## 3. File-by-File Changes

| File | Status | Description |
|---|---|---|
| `src/ai/error-formatter.ts` | `[MODIFY]` | Add `extractHttpStatus`, `mapHttpErrorToUserMessage`, and `mapLlmErrorToUserMessage`. |
| `src/ai/agent-loop.ts` | `[MODIFY]` | Remove all fake `textDeltaChunk` emissions on error; log raw technical details via `Effect.logError`; emit only `errorChunk` and `doneChunk`. |
| `src/ai/index.ts` | `[MODIFY]` | Export newly added error-mapping helpers from `error-formatter.ts`. |
| `frontend/src/stores/assistantStore.ts` | `[MODIFY]` | Push error assistant message directly when stream has error and `streamingText` is empty. |
| `frontend/src/views/ShoppingAssistantView.vue` | `[MODIFY]` | Add `<template v-if="msg.type === 'error'">` body block and `.error-bubble-content` / `.error-primary-message` styles. |
| `web/assets/chat-common.js` | `[MODIFY]` | Update `parseStreamEvents`, `getToolName`, markdown placeholders, and tool card dividers. |
| `web/assets/assistant.js` | `[MODIFY]` | Update SSE error handler, history loader error styling, and tool-call key compatibility. |
| `web/assets/manager.js` | `[MODIFY]` | Update SSE error handler, history loader error styling, and tool-call key compatibility. |
| `web/assets/assistant.css` | `[MODIFY]` | Add `.tool-summary-divider` styling. |
| `test/error-formatter.test.ts` | `[MODIFY]` | Add unit tests for `extractHttpStatus`, `mapHttpErrorToUserMessage`, and `mapLlmErrorToUserMessage`. |
| `test/real-time-chat-stream.test.ts` | `[MODIFY]` | Update test assertions to verify stream emits only `[error, done]` without fake `text_delta` on failure. |
| `test/chat-common.test.ts` | `[MODIFY]` | Update and expand test coverage for tag normalization, tool names, and string chunks. |

---

## 4. Verification Plan

### Automated Checks
1. **Code Formatting**:
   ```bash
   npm run format:check
   ```
2. **Type Checking**:
   ```bash
   npm run typecheck
   ```
3. **Linter Verification**:
   ```bash
   npm run lint
   ```
4. **Automated Unit & Integration Tests**:
   ```bash
   npm test
   ```
5. **Frontend Production Build**:
   ```bash
   cd frontend && npx vite build
   ```
6. **Golem WASM Build**:
   ```bash
   golem build --yes
   ```

### Functional / Smoke Verification
- Verify that on an error (e.g. 503 high demand or missing API key):
  1. No fake `text_delta` chunk is emitted over the stream.
  2. The assistant bubble renders clean, polite error copy without raw JSON payloads, stack traces, or HTTP codes.
  3. The error bubble and banner display the `🔄 Retry` button.
  4. Server logs cleanly record technical upstream error details for debugging.
