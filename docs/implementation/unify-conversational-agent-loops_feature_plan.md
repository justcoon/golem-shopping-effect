# Feature Plan: Unify Conversational Agent Loops (Item 3.2)

## Motivation & Context
[`ShoppingAssistantAgent`](../../src/agents/shopping-assistant/shopping-assistant-agent.ts) and [`ManagerAgent`](../../src/agents/manager/manager-agent.ts) currently duplicate the stateful conversation management loop:
- In both agents, message persistence (`userMsg` + `assistantMsg` creation with timestamp and tool calls, appending to `Ref` state) is duplicated across both synchronous `chat` and streaming `chatStream.onTurnComplete` (4 identical copies).
- `getHistory` and `clearHistory` are duplicated verbatim.
- Architectural asymmetry: `ShoppingAssistantAgent` delegates to an intermediary [`shopping-assistant-loop.ts`](../../src/agents/shopping-assistant/shopping-assistant-loop.ts), while `ManagerAgent` runs turn execution inline.

This plan unifies the conversational orchestration into reusable Effect primitives in `src/ai/agent-loop.ts`, establishing full symmetry and eliminating redundant code.

---

## User Review Required

> [!IMPORTANT]
> - `executeConversationalTurn` and `executeConversationalTurnStream` will be added to `src/ai/agent-loop.ts` (and exported from `src/ai/index.ts`).
> - The prompt and tools for the shopping assistant will be kept cleanly separated: `SHOPPING_ASSISTANT_SYSTEM_PROMPT` will be located in `src/agents/shopping-assistant/shopping-assistant-prompt.ts` (or `shopping-assistant-agent.ts`), mirroring `MANAGER_SYSTEM_PROMPT` in `manager-agent.ts`.
> - [`src/agents/shopping-assistant/shopping-assistant-loop.ts`](../../src/agents/shopping-assistant/shopping-assistant-loop.ts) will be safely deprecated/removed, and `src/agents/shopping-assistant/index.ts` will export the agent, definition, and prompt cleanly.
> - All agent signatures, HTTP endpoints, schema contracts, and streaming chunk behavior will remain 100% backward compatible.

---

## Proposed Changes

### 1. `src/ai/agent-loop.ts` & `src/ai/index.ts`
- Define and export:
  ```typescript
  export interface ExecuteConversationalTurnOptions<
    S extends { readonly messages: readonly ChatMessage[] },
  > {
    readonly state: Ref.Ref<S>;
    readonly userMessage: string;
    readonly systemPrompt: string;
    readonly tools: readonly AgentTool<TSchema>[];
    readonly apiKey: string;
    readonly model: string;
    readonly apiUrl?: string;
    readonly missingApiKeyMessage?: string;
  }

  export function executeConversationalTurn<
    S extends { readonly messages: readonly ChatMessage[] },
  >(
    options: ExecuteConversationalTurnOptions<S>,
  ): Effect.Effect<ChatResponse, never, Scope.Scope>;

  export function executeConversationalTurnStream<
    S extends { readonly messages: readonly ChatMessage[] },
  >(
    options: ExecuteConversationalTurnOptions<S>,
  ): Stream.Stream<ChatChunk>;
  ```
- Handles reading `history: messages` from `options.state`, invoking the turn execution, retrieving the pure timestamp from `getCurrentDatetimeIso`, and appending `{ userMsg, assistantMsg }` to `options.state` upon turn completion.

### 2. `src/agents/shopping-assistant/shopping-assistant-agent.ts`
- Move `SHOPPING_ASSISTANT_SYSTEM_PROMPT` from `shopping-assistant-loop.ts` directly into `shopping-assistant-agent.ts` (or import from `shopping-assistant-prompt.ts`).
- Update `chat` and `chatStream` to invoke `executeConversationalTurn` and `executeConversationalTurnStream`.
- Remove dependency on `shopping-assistant-loop.ts`.

### 3. `src/agents/manager/manager-agent.ts`
- Update `chat` and `chatStream` to invoke `executeConversationalTurn` and `executeConversationalTurnStream`.
- Remove inline message construction and `Ref.update` duplication.

### 4. Cleanup & Re-exports
- Remove `src/agents/shopping-assistant/shopping-assistant-loop.ts`.
- Update `src/agents/shopping-assistant/index.ts` to export prompt and tools.

---

## Verification Plan

### Automated Tests
1. `npm run format:check` / `npm run format`
2. `npx tsc --noEmit`
3. `npm run lint`
4. `npm test` (all 70 tests across 8 suites, including `test/real-time-chat-stream.test.ts` and `test/pi-agent.test.ts`)
5. `/Users/coon/opt/golem/bin/golem build --yes` (WASM build and verification)
