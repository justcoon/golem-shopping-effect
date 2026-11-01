# Feature Plan: Align Chat Stream and Chat History Tool Call Representations

- **Feature ID / Slug**: `chat-stream-tool-call-consistency`
- **Date**: 2026-10-31
- **Status**: Draft

---

## 1. Overview & Goals

In the Shopping Assistant agent, tool call information currently differs between **Chat Stream** (`chatStream`) and **Chat History** (`getHistory`):
- **Chat Stream (`ChatChunk`)**: Emits flat chunks (`type`, `content`, `tool`) with no `id`, no input `arguments`, and only a summary string for `result`.
- **Chat History (`ChatMessage` / `ToolCallRecord`)**: Stores structured records (`id`, `toolName`, `arguments`, `result`).
- **Frontend Discrepancy**: During streaming, tools are tracked transiently in `activeTools` without arguments/result inspection. Once the stream ends, the frontend store appends the assistant message **without** attaching `toolCalls`. The pills and `<details>` drawer disappear until the user refreshes or re-fetches history.

This feature aligns the stream and history representations so tool call fidelity is consistent in real time and persisted history.

### Goals

1. **Enhance `ChatChunk` Schema**: Add optional fields (`id`, `arguments`, `result`) to `ChatChunk` so stream events carry complete tool call data.
2. **Emit Full Tool Data During Streaming**: In `shopping-assistant-loop.ts`, populate `id` and `arguments` on `tool_start`, and `id` and `result` on `tool_result`.
3. **Frontend Real-time & Post-stream Consistency**:
   - Update `assistantService.ts` `ChatChunk` interface with `id`, `arguments`, `result`.
   - In `assistantStore.ts`, accumulate `ToolCallRecord[]` from stream chunks and attach them directly to `assistantMessage.toolCalls` when the stream finishes.
   - Allow users to inspect tool call arguments and results immediately upon completion of streaming without requiring a page reload.
4. **Pass All Validation Checks**: `format:check`, `typecheck`, `lint`, `npm test`, and `golem build --yes`.

### Non-Goals

- Changing the underlying LLM provider streaming primitives.
- Modifying non-assistant agents (Cart, Order, Pricing, Product).

---

## 2. Architecture & Technical Design

### Data Flow & Schema Alignment

```mermaid
sequenceDiagram
    participant LLM as Pi Agent Core
    participant Loop as shopping-assistant-loop
    participant Stream as chatStream SSE
    participant Store as frontend assistantStore
    participant View as ShoppingAssistantView

    LLM->>Loop: tool_execution_start
    Loop->>Stream: ChatChunk tool_start with id and arguments
    Stream->>Store: onChunk tool_start
    Store->>View: activeTools updated

    LLM->>Loop: tool_execution_end
    Loop->>Stream: ChatChunk tool_result with id and result
    Stream->>Store: onChunk tool_result
    Store->>View: activeTools updated

    Loop->>Stream: ChatChunk done
    Store->>Store: Append assistantMessage with accumulated toolCalls
    Store->>View: Message displays tool pills with inspect drawer
```

### Schema Changes

1. **`src/agents/shopping-assistant/shopping-assistant-schema.ts`**:
   ```typescript
   export const ChatChunk = Schema.Struct({
     type: ChatChunkType,
     content: Schema.String,
     tool: Schema.String,
     id: Schema.optional(Schema.String),
     arguments: Schema.optional(Schema.String),
     result: Schema.optional(Schema.String),
   });
   ```

2. **Frontend `assistantService.ts`**:
   ```typescript
   export interface ChatChunk {
     type: "tool_start" | "tool_result" | "text_delta" | "done" | "error";
     content: string;
     tool: string;
     id?: string;
     arguments?: string;
     result?: string;
   }
   ```

3. **Frontend `assistantStore.ts`**:
   - Collect incoming tool calls during the stream into `accumulatedToolCalls: ToolCallRecord[]`.
   - Update `assistantMessage.toolCalls = accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined`.

---

## 3. Proposed Changes & File Impact

| Action | File Path | Description |
| :--- | :--- | :--- |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-schema.ts`](../../src/agents/shopping-assistant/shopping-assistant-schema.ts) | Add optional `id`, `arguments`, `result` to `ChatChunk`. |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-loop.ts`](../../src/agents/shopping-assistant/shopping-assistant-loop.ts) | Populate `id` & `arguments` on `tool_start` chunks, and `id` & `result` on `tool_result` chunks. |
| `[MODIFY]` | [`frontend/src/api/services/assistantService.ts`](../../frontend/src/api/services/assistantService.ts) | Add `id`, `arguments`, `result` to `ChatChunk` type. |
| `[MODIFY]` | [`frontend/src/stores/assistantStore.ts`](../../frontend/src/stores/assistantStore.ts) | Accumulate tool calls during stream and attach them to `assistantMessage.toolCalls` upon stream completion. |
| `[MODIFY]` | [`frontend/src/views/ShoppingAssistantView.vue`](../../frontend/src/views/ShoppingAssistantView.vue) | Move tool calls display to appear below/after the message body instead of before it, adjusting spacing. |

---

## 4. Verification Plan

### Automated Checks

1. **Backend Formatting**:
   ```bash
   npm run format:check
   ```
2. **Backend Type Checking**:
   ```bash
   npm run typecheck
   ```
3. **Backend Linter**:
   ```bash
   npm run lint
   ```
4. **Backend Tests**:
   ```bash
   npm test
   ```
5. **Golem Component Build**:
   ```bash
   golem build --yes
   ```
6. **Frontend Checks**:
   ```bash
   npx prettier --check frontend/src/api/services/assistantService.ts frontend/src/stores/assistantStore.ts
   ```

---

## 5. Risks & Open Questions

- **Bandwidth**: Adding `arguments` and `result` to stream chunks slightly increases SSE chunk payload sizes when tools execute.
  - *Mitigation*: These events only fire on `tool_start` and `tool_result` (typically 1-3 times per turn), not on high-frequency `text_delta` chunks.
- **Open Questions**: None.

