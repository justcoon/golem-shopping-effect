# Feature Plan: Order Search Ephemeral Alignment and Read-Only Optimization (1.1 & 1.2)

- **Feature ID / Slug**: `order-search-and-cart-read-only-ephemeral`
- **Date**: 2026-11-16
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

This feature implements recommendations **1.1** and **1.2** from the architectural and code review:

1. **Item 1.1 (Read-Only Method Optimization)**:
   - In Golem durable agents, any method without `readOnly: true` records an operation entry into the durable log (oplog), requiring state transitions and disk persistence. Pure query methods that do not modify state must be marked `readOnly: true` to eliminate oplog serialization overhead and allow host-level caching.
   - We will mark `CartAgent.get` and `CartAgent.getSavedContactInfo` as `readOnly: true`.
   - We will mark `OrderSearchAgent` query methods (`searchOrders`, `getOrdersByUserId`, `getOrdersByStatus`, `getRecentOrders`) as `readOnly: true`.

2. **Item 1.2 (Search Agent Statelessness & Durability Alignment)**:
   - `OrderSearchAgent` currently specifies `mode: "durable"`, even though it holds zero mutable state in `init` and acts purely as an on-demand distributed query aggregator across `OrderAgent` instances.
   - Meanwhile, its counterpart `ProductSearchAgent` is configured with `mode: "ephemeral"`.
   - Furthermore, client tool callers (`customer-order-tools.ts` and `manager-order-tools.ts`) currently invoke `OrderSearchAgent.client.newPhantom({})`—an ephemeral phantom invocation on a durable agent.
   - We will align `OrderSearchAgent` to `mode: "ephemeral"` (matching `ProductSearchAgent`), implement `init: () => Effect.void`, and update tool callers (`customer-order-tools.ts` and `manager-order-tools.ts`) to properly unwrap `{ value }` from the ephemeral invocation response.

### Goals

- Mark all side-effect-free query methods in `CartAgentDefinition` and `OrderSearchAgent` with `readOnly: true`.
- Align `OrderSearchAgent` to `mode: "ephemeral"` to reflect its stateless query nature and match `ProductSearchAgent`.
- Update `customer-order-tools.ts` and `manager-order-tools.ts` to unwrap the ephemeral invocation result `.value`.
- Pass all automated validation checks: `npm run format:check`, `npm run typecheck`, `npm run lint`, `npm test`, and `golem build --yes`.

### Non-Goals

- Refactoring AI conversational loops or saga transactions (items 1.3, 1.4, etc.), which will be addressed in separate plans.

---

## 2. Architecture & Technical Design

### 2.1 Read-Only Annotation on Golem Methods

Under `@golemcloud/effect-golem`, setting `readOnly: true` on a `method({ ... })` flags the method for Golem runtime host optimization:
- Invocations are treated as idempotent reads that do not mutate the agent's durable state or append mutation records to the oplog.
- HTTP routes bound to read-only methods remain accessible as standard HTTP GET endpoints without triggering durable write barriers.

Applied to:
- `CartAgentDefinition.methods.get`: `{ ..., readOnly: true }`
- `CartAgentDefinition.methods.getSavedContactInfo`: `{ ..., readOnly: true }`
- `OrderSearchAgent.methods.searchOrders`: `{ ..., readOnly: true }`
- `OrderSearchAgent.methods.getOrdersByUserId`: `{ ..., readOnly: true }`
- `OrderSearchAgent.methods.getOrdersByStatus`: `{ ..., readOnly: true }`
- `OrderSearchAgent.methods.getRecentOrders`: `{ ..., readOnly: true }`

### 2.2 Ephemeral Search Agent Contract

In Golem Effect SDK:
- An ephemeral agent is declared with `mode: "ephemeral"` and `init: () => Effect.void`.
- Ephemeral clients are instantiated using `.newPhantom({})`.
- Calls to an ephemeral remote method return `Effect.Effect<EphemeralInvocationResult<T>, ...>`, where `EphemeralInvocationResult<T>` carries `{ readonly value: T, readonly metadata: ... }`.
- Tool handlers calling ephemeral clients must return `res.value` (as already implemented in `catalog-tools.ts` for `ProductSearchAgent`).

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                          | Description                                                                 |
| :--------- | :------------------------------------------------- | :-------------------------------------------------------------------------- |
| `[MODIFY]` | [`src/agents/cart/cart-definition.ts`](../../src/agents/cart/cart-definition.ts) | Add `readOnly: true` to `get` and `getSavedContactInfo` methods             |
| `[MODIFY]` | [`src/agents/order-search/order-search-agent.ts`](../../src/agents/order-search/order-search-agent.ts) | Change to `mode: "ephemeral"`, add `readOnly: true` to queries, update `init` |
| `[MODIFY]` | [`src/tools/customer-order-tools.ts`](../../src/tools/customer-order-tools.ts) | Unwrap `res.value` from `getOrdersByUserId` ephemeral client call            |
| `[MODIFY]` | [`src/tools/manager-order-tools.ts`](../../src/tools/manager-order-tools.ts) | Unwrap `res.value` from `searchOrders` and `getRecentOrders` ephemeral calls |

### Detailed Changes

#### 1. `src/agents/cart/cart-definition.ts`
- In `methods.get`: add `readOnly: true`.
- In `methods.getSavedContactInfo`: add `readOnly: true`.

#### 2. `src/agents/order-search/order-search-agent.ts`
- Change `mode: "durable"` to `mode: "ephemeral"`.
- In `methods.searchOrders`: add `readOnly: true`.
- In `methods.getOrdersByUserId`: add `readOnly: true`.
- In `methods.getOrdersByStatus`: add `readOnly: true`.
- In `methods.getRecentOrders`: add `readOnly: true`.
- In `.implement(...)`:
  - `init: () => Effect.void`
  - `methods: () => ({ ... })`

#### 3. `src/tools/customer-order-tools.ts`
- In `customerOrderToolHandlers.getOrderHistory`:
  ```typescript
  const res = yield* client.getOrdersByUserId({ ... }).pipe(Effect.orDie);
  return res.value;
  ```

#### 4. `src/tools/manager-order-tools.ts`
- In `managerOrderToolHandlers.searchOrders`:
  ```typescript
  const res = yield* client.searchOrders({ ... }).pipe(Effect.orDie);
  return res.value;
  ```
- In `managerOrderToolHandlers.listRecentOrders`:
  ```typescript
  const res = yield* client.getRecentOrders({ ... }).pipe(Effect.orDie);
  return res.value;
  ```

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
   npm run build # golem build --yes
   ```

---

## 5. Risks & Open Questions

- **Risk**: External consumers or tests expecting bare array response from `OrderSearchAgent` client without unwrapping `res.value`.
  - **Mitigation**: Verified via repository-wide search that `customer-order-tools.ts` and `manager-order-tools.ts` are the only callers of `OrderSearchAgent.client`. Both will unwrap `.value`.
