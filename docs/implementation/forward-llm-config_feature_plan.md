# Feature Plan: Forward `LlmConfig` and Eliminate Secret Unpacking Boilerplate

## Motivation & Context
In [`ManagerAgent`](../../src/agents/manager/manager-agent.ts), [`ShoppingAssistantAgent`](../../src/agents/shopping-assistant/shopping-assistant-agent.ts), and [`ShoppingRecommendationAgent`](../../src/agents/shopping-recommendation/shopping-recommendation-agent.ts), each module manually defines a local `resolveLlmConfig` helper that unpacks `apiKey`, `model`, and `apiUrl` from Golem configuration using `Redacted.value(yield* config.llm.x.get)`.

Additionally, [`shopping-assistant-definition.ts`](../../src/agents/shopping-assistant/shopping-assistant-definition.ts) and [`shopping-recommendation-definition.ts`](../../src/agents/shopping-recommendation/shopping-recommendation-definition.ts) duplicate the `Schema.Struct({ apiKey: ..., model: ..., apiUrl: ... })` definition instead of referencing `LlmConfigSchema`.

This plan standardizes definitions to use `LlmConfigSchema` and updates `executeConversationalTurn`, `executeConversationalTurnStream`, and `executeRecommendItems` to accept `llm: LlmConfigInput` directly, resolving secrets internally.

---

## User Review Required

> [!IMPORTANT]
> - `LlmConfigInput` will accept either raw resolved strings `{ apiKey, model, apiUrl? }` (e.g. for unit tests) or Golem's typed config object `{ apiKey: { get }, model: { get }, apiUrl: { get } }`.
> - Agents will directly forward `const { llm } = yield* AgentConfig;` to turn and recommendation functions.
> - All local `resolveLlmConfig` helpers in agents will be eliminated.
> - `ShoppingAssistantConfig` and `ShoppingRecommendationConfig` will use `llm: LlmConfigSchema`.

---

## Proposed Changes

### 1. `src/ai/ai-schema.ts`
- Define `ResolvedLlmConfig` and `LlmConfigInput`:
  ```typescript
  import { Effect, Redacted } from "effect";

  export interface ResolvedLlmConfig {
    readonly apiKey: string;
    readonly model: string;
    readonly apiUrl?: string;
  }

  export type LlmConfigInput =
    | ResolvedLlmConfig
    | {
        readonly apiKey: { readonly get: Effect.Effect<Redacted.Redacted<string>> };
        readonly model: { readonly get: Effect.Effect<Redacted.Redacted<string>> };
        readonly apiUrl: { readonly get: Effect.Effect<Redacted.Redacted<string>> };
      };
  ```

### 2. `src/ai/agent-loop.ts`
- Add `resolveLlmConfig(llm: LlmConfigInput): Effect.Effect<ResolvedLlmConfig>`:
  ```typescript
  export const resolveLlmConfig = (llm: LlmConfigInput): Effect.Effect<ResolvedLlmConfig> =>
    Effect.gen(function* () {
      if ("get" in llm.apiKey) {
        const apiKey = Redacted.value(yield* llm.apiKey.get);
        const model = Redacted.value(yield* llm.model.get);
        const apiUrl = Redacted.value(yield* llm.apiUrl.get);
        return { apiKey, model, apiUrl };
      }
      return llm as ResolvedLlmConfig;
    });
  ```
- Update `ExecuteConversationalTurnOptions`:
  ```typescript
  export interface ExecuteConversationalTurnOptions<
    S extends { readonly messages: readonly ChatMessage[] },
  > {
    readonly state: Ref.Ref<S>;
    readonly userMessage: string;
    readonly systemPrompt: string;
    readonly tools: readonly AgentTool<TSchema>[];
    readonly llm: LlmConfigInput;
    readonly missingApiKeyMessage?: string;
  }
  ```
- Update `executeConversationalTurn` and `executeConversationalTurnStream` to resolve `options.llm` via `resolveLlmConfig`.

### 3. `src/agents/shopping-assistant/shopping-assistant-definition.ts` & `src/agents/shopping-recommendation/shopping-recommendation-definition.ts`
- Replace inline struct definition with `llm: LlmConfigSchema`.

### 4. `src/agents/shopping-assistant/shopping-assistant-agent.ts`
- Remove local `resolveLlmConfig`.
- In `chat` and `chatStream`: fetch `const { llm } = yield* ShoppingAssistantConfig;` and pass `llm`.

### 5. `src/agents/manager/manager-agent.ts`
- Remove local `resolveLlmConfig`.
- In `chat` and `chatStream`: fetch `const { llm } = yield* ManagerAgentConfig;` and pass `llm`.

### 6. `src/agents/shopping-recommendation/shopping-recommendation-logic.ts` & `shopping-recommendation-agent.ts`
- Update `executeRecommendItems` to accept `llm: LlmConfigInput` and resolve it internally.
- Remove local `resolveLlmConfig` in `shopping-recommendation-agent.ts`.

---

## Verification Plan

### Automated Tests
1. `npm run format:check` / `npm run format`
2. `npx tsc --noEmit`
3. `npm run lint`
4. `npm test` (all 70 tests pass)
5. `/Users/coon/opt/golem/bin/golem build --yes` (WASM component build)
