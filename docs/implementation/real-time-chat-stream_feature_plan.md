# Feature Plan: Real-Time Chat Streaming for Shopping & Manager Assistants

- **Feature ID / Slug**: `real-time-chat-stream`
- **Date**: 2026-11-06
- **Status**: Draft

---

## 1. Overview & Goals

Currently, the `chatStream` methods in both the Shopping Assistant agent (`ShoppingAssistantAgent`) and Manager agent (`ManagerAgent`), as well as `executeAgentChatTurnStream` in `src/ai/agent-loop.ts`, perform **buffered pseudo-streaming**:

```typescript
return Stream.fromEffect(executeChatTurn(options)).pipe(
  Stream.flatMap((result) => Stream.fromIterable(result.chunks)),
);
```

### The Problem
1. **High Time-to-First-Token (TTFT)**: `executeChatTurn` awaits the full completion of `agent.prompt(userMessage)` (all LLM inference round-trips, tool invocations, and text generation) before anything is returned.
2. **Synchronous Dump**: During LLM inference, chunks are pushed into a local in-memory array (`chunks: ChatChunk[]`). Once the turn is 100% complete, `Stream.fromIterable(result.chunks)` dumps all chunks at once.
3. **No Perceived Latency Benefit**: From the perspective of the frontend or external SSE consumer (`/streams/$result?live=sse`), zero events or tokens arrive while the model is thinking or generating, defeating the purpose of streaming.

### Goals
1. **True Asynchronous Live Streaming**: In `executeAgentChatTurnStream`, emit chunks (`tool_start`, `tool_result`, `text_delta`, `done`, `error`) in real time as events occur in `@earendil-works/pi-agent-core` via an Effect `Queue` and `Stream.unwrap` with `Effect.forkScoped`.
2. **Durable State Consistency**: Enable agent implementations (`ShoppingAssistantAgent` and `ManagerAgent`) to update their durable state (`Ref<AgentState>`) when the LLM turn completes via an `onTurnComplete` hook, before the stream is closed with `doneChunk`.
3. **Seamless Backward Compatibility**: Preserve the exact `WitTypes.AgentStream(ChatChunk)` method signature and HTTP endpoint contracts (`POST /v1/assistant/{id}/chat-stream` and `POST /v1/manager/{id}/chat-stream`).
4. **Comprehensive Test Verification**: Add automated tests to verify progressive chunk emission and validate against all project quality gates (`format:check`, `typecheck`, `lint`, `test`, `golem build`).

### Non-Goals
- Modifying the underlying model provider configuration or prompt mechanics.
- Altering the non-streaming `chat` endpoint logic (which remains a standard request/reply RPC).

---

## 2. Architecture & Technical Design

### Live Streaming Data Flow

```mermaid
sequenceDiagram
    autonumber
    participant Client as Frontend / SSE Client
    participant Agent as ShoppingAssistantAgent (chatStream)
    participant Loop as executeAgentChatTurnStream
    participant Queue as Effect Queue.unbounded
    participant Fiber as Background Runner Fiber
    participant Pi as Pi Agent Core (LLM & Tools)

    Client->>Agent: POST /v1/assistant/{id}/chat-stream
    Agent->>Loop: executeChatTurnStream({ ..., onTurnComplete })
    Loop->>Queue: Queue.unbounded()
    Loop->>Fiber: Effect.forkScoped(runTurn)
    Loop-->>Client: Returns live Stream (Stream.fromQueue)
    
    par Live Event Push
        Pi-->>Fiber: subscribe (tool_execution_start)
        Fiber->>Queue: Queue.offerUnsafe(toolStartChunk)
        Queue-->>Client: Emits tool_start chunk
        
        Pi-->>Fiber: subscribe (tool_execution_end)
        Fiber->>Queue: Queue.offerUnsafe(toolResultChunk)
        Queue-->>Client: Emits tool_result chunk
        
        Pi-->>Fiber: subscribe (message_update: text_delta)
        Fiber->>Queue: Queue.offerUnsafe(textDeltaChunk)
        Queue-->>Client: Emits text_delta token
    end

    Pi-->>Fiber: agent.prompt() settles
    Fiber->>Agent: onTurnComplete(result) -> Ref.update(state)
    Fiber->>Queue: Queue.offerUnsafe(doneChunk)
    Fiber->>Queue: Queue.endUnsafe()
    Queue-->>Client: Emits done chunk & closes stream
```

### Key Technical Decisions

1. **`Queue.unbounded` + `Stream.fromQueue`**:
   - In Effect v4, `Queue.unbounded<ChatChunk>()` provides an in-memory queue.
   - `Stream.fromQueue(queue)` creates a lazy, backpressure-aware stream.
   - Calling `Queue.endUnsafe(queue)` or `Queue.end(queue)` cleanly signals the end of the stream, causing consumers to finish.
2. **`Stream.unwrap` with `Effect.forkScoped`**:
   - `Stream.unwrap` allows initializing the queue and forking the LLM execution fiber in the scope of the stream.
   - When the consumer reads the stream, the runner fiber executes concurrently, offering chunks to the queue as they arrive.
   - If the downstream client aborts or closes the stream, Effect's scoped fiber lifecycle cleanly interrupts the background turn.
3. **`onTurnComplete` Callback for State Persistence**:
   - In durable agents, messages must be appended to `Ref.get(state).messages`.
   - Passing `onTurnComplete: (result: ChatTurnResult) => Effect.Effect<void>` allows the agent to update its `Ref` immediately after `agent.prompt` resolves and before `Queue.end` closes the stream.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                                                   | Description                                                                                             |
| :--------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| `[MODIFY]` | [`src/ai/agent-loop.ts`](../../src/ai/agent-loop.ts)                                           | Refactor `executeAgentChatTurnStream` using `Queue` and `Effect.forkScoped`, adding `onTurnComplete`.  |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-loop.ts`](../../src/agents/shopping-assistant/shopping-assistant-loop.ts) | Forward `onTurnComplete` and options to `executeAgentChatTurnStream`.                                   |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-agent.ts`](../../src/agents/shopping-assistant/shopping-assistant-agent.ts) | Update `chatStream` to return `executeChatTurnStream` with state update in `onTurnComplete`.            |
| `[MODIFY]` | [`src/agents/manager/manager-agent.ts`](../../src/agents/manager/manager-agent.ts)                       | Update `chatStream` to use real-time streaming with state update in `onTurnComplete`.                   |
| `[NEW]`    | [`test/ai/real-time-chat-stream.test.ts`](../../test/ai/real-time-chat-stream.test.ts)               | Unit tests asserting progressive event streaming, token delivery order, and turn completion callbacks.  |

### Detailed Changes

#### 1. `src/ai/agent-loop.ts`
- Define `ExecuteAgentChatTurnStreamOptions` extending `ExecuteAgentChatTurnOptions` with optional `onTurnComplete?: (result: ChatTurnResult) => Effect.Effect<void>`.
- Implement `executeAgentChatTurnStream` using:
  ```typescript
  export function executeAgentChatTurnStream(
    options: ExecuteAgentChatTurnStreamOptions,
  ): Stream.Stream<ChatChunk> {
    return Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ChatChunk>();
        // Fork background execution
        yield* Effect.forkScoped(
          Effect.gen(function* () {
            // Setup Agent & subscribe
            // Queue.offerUnsafe for toolStart, toolResult, textDelta
            // yield* Effect.promise(() => agent.prompt(userMessage))
            // yield* options.onTurnComplete?.(result)
            // Queue.offerUnsafe(doneChunk)
            // Queue.endUnsafe(queue)
          })
        );
        return Stream.fromQueue(queue);
      })
    );
  }
  ```

#### 2. `src/agents/shopping-assistant/shopping-assistant-loop.ts` & `shopping-assistant-agent.ts`
- Pass `onTurnComplete` from `chatStream` in `ShoppingAssistantAgent`:
  ```typescript
  chatStream: ({ message }) =>
    Effect.gen(function* () {
      const { userId, messages } = yield* Ref.get(state);
      const { apiKey, model, apiUrl } = yield* resolveLlmConfig;
      const context = yield* Effect.context();
      const tools = getShoppingAssistantPiTools(userId, context);

      return executeChatTurnStream({
        userId,
        apiKey,
        model,
        apiUrl,
        history: messages,
        userMessage: message,
        tools,
        onTurnComplete: (result) =>
          Ref.update(state, (prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              { role: "user", content: message, timestamp: new Date().toISOString(), type: "ok" },
              { role: "assistant", content: result.reply, toolCalls: result.toolCallsUsed.length > 0 ? [...result.toolCallsUsed] : undefined, timestamp: new Date().toISOString(), type: result.type },
            ],
          })),
      });
    }),
  ```

#### 3. `src/agents/manager/manager-agent.ts`
- Apply the same pattern to `ManagerAgent.methods.chatStream`.

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
4. **Unit & Integration Tests**:
   ```bash
   npm test
   ```
5. **Golem Component Build**:
   ```bash
   golem build --yes
   ```

### Manual / Streaming Behavior Check
- Verify via unit test in `test/ai/real-time-chat-stream.test.ts` with delayed mock stream events that intermediate chunks are emitted before the final stream termination.

---

## 5. Risks & Open Questions

- **Risk**: Stream termination if the client aborts or disconnects prematurely.
  - *Mitigation*: Using `Effect.forkScoped` inside `Stream.unwrap` ensures that if the downstream stream reader interrupts, the background fiber is safely interrupted and does not leak unhandled rejections.
- **Risk**: Missing API key case.
  - *Mitigation*: If `apiKey` is empty, immediately offer the missing-key `textDeltaChunk`, `errorChunk`, `doneChunk`, and close the queue without spinning up the model.

