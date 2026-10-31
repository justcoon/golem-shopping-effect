# Feature Implementation Walkthrough: Align Chat Stream and Chat History Tool Call Representations

- **Feature ID / Slug**: `chat-stream-tool-call-consistency`
- **Date**: 2026-10-31
- **Status**: Ready for Review

---

## 1. Executive Summary

This feature resolves the discrepancy between how tool calls were represented in the **Chat Stream** (`chatStream`) versus **Chat History** (`getHistory`):
1. **Schema & Stream Fidelity**: `ChatChunk` now includes optional `id`, `arguments`, and `result` fields, allowing SSE stream chunks to convey complete tool call information.
2. **Frontend Stream Accumulation**: The frontend `assistantStore` now tracks and populates full `ToolCallRecord[]` from stream chunks and attaches them to `assistantMessage.toolCalls` as soon as the stream finishes.
3. **Frontend UI Display**: Tool calls in [`ShoppingAssistantView.vue`](../../frontend/src/views/ShoppingAssistantView.vue) are now displayed **after** the message content rather than before it, with an expandable `<details>` inspect drawer.

All automated verification gates (formatting, typecheck, linting, unit tests, and `golem build --yes`) have executed and passed cleanly.

---

## 2. Changes Implemented

### File Modifications

| Action | File Path | Summary of Changes |
| :--- | :--- | :--- |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-schema.ts`](../../src/agents/shopping-assistant/shopping-assistant-schema.ts) | Added optional `id`, `arguments`, and `result` fields to `ChatChunk`. |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-loop.ts`](../../src/agents/shopping-assistant/shopping-assistant-loop.ts) | Populated `id` and `arguments` on `tool_start` stream chunks, and `id` and `result` on `tool_result` stream chunks. |
| `[MODIFY]` | [`frontend/src/api/services/assistantService.ts`](../../frontend/src/api/services/assistantService.ts) | Added `id?: string; arguments?: string; result?: string;` to `ChatChunk` interface. |
| `[MODIFY]` | [`frontend/src/stores/assistantStore.ts`](../../frontend/src/stores/assistantStore.ts) | Accumulated `ToolCallRecord[]` during SSE streaming and attached them to `assistantMessage.toolCalls` upon stream completion. |
| `[MODIFY]` | [`frontend/src/views/ShoppingAssistantView.vue`](../../frontend/src/views/ShoppingAssistantView.vue) | Moved `.tool-calls-container` below the message bubble body and adjusted spacing (`margin-top: 0.6rem; margin-bottom: 0.2rem`). |

---

## 3. Verification & Validation Results

### 3.1 Code Formatting

```bash
npm run format:check
npx prettier --check frontend/src/api/services/assistantService.ts frontend/src/stores/assistantStore.ts frontend/src/views/ShoppingAssistantView.vue
```

**Result**:
```text
Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking

```bash
npm run typecheck
```

**Result**:
```text
> tsc --noEmit
(zero errors)
```

### 3.3 Linter Verification

```bash
npm run lint
```

**Result**:
```text
> eslint src/ test/
(zero lint errors)
```

### 3.4 Automated Unit & Integration Test Suite

```bash
npm test
```

**Result**:
```text
> test
> tsx --test "test/**/*.test.ts"

✔ LLM Error Formatting (7.29ms)
✔ custom OpenAI provider can be registered in createModels (2.94ms)
✔ setupModelsAndProvider routes Gemini models to native Google Generative AI provider (0.93ms)
✔ setupModelsAndProvider routes OpenRouter models to openrouter provider (0.89ms)
✔ setupModelsAndProvider routes custom endpoints to dynamic OpenAI provider (0.31ms)
✔ createPiAgentTools creates valid AgentTool array from tool definitions (12.75ms)
✔ Pi Agent executes turn with mock model, tool calls, and event stream (36.09ms)
✔ createPiAgentTools propagates ambient Context to tool execution (1.87ms)
✔ ProductQueryMatcher (7.74ms)
ℹ tests 21
ℹ suites 2
ℹ pass 21
ℹ fail 0
```

### 3.5 Golem Component Build

```bash
golem build --yes
```

**Result**:
```text
Building components
  Building golem-shopping-effect:effect-main
    Executing external command 'npx tsc ...'
    Executing external command 'npx --no rollup ...'
    created golem-temp/ts-dist/golem-shopping-effect-effect-main/main.js in 12.9s
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ...
    Done! Input: 22121.2 KB, Output: 66867.9 KB
  Adding metadata to golem-shopping-effect:effect-main

Finished building [OK]
```

---

## 4. Verification / Usage Guide

1. **Real-Time Streaming**:
   - When the assistant runs a tool during streaming, `tool_start` sends the tool name, `id`, and input `arguments`.
   - `tool_result` sends the human summary, `id`, and full `result` payload.
2. **Post-Streaming Immediate Visibility**:
   - As soon as the stream finishes, the assistant response message displays the tool pills (e.g. `⚡ Search Products`) **after** the message body.
   - Users can expand `<details> inspect` to view `Args:` and `Result:` without refreshing.
3. **History Persistence**:
   - Reloading the page or calling `getHistory` yields the exact same structure and position as the streamed response.

