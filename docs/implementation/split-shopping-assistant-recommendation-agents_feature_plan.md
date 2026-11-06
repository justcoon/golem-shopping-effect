# Feature Plan: Split Shopping Assistant into Chat & Recommendation Agents

- **Feature ID / Slug**: `split-shopping-assistant-recommendation-agents`
- **Date**: 2026-11-06
- **Status**: In Progress

---

## 1. Overview & Goals

Currently, `ShoppingAssistantAgent` handles two completely separate responsibilities:
1. Real-time conversational shopping assistance (`chat`, `chatStream`, `getHistory`, `clearHistory`).
2. Personalized user recommendations based on order history (`getRecommendedItems`, `recommendItems`).

### The Problem
- **Violation of Single Responsibility**: Chat handling and background analytical product recommendations have different lifecycles and schemas.
- **Execution Bottleneck in Golem**: Golem processes invocations sequentially per agent instance. When checkout completes in `CartAgent`, it triggers `recommendItems`, which gathers orders and calls the LLM. While `recommendItems` is running, the user's `ShoppingAssistantAgent` instance is busy, blocking or delaying interactive user chat.

### Goals
1. Create `ShoppingRecommendationAgent` dedicated exclusively to recommendation state, historical order aggregation, and recommendation generation.
2. Refactor `ShoppingAssistantAgent` to focus purely on conversation and streaming.
3. Update `CartAgent` to trigger `ShoppingRecommendationAgent.client.get({ id: userId }).recommendItems.trigger({})` on checkout.
4. Update frontend and web assets to query `/v1/recommendation/{id}/recommended-items`.
5. Register `ShoppingRecommendationAgent` in `src/main.ts` and `golem.yaml`.
6. Validate all changes with strict quality checks: `format:check`, `typecheck`, `lint`, `test`, and `golem build --yes`.

---

## 2. Architecture & Technical Design

### New Agent: `ShoppingRecommendationAgent`
- **Identity**: `{ id: Schema.String }` (userId)
- **State**:
  ```typescript
  interface ShoppingRecommendationAgentState {
    readonly userId: string;
    readonly recommendedItems: RecommendedItems;
  }
  ```
- **HTTP Mount**: `/v1/recommendation/{id}`
- **Methods**:
  - `getRecommendedItems`: `GET /recommended-items`, `GET /items` (readOnly)
  - `recommendItems`: `POST /recommend`
- **Config**: `ShoppingRecommendationConfig` with `llm: { apiKey, model, apiUrl }`.

### Streamlined Agent: `ShoppingAssistantAgent`
- **Identity**: `{ id: Schema.String }` (userId)
- **State**:
  ```typescript
  interface ShoppingAssistantAgentState {
    readonly userId: string;
    readonly messages: readonly ChatMessage[];
  }
  ```
- **HTTP Mount**: `/v1/assistant/{id}`
- **Methods**: `chat`, `chatStream`, `getHistory`, `clearHistory`.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                   | Description                                                                 |
| :--------- | :-------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| `[NEW]`    | `src/agents/shopping-recommendation/shopping-recommendation-schema.ts`       | `RecommendedItems`, `LLMRecommendations`, recommendation limits constants  |
| `[NEW]`    | `src/agents/shopping-recommendation/shopping-recommendation-definition.ts`   | Agent definition, config, and method signatures                              |
| `[NEW]`    | `src/agents/shopping-recommendation/shopping-recommendation-logic.ts`        | `executeRecommendItems`, `reduceOrderItems`, `cleanMarkdownJsonString`      |
| `[NEW]`    | `src/agents/shopping-recommendation/shopping-recommendation-agent.ts`        | Agent implementation with durable state and handlers                        |
| `[NEW]`    | `src/agents/shopping-recommendation/index.ts`                               | Public exports for recommendation agent                                     |
| `[NEW]`    | `test/shopping-recommendation.test.ts`                                      | Tests for recommendation aggregation, schema decoding, and execution        |
| `[MODIFY]` | `src/agents/shopping-assistant/shopping-assistant-schema.ts`                 | Remove `RecommendedItems` and recommendation constants                     |
| `[MODIFY]` | `src/agents/shopping-assistant/shopping-assistant-definition.ts`             | Remove `getRecommendedItems` and `recommendItems` methods                  |
| `[MODIFY]` | `src/agents/shopping-assistant/shopping-assistant-agent.ts`                  | Remove recommendation state and methods                                     |
| `[DELETE]` | `src/agents/shopping-assistant/shopping-assistant-recommendations.ts`        | Removed in favor of `shopping-recommendation-logic.ts`                      |
| `[MODIFY]` | `src/agents/shopping-assistant/index.ts`                                    | Remove recommendation exports                                               |
| `[MODIFY]` | `src/agents/cart/cart-agent.ts`                                             | Trigger `ShoppingRecommendationDefinition.client` on checkout               |
| `[MODIFY]` | `src/main.ts`                                                               | Import and export `ShoppingRecommendationAgent`                             |
| `[MODIFY]` | `golem.yaml`                                                                | Add `ShoppingRecommendationAgent: {}` under `httpApi.deployments.local.agents` |
| `[MODIFY]` | `frontend/src/api/services/assistantService.ts`                             | Point recommendation fetch to `/api/v1/recommendation/${userId}/recommended-items` |
| `[MODIFY]` | `web/assets/assistant.js`                                                   | Point recommendation fetch to `/v1/recommendation/${currentUserId}/recommended-items` |

---

## 4. Verification Plan

1. **Formatting**: `npm run format:check`
2. **Type Checking**: `npm run typecheck`
3. **Linting**: `npm run lint`
4. **Unit & Integration Tests**: `npm test`
5. **Golem Component Build**: `golem build --yes`

