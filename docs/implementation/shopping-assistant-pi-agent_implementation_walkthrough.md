# Feature Implementation Walkthrough: Replace Custom Shopping Assistant Loop with Pi Agent

- **Feature ID / Slug**: `shopping-assistant-pi-agent`
- **Date**: 2026-10-31
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

We have successfully replaced the custom while-loop in `ShoppingAssistantAgent` with **Pi Agent** (`@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`), the minimalist, extensible TypeScript agent runtime created by Mario Zechner.

The new implementation:
1. Replaces the manual HTTP completions loop with `Agent` from `@earendil-works/pi-agent-core`, delegating turn management, tool calling orchestration, and token streaming to Pi Agent.
2. Bridges all 13 existing Effect-based shopping assistant tools (`CartAgent`, `ProductSearchAgent`, `OrderAgent`) into Pi Agent `AgentTool` instances via `shopping-assistant-pi-tools.ts`, executing tool logic safely inside Effect fibers (`Effect.runPromise`).
3. Supports dynamic multi-provider routing (Google Gemini, OpenRouter, and custom OpenAI-compatible endpoints) via `@earendil-works/pi-ai`.
4. Maintains 100% backward compatibility with Golem agent methods (`chat` and `chatStream`), REST HTTP endpoints (`POST /v1/assistant/{id}/chat`, `POST /v1/assistant/{id}/chat-stream`), and `ChatChunk` event streaming.
5. Passes strict validation: formatting, TypeScript typecheck, ESLint, and the automated test suite.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                     | Summary of Changes                                                         |
| :--------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| `[MODIFY]` | [`package.json`](../../package.json)                                          | Added `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and `@sinclair/typebox` |
| `[NEW]`    | [`src/agents/shopping-assistant/shopping-assistant-pi-tools.ts`](../../src/agents/shopping-assistant/shopping-assistant-pi-tools.ts) | Created tool adapter converting Effect domain tools to Pi `AgentTool` definitions |
| `[NEW]`    | [`src/agents/shopping-assistant/shopping-assistant-pi-provider.ts`](../../src/agents/shopping-assistant/shopping-assistant-pi-provider.ts) | Pi AI provider resolution module cleanly separating model routing from host bindings |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-tools.ts`](../../src/agents/shopping-assistant/shopping-assistant-tools.ts) | Exported `getShoppingAssistantPiTools` helper for domain tool collection   |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-loop.ts`](../../src/agents/shopping-assistant/shopping-assistant-loop.ts) | Replaced custom while-loop with `Agent` from `pi-agent-core` and ambient context forwarding |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                              | Configured native Google Generative AI provider defaults                   |
| `[NEW]`    | [`test/pi-agent.test.ts`](../../test/pi-agent.test.ts)                        | Added automated tests verifying Pi tool adapter, multi-turn tool calling, and streaming |
| `[NEW]`    | [`test/pi-agent-provider.test.ts`](../../test/pi-agent-provider.test.ts)      | Added test verifying native Google, OpenRouter, and dynamic OpenAI routing |

### Key Logic & API Changes

- **Tool Adaptation & Context Propagation (`shopping-assistant-pi-tools.ts`)**:
  - Implemented `toPiAgentTool(toolDef, userId, context)`: maps tool parameters JSON schema from Effect Schema (`schemaToJsonSchema`) and bridges `toolDef.run(params, { userId })` to `execute: async (toolCallId, params)`.
  - Crucially propagates the ambient Golem invocation `Context.Context<never>` (retrieved via `yield* Effect.context()` in `executeChatTurn`) into the tool's fiber via `Effect.provide(context)`. This ensures that tools invoking other Golem agents (e.g. `CartAgent`, `OrderAgent`, `ProductSearchAgent`) have full access to Golem host services such as `RpcClient` (`effect-golem/host/Rpc`).
  - Implemented `createPiAgentTools(tools, userId, context)`: batch converts all domain tools with context forwarding.
- **Provider & Model Resolution (`setupModelsAndProvider`)**:
  - Resolves OpenRouter models, native Google Gemini models, or registers a dynamic OpenAI-compatible provider using `openAICompletionsApi()` to support OpenAI, Gemini OpenAI endpoints (`/v1beta/openai`), and custom LLM gateways.
  - Configures `compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsReasoningEffort: isGoogleOpenAi }` and `thinkingLevelMap: { off: "none" }` for Google's OpenAI-compatible endpoint. This suppresses unsupported fields like `store` and disables thinking thoughts (`reasoning_effort: "none"`), preventing thought-signature validation errors during multi-turn function call replies.
- **Error Formatting Resilience (`error-formatter.ts`)**:
  - Enhanced `extractLlmErrorMessage` to cleanly parse JSON error arrays returned by Gemini's endpoint even when prefixed with status codes (e.g. `400 [{ error: ... }]`).
- **Event Streaming Bridge**:
  - Subscribes to Pi Agent events (`tool_execution_start`, `tool_execution_end`, `message_update`) and translates them into Golem `ChatChunk` elements (`tool_start`, `tool_result`, `text_delta`, `done`, `error`).
  - Preserves full conversation history and records tool invocations into `ToolCallRecord[]`.

---

## 3. Verification & Validation Results

### 3.1 Code Formatting

Command executed:

```bash
npm run format:check
```

**Result**:

```text
> prettier --check src/ test/

Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking

Command executed:

```bash
npm run typecheck
```

**Result**:

```text
> tsc --noEmit
[Process completed with exit code 0 - zero TypeScript errors]
```

### 3.3 Linter Verification

Command executed:

```bash
npm run lint
```

**Result**:

```text
> eslint src/ test/
[Process completed with exit code 0 - zero ESLint errors and zero warnings]
```

### 3.4 Golem Build

Command executed:

```bash
golem build --yes
```

**Result**:

```text
> golem build --yes

Selecting components
  Found components: golem-shopping-effect:effect-main
  Selected components and layers:
    golem-shopping-effect:effect-main: effect, effect[optimized],
         golem-shopping-effect:effect-main
Building components
  Building golem-shopping-effect:effect-main
    Executing external command 'npx tsc --project "/Users/coon/workspace-zv/
         git/golem-shopping-effect" --noEmit false --emitDeclarationOnly
         --declaration --outFile "/Users/coon/workspace-zv/git/
         golem-shopping-effect/golem-temp/ts-check/
         golem-shopping-effect-effect-main/main.d.ts"' in directory /Users/
         coon/workspace-zv/git/golem-shopping-effect
    Executing external command 'npx --no rollup -- -c "/Users/coon/
         workspace-zv/git/golem-shopping-effect/golem-temp/common/effect/
         rollup.config.component.mjs"' in directory /Users/coon/workspace-zv/
         git/golem-shopping-effect
    Injecting JS module /Users/coon/workspace-zv/git/golem-shopping-effect/
         golem-temp/ts-dist/golem-shopping-effect-effect-main/main.js into
         QuickJS WASM /Users/coon/workspace-zv/git/golem-shopping-effect/
         node_modules/@golemcloud/effect-golem/wasm/agent_guest.wasm
    Pre-initializing JS component /Users/coon/workspace-zv/git/
         golem-shopping-effect/golem-temp/agents/
         golem_shopping_effect_effect_main.dynamic.wasm into /Users/coon/
         workspace-zv/git/golem-shopping-effect/golem-temp/agents/
         golem_shopping_effect_effect_main.preinitialized.wasm
Reading component from /Users/coon/workspace-zv/git/golem-shopping-effect/golem-temp/agents/golem_shopping_effect_effect_main.dynamic.wasm...
Pre-initializing component (init_func=wizer-initialize)...
Writing pre-initialized component to /Users/coon/workspace-zv/git/golem-shopping-effect/golem-temp/agents/golem_shopping_effect_effect_main.preinitialized.wasm...
Done! Input: 22120.0 KB, Output: 66817.7 KB
  Adding metadata to golem-shopping-effect:effect-main

Finished building [OK]
```

### 3.5 Automated Unit & Integration Tests

Command executed:

```bash
npm test
```

**Result**:

```text
> tsx --test "test/**/*.test.ts"

▶ LLM Error Formatting
  ✔ parses array error format from Gemini HTTP 503 transparently (2.485433ms)
  ✔ parses error string prefixed with HTTP status code (0.4107ms)
  ✔ parses standard object error format (HTTP 429 rate limit) (0.38284ms)
  ✔ parses HTTP 401 authentication error (0.377663ms)
  ✔ handles HTML error responses gracefully (0.586016ms)
  ✔ fixes mojibake encoding corruption (â€“ to -) (0.506798ms)
  ✔ summarizes get_cart tool result with structured object or raw JSON (0.457361ms)
  ✔ summarizes search_products tool result with structured array (0.431652ms)
✔ LLM Error Formatting (9.178963ms)
✔ custom OpenAI provider can be registered in createModels (3.493169ms)
✔ setupModelsAndProvider routes Gemini models to native Google Generative AI provider (0.61935ms)
✔ setupModelsAndProvider routes OpenRouter models to openrouter provider (0.800472ms)
✔ setupModelsAndProvider routes custom endpoints to dynamic OpenAI provider (0.305752ms)
✔ createPiAgentTools creates valid AgentTool array from tool definitions (15.33804ms)
✔ Pi Agent executes turn with mock model, tool calls, and event stream (77.077522ms)
✔ createPiAgentTools propagates ambient Context to tool execution (10.780806ms)
▶ ProductQueryMatcher
  ✔ matches by wildcard * (2.380165ms)
  ✔ matches by keyword term in name or description (0.495984ms)
  ✔ matches by brand filter (0.472767ms)
  ✔ matches by tag filter (0.356755ms)
  ✔ matches multiple tokens and field filters combined (0.396216ms)
  ✔ handles quoted phrases (0.22615ms)
✔ ProductQueryMatcher (7.247494ms)
ℹ tests 21
ℹ suites 2
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2362.978958
```

---

## 4. Usage Examples

### Synchronous Chat Invocation via Golem CLI

```bash
golem agent invoke ShoppingAssistantAgent user-123 chat '{"message": "Find wireless headphones and show me their prices"}'
```

Returns:

```json
{
  "reply": "I found Sony WH-1000XM5 for $349.99 and Bose QuietComfort 45 for $279.00. Would you like me to add either to your cart?",
  "toolCallsUsed": [
    {
      "id": "call-1",
      "toolName": "search_products",
      "arguments": "{\"query\":\"wireless headphones\"}",
      "result": "[{\"id\":\"p101\",\"name\":\"Sony WH-1000XM5\",\"price\":{\"price\":349.99}}]"
    }
  ],
  "type": "ok"
}
```

### Real-Time Streaming via HTTP Endpoint

```bash
curl -X POST http://localhost:9006/v1/assistant/user-123/chat-stream \
  -H "Content-Type: application/json" \
  -d '{"message": "Add Sony WH-1000XM5 to my cart and checkout"}'
```

Streams chunk events:

```json
{"type": "tool_start", "tool": "add_to_cart", "content": "Executing add_to_cart..."}
{"type": "tool_result", "tool": "add_to_cart", "content": "Item added to cart"}
{"type": "tool_start", "tool": "checkout_cart", "content": "Executing checkout_cart..."}
{"type": "tool_result", "tool": "checkout_cart", "content": "Order placed successfully (#ord-8291)"}
{"type": "text_delta", "tool": "", "content": "I have added the Sony WH-1000XM5 to your cart and placed your order! Your order ID is ord-8291."}
{"type": "done", "tool": "", "content": ""}
```

