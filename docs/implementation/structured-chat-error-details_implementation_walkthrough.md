# Implementation Walkthrough: Structured Clean Chat Error Handling

## 1. Executive Summary

This implementation establishes clean, empathetic error handling across the backend, web assets, and frontend UI without polluting persistent conversation history or dumping raw JSON payloads into chat messages:
- **Clean Backend Error Mapping**: When upstream LLMs or agent loops experience errors (e.g. HTTP 503 high demand, 429 rate limit, 401/403 authentication, network or parser failures), raw status codes and technical details are logged to server logs via `Effect.logError`.
- **User-Friendly Error Messages**: The backend generates clean, empathetic sentences for users:
  - 503 $\rightarrow$ *"The AI assistant is currently experiencing high demand. Please try again in a few moments."*
  - 429 $\rightarrow$ *"The AI assistant is temporarily busy due to rate limits. Please try again shortly."*
  - 401/403 $\rightarrow$ *"AI authentication failed. Please check your API key configuration."*
  - Other $\rightarrow$ *"The AI assistant is temporarily unavailable. Please try again later."*
- **No Fake `text_delta` Emissions**: Stream failure modes emit **only** `_tag: "error"` and `_tag: "done"`. Operational errors are no longer transmitted as conversational speech.
- **Zero Schema Pollution**: `ChatMessage`, `ChatResponse`, and `ChatChunk` remain standard without transport/debug fields leaking into persistent state.
- **Frontend & Web Asset Parity**:
  - The Vue frontend (`assistantStore.ts` and `ShoppingAssistantView.vue`) renders clean error message bubbles with `🔄 Retry` buttons and handles stream failures gracefully.
  - The embedded web clients (`assistant.js`, `manager.js`, `chat-common.js`, `assistant.css`) format tool cards with modern bullet dividers (`•`), support robust list nesting, normalize event tags, and handle SSE `error` events cleanly without triggering redundant synchronous POST fallbacks.

---

## 2. Changes Implemented

### Backend (`src/ai/`)
- **[src/ai/error-formatter.ts](../../src/ai/error-formatter.ts)**:
  - Added `extractHttpStatus` to parse status code candidates from error strings, prefixes, and JSON payloads.
  - Added `mapHttpErrorToUserMessage` to convert status codes into polite user-facing copy.
  - Added `mapLlmErrorToUserMessage` to identify error categories (high demand, rate limit, authentication, network) and map them to friendly responses.
- **[src/ai/agent-loop.ts](../../src/ai/agent-loop.ts)**:
  - In `executeAgentChatTurnStream`:
    - Eliminated fake `textDeltaChunk` when `!apiKey`, emitting only `errorChunk` and `doneChunk`.
    - In error handling (`isError = true`), logged technical details via `yield* Effect.logError(...)`, resolved clean user copy via `mapLlmErrorToUserMessage(raw)`, and emitted only `errorChunk(finalReply)` and `doneChunk("")`.
    - Maintained clean message history in state updates with `type: "error"`.

### Frontend (`frontend/src/`)
- **[frontend/src/stores/assistantStore.ts](../../frontend/src/stores/assistantStore.ts)**:
  - When streaming finishes with `streamHadError` and `streamingText` is empty, immediately pushes the assistant error message using `error.value.message` and `type: "error"`.
- **[frontend/src/views/ShoppingAssistantView.vue](../../frontend/src/views/ShoppingAssistantView.vue)**:
  - Added `<template v-if="msg.type === 'error'">` body block to render clean error copy in `.error-bubble-content`.
  - Added `.error-bubble-content` and `.error-primary-message` scoped styles.
  - Added `<span v-if="tool.summary" class="tool-summary-divider">•</span>` and `.tool-summary-divider` style for active tool badges in the streaming indicator.

### Embedded Web Clients (`web/assets/`)
- **[web/assets/chat-common.js](../../web/assets/chat-common.js)**:
  - Enhanced markdown rendering with `@@CODEBLOCK@@` and `@@INLINECODE@@` placeholders and improved list nesting logic.
  - Updated `parseStreamEvents` to handle string `"done"` chunks and normalize PascalCase, kebab-case, and tagged events.
  - Added `getToolName` helper.
  - Updated `updateCompletedToolCard` and `createCompletedToolCard` to use `<span class="tool-summary-divider">•</span>` and display item counts for array outputs.
- **[web/assets/assistant.js](../../web/assets/assistant.js)** & **[web/assets/manager.js](../../web/assets/manager.js)**:
  - On `tag === "error"` in SSE stream, sets error text on bubble, adds `.error` CSS class, shows retry button, and resolves cleanly without triggering immediate redundant sync chat POST fallback.
  - In `loadHistory()`, checks `msg.type === "error"` and restores error styling and retry button on reload.
  - Handled flexible tool call properties (`toolCalls`, `tool_calls`, `toolCallsUsed`, `tool_calls_used`).
- **[web/assets/assistant.css](../../web/assets/assistant.css)**:
  - Added `.tool-summary-divider` with subtle opacity for tool summaries.

### Automated Test Suite (`test/`)
- **[test/error-formatter.test.ts](../../test/error-formatter.test.ts)**:
  - Added tests for `extractHttpStatus`, `mapHttpErrorToUserMessage`, and `mapLlmErrorToUserMessage`.
- **[test/real-time-chat-stream.test.ts](../../test/real-time-chat-stream.test.ts)**:
  - Updated stream error tests to verify stream emits only `[error, done]` without fake `text_delta`.
- **[test/chat-common.test.ts](../../test/chat-common.test.ts)**:
  - Added tests for PascalCase/string stream normalization, `getToolName`, and bullet divider tool card formatting.

---

## 3. Validation Results

| Check | Command | Result |
|---|---|---|
| **Code Formatting** | `npm run format:check` | Passed (All files match Prettier style) |
| **TypeScript Typecheck** | `npm run typecheck` | Passed (0 errors) |
| **ESLint Linter** | `npm run lint` | Passed (0 errors) |
| **Automated Unit & Integration Tests** | `npm test` | Passed (82/82 tests passed across 8 suites) |
| **Golem Component WASM Build** | `golem build --yes` | Passed (`Finished building [OK]`, 84.3 MB WASM) |
| **Frontend Production Build** | `cd frontend && npx vite build` | Passed (`built in 2.43s`, 0 errors) |

---

## 4. Verification & Usage Guide

1. **Triggering High Demand / Service Unavailable (HTTP 503)**:
   - When an upstream LLM responds with HTTP 503:
     - The backend logs the raw technical payload:
       ```text
       [ERROR] AI upstream error: 503 [{"error":{"code":503,"message":"This model is currently experiencing high demand...","status":"UNAVAILABLE"}}]
       ```
     - In the chat interface:
       - The assistant message bubble displays:
         > ⚠️ **Shopping Assistant**
         > *The AI assistant is currently experiencing high demand. Please try again in a few moments.*
         > `[🔄 Retry]`
       - The bottom alert banner displays:
         > ⚠️ *The AI assistant is currently experiencing high demand. Please try again in a few moments.* `[🔄 Retry]`
       - No raw JSON, brackets, quotes, or status codes appear in user-facing bubbles.
2. **Missing LLM Key**:
   - When no API key is provided, the stream delivers clean `error` and `done` chunks with the configured hint without fake `text_delta` chunks.
