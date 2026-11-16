# Feature Plan: Schema-Driven Snapshots for Durable Golem Agents (1.3)

- **Feature ID / Slug**: `durable-agents-snapshotting`
- **Date**: 2026-11-16
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

In Golem durable execution, every successful state mutation appends records to the durable operation log (oplog). Over time, long-running durable agents accumulate state changes:
- In `ShoppingAssistantAgent` and `ManagerAgent`, the conversational `messages` history grows on every turn.
- In `CartAgent`, items, addresses, drafts, and order IDs accumulate.
- In `OrderAgent` and `InventoryAgent`, items and reservation allocations evolve over time.

Without snapshots, recovering an agent or upgrading components requires Golem to replay the entire historical oplog from step 0. 

Under recommendation **1.3**, this feature adds first-class schema-driven snapshots (`Snapshot.define` and `Snapshot.ref`) across durable agents using `@golemcloud/effect-golem`.

### Goals

1. Define typed, schema-validated snapshot state representations for durable agents:
   - `ShoppingAssistantAgent` & `ManagerAgent`: Snapshot chat history every 5 turns (`everyN(5)`).
   - `CartAgent` & `OrderAgent`: Snapshot cart and order state every 10 operations (`everyN(10)`).
   - `InventoryAgent`, `PricingAgent`, `ProductAgent`, & `ShoppingRecommendationAgent`: Snapshot state every 5 to 10 operations.
2. Configure `snapshotting: Snapshot.define({ schema, policy })` on agent definitions.
3. Bind `snapshot: Snapshot.ref<State>()` in agent implementations so Golem automatically handles serialization, deserialization, and instant state recovery without full oplog replay.
4. Pass all automated checks: formatting, typechecking, linter, test suite, and Golem WASM build.

### Non-Goals

- Migrating historical binary files or custom byte serialization (schema-driven JSON snapshot envelopes are used as recommended by Golem).

---

## 2. Architecture & Technical Design

### 2.1 Schema-Driven Snapshots in Golem Effect SDK

The Golem Effect SDK provides native snapshotting via:
1. **Agent Definition**:
   ```typescript
   export const MyAgentDefinition = defineAgent({
     name: "MyAgent",
     mode: "durable",
     id: { id: Schema.String },
     snapshotting: Snapshot.define({
       schema: MyAgentState,
       policy: Snapshot.policy.everyN(10),
     }),
     methods: { ... },
   });
   ```
2. **Agent Implementation**:
   ```typescript
   export const MyAgent = MyAgentDefinition.implement({
     init: ({ id }) => Ref.make<MyAgentState>(...),
     methods: (state) => ({ ... }),
     snapshot: Snapshot.ref<MyAgentState>(),
   });
   ```

### 2.2 Snapshot Policies

- **Conversational Agents (`ShoppingAssistantAgent`, `ManagerAgent`, `ShoppingRecommendationAgent`)**:
  - Policy: `Snapshot.policy.everyN(5)` (snapshots taken every 5 turns/recommendations).
- **Commerce & Catalog Agents (`CartAgent`, `OrderAgent`, `InventoryAgent`, `PricingAgent`, `ProductAgent`)**:
  - Policy: `Snapshot.policy.everyN(10)` (snapshots taken every 10 operations).

### 2.3 State Schemas

All agent state structures are already composed of Effect Schemas or will be declared as explicit `Schema.Struct` definitions:
- **`CartAgentState`**:
  ```typescript
  export const CartAgentState = Schema.Struct({
    userId: Schema.String,
    cart: Schema.NullOr(Cart),
  });
  ```
- **`OrderAgentState`**:
  ```typescript
  export const OrderAgentState = Schema.Struct({
    orderId: Schema.String,
    order: Schema.NullOr(Order),
  });
  ```
- **`ShoppingAssistantAgentState`**:
  ```typescript
  export const ShoppingAssistantAgentState = Schema.Struct({
    userId: Schema.String,
    messages: Schema.Array(ChatMessage),
  });
  ```
- **`ManagerAgentState`**:
  ```typescript
  export const ManagerAgentState = Schema.Struct({
    managerId: Schema.String,
    messages: Schema.Array(ChatMessage),
  });
  ```
- **`InventoryAgentState`**:
  ```typescript
  export const InventoryAgentState = Schema.Struct({
    productId: Schema.String,
    inventory: Schema.NullOr(Inventory),
  });
  ```
- **`PricingAgentState`**:
  ```typescript
  export const PricingAgentState = Schema.Struct({
    productId: Schema.String,
    pricing: Schema.NullOr(Pricing),
  });
  ```
- **`ProductAgentState`**:
  ```typescript
  export const ProductAgentState = Schema.Struct({
    productId: Schema.String,
    product: Schema.NullOr(Product),
  });
  ```
- **`ShoppingRecommendationAgentState`**:
  ```typescript
  export const ShoppingRecommendationAgentState = Schema.Struct({
    userId: Schema.String,
    recommendedItems: RecommendedItems,
  });
  ```

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                          | Description                                                        |
| :--------- | :------------------------------------------------- | :----------------------------------------------------------------- |
| `[MODIFY]` | [`src/agents/cart/cart-schema.ts`](../../src/agents/cart/cart-schema.ts) | Export `CartAgentState` schema                                     |
| `[MODIFY]` | [`src/agents/cart/cart-definition.ts`](../../src/agents/cart/cart-definition.ts) | Add `snapshotting: Snapshot.define(CartAgentState)`                 |
| `[MODIFY]` | [`src/agents/cart/cart-agent.ts`](../../src/agents/cart/cart-agent.ts) | Add `snapshot: Snapshot.ref<CartAgentState>()`                     |
| `[MODIFY]` | [`src/agents/order/order-schema.ts`](../../src/agents/order/order-schema.ts) | Export `OrderAgentState` schema                                   |
| `[MODIFY]` | [`src/agents/order/order-agent.ts`](../../src/agents/order/order-agent.ts) | Add `snapshotting` definition and `snapshot: Snapshot.ref`         |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-definition.ts`](../../src/agents/shopping-assistant/shopping-assistant-definition.ts) | Export state schema and add `snapshotting` definition             |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-agent.ts`](../../src/agents/shopping-assistant/shopping-assistant-agent.ts) | Add `snapshot: Snapshot.ref<ShoppingAssistantAgentState>()`       |
| `[MODIFY]` | [`src/agents/manager/manager-definition.ts`](../../src/agents/manager/manager-definition.ts) | Export state schema and add `snapshotting` definition             |
| `[MODIFY]` | [`src/agents/manager/manager-agent.ts`](../../src/agents/manager/manager-agent.ts) | Add `snapshot: Snapshot.ref<ManagerAgentState>()`                 |
| `[MODIFY]` | [`src/agents/inventory/inventory-agent.ts`](../../src/agents/inventory/inventory-agent.ts) | Export state schema, add `snapshotting` and `snapshot: Snapshot.ref` |
| `[MODIFY]` | [`src/agents/pricing/pricing-agent.ts`](../../src/agents/pricing/pricing-agent.ts) | Export state schema, add `snapshotting` and `snapshot: Snapshot.ref` |
| `[MODIFY]` | [`src/agents/product/product-agent.ts`](../../src/agents/product/product-agent.ts) | Export state schema, add `snapshotting` and `snapshot: Snapshot.ref` |
| `[MODIFY]` | [`src/agents/shopping-recommendation/shopping-recommendation-definition.ts`](../../src/agents/shopping-recommendation/shopping-recommendation-definition.ts) | Export state schema and add `snapshotting` definition             |
| `[MODIFY]` | [`src/agents/shopping-recommendation/shopping-recommendation-agent.ts`](../../src/agents/shopping-recommendation/shopping-recommendation-agent.ts) | Add `snapshot: Snapshot.ref<ShoppingRecommendationAgentState>()` |

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
5. **Golem Component Build**:
   ```bash
   golem build --yes
   ```
   Ensures Rollup bundling and Wizer component pre-initialization validate all snapshot schemas and strategies.

---

## 5. Risks & Open Questions

- **Risk**: State schemas containing non-serializable fields (e.g. functions, promises).
  - **Mitigation**: All agent state fields are validated against strict Effect Schemas (`Schema.String`, `Schema.Array`, `Schema.DateTimeUtcFromString`, `Schema.NullOr`, etc.) which encode and decode cleanly to/from standard JSON envelopes.
