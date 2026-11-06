# Feature Implementation Walkthrough: Split Shopping Assistant into Chat & Recommendation Agents

- **Feature ID / Slug**: `split-shopping-assistant-recommendation-agents`
- **Date**: 2026-11-06
- **Status**: Ready for Review

---

## 1. Executive Summary

We successfully split the monolithic `ShoppingAssistantAgent` into two specialized Golem durable agents:
1. **`ShoppingAssistantAgent`**: Dedicated exclusively to interactive chat, streaming turn responses (`chatStream`), and conversation history.
2. **`ShoppingRecommendationAgent`**: Dedicated exclusively to personalized product recommendation calculation, order aggregation, and recommendation caching.

This eliminates sequential execution bottlenecks in Golem: background recommendation generation triggered by `CartAgent` after checkout now runs independently on `ShoppingRecommendationAgent` without stalling or delaying real-time user chat on `ShoppingAssistantAgent`.

All 56 unit and integration tests passed, and the WASM component preinitialized and built cleanly via `golem build --yes`.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                                                   | Summary of Changes                                                                                     |
| :--------- | :---------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `[NEW]`    | [`src/agents/shopping-recommendation/shopping-recommendation-schema.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-recommendation/shopping-recommendation-schema.ts)       | Defined `RecommendedItems`, `LLMRecommendations`, `reduceOrderItems`, and `cleanMarkdownJsonString`.  |
| `[NEW]`    | [`src/agents/shopping-recommendation/shopping-recommendation-definition.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-recommendation/shopping-recommendation-definition.ts)   | Defined `ShoppingRecommendationConfig` and `ShoppingRecommendationDefinition` mounted at `/v1/recommendation/{id}`. `getRecommendedItems` exposed over HTTP; `recommendItems` kept internal-only (no HTTP route). |
| `[NEW]`    | [`src/agents/shopping-recommendation/shopping-recommendation-logic.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-recommendation/shopping-recommendation-logic.ts)        | Implemented order gathering from `CartAgent` and `OrderAgent` + LLM recommendation generation.         |
| `[NEW]`    | [`src/agents/shopping-recommendation/shopping-recommendation-agent.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-recommendation/shopping-recommendation-agent.ts)        | Implemented `getRecommendedItems` and `recommendItems` methods with durable state.                   |
| `[NEW]`    | [`src/agents/shopping-recommendation/index.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-recommendation/index.ts)                               | Module public exports.                                                                                 |
| `[NEW]`    | [`test/shopping-recommendation.test.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/test/shopping-recommendation.test.ts)                                       | Unit tests for order item aggregation, recommendation limits, codeblock stripping, and schema decoding. |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-schema.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-schema.ts)                 | Removed `RecommendedItems` and recommendation constants.                                               |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-definition.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-definition.ts)             | Removed recommendation methods from agent definition.                                                 |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-agent.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-agent.ts)                  | Cleaned state to `{ userId, messages }` and removed recommendation handlers.                          |
| `[DELETE]` | `src/agents/shopping-assistant/shopping-assistant-recommendations.ts`                                       | Removed in favor of `shopping-recommendation` module.                                                 |
| `[MODIFY]` | [`src/agents/shopping-assistant/index.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/index.ts)                                    | Removed recommendation exports.                                                                        |
| `[MODIFY]` | [`src/agents/cart/cart-agent.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/cart/cart-agent.ts)                                             | Updated checkout confirmation to trigger `ShoppingRecommendationDefinition.client.recommendItems`.    |
| `[MODIFY]` | [`src/main.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/main.ts)                                                               | Exported `ShoppingRecommendationAgent`.                                                                |
| `[MODIFY]` | [`golem.yaml`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/golem.yaml)                                                                | Added `ShoppingRecommendationAgent: {}` to HTTP API deployments.                                       |
| `[MODIFY]` | [`frontend/src/api/services/assistantService.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/frontend/src/api/services/assistantService.ts)                             | Updated endpoint to `/api/v1/recommendation/${userId}/recommended-items`.                              |
| `[MODIFY]` | [`web/assets/assistant.js`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/web/assets/assistant.js)                                                   | Updated endpoint to `/v1/recommendation/${encodeURIComponent(currentUserId)}/recommended-items`.       |

---

## 3. Verification & Validation Results

### 3.1 Code Formatting

```bash
npm run format:check
```

**Result**:
```text
All matched files use Prettier code style!
```

### 3.2 Linter Verification

```bash
npm run lint
```

**Result**:
```text
✖ 2 problems (0 errors, 2 warnings in existing test any-types)
```

### 3.3 Type Checking

```bash
npm run typecheck
```

**Result**:
```text
> tsc --noEmit
(zero errors)
```

### 3.4 Automated Test Suite Execution

```bash
npm test
```

**Result**:
```text
✔ Two-Phase Checkout: Inventory Reservation & Expiration (23.814127ms)
✔ LLM Error Formatting (6.876582ms)
✔ Inventory Schema & Business Logic (9.831484ms)
✔ Manager Tools & AI Tool Generation (7.351562ms)
✔ OrderQueryMatcher (7.305315ms)
✔ Pi Agent executes turn with mock model, tool calls, and event stream (38.956898ms)
✔ ProductQueryMatcher (6.614808ms)
✔ executeAgentChatTurnStream handles missing API key with live error chunks and onTurnComplete (15.245329ms)
✔ executeAgentChatTurnStream handles downstream stream pull and completes cleanly (2.80389ms)
✔ reduceOrderItems aggregates quantities and sorts by quantity descending (2.10722ms)
✔ reduceOrderItems respects RECOMMENDATION_INPUT_COUNT cap (0.596775ms)
✔ cleanMarkdownJsonString extracts JSON from codeblocks (0.477828ms)
✔ RecommendedItems schema encodes and decodes properly (9.651459ms)
✔ Tool Generator (shopping-assistant-tool-generator) (36.012681ms)
ℹ tests 56
ℹ suites 7
ℹ pass 56
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2185.396441
```

### 3.5 Golem WASM Component Build

```bash
golem build --yes
```

**Result**:
```text
Selecting components
  Found components: golem-shopping-effect:effect-main
Building components
  Building golem-shopping-effect:effect-main
    Executing external command 'npx tsc ...'
    Executing external command 'npx rollup ...'
    Injecting JS module ... into QuickJS WASM ...
    Pre-initializing JS component ... with wizer ...
Writing pre-initialized component ...
Done! Input: 22202.1 KB, Output: 68349.0 KB
  Adding metadata to golem-shopping-effect:effect-main

Finished building [OK]
```

---

## 4. Conclusion

`ShoppingAssistantAgent` and `ShoppingRecommendationAgent` are now decoupled into two focused agents with separate durable identities, non-blocking execution, and clean HTTP endpoints.

