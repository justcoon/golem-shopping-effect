# Feature Implementation Walkthrough: Inventory Reservation Sagas & Checkout Lifecycle Fix (Recommendation 1.4)

- **Feature ID / Slug**: `saga-transactions-rollback`
- **Date**: 2026-11-17
- **Status**: Ready for Review

---

## 1. Executive Summary

This feature resolves two core architectural problems across multi-agent order and checkout operations:
1. **Multi-Item Reservation Rollback via Saga**:
   Replaced brittle manual mutable array tracking (`const reservedProductIds: string[] = []` with nested `Effect.tapError` loops) in `CartAgent.prepareCheckout` and `OrderAgent.create` with an Effect-native `reserveItemsSaga` helper using `@golemcloud/effect-golem`'s `Saga` module (`Saga.fallibleTransaction`, `Saga.withFallibleCompensation`). When any product reservation fails midway (e.g. item $k$ out of stock), all previously acquired reservations ($1 \dots k-1$) are automatically rolled back in reverse order (LIFO).
2. **Checkout Lifecycle Alignment (`confirmCheckout`)**:
   Fixed a domain lifecycle bug in `CartAgent.confirmCheckout` by removing premature calls to `invClient.fulfillReservation`. In the e-commerce domain, inventory holds (`OrderAllocation`) remain reserved while an order is in `"new"` status; they are permanently deducted from physical stock upon shipment (`OrderAgent.shipOrder`), or released back to available inventory upon cancellation (`OrderAgent.cancelOrder`).

All formatting checks, typechecks (0 errors), linter checks (0 errors), 76/76 unit tests, and the `golem build --yes` WebAssembly compilation succeeded cleanly.

---

## 2. Changes Implemented

### File Modifications

| Action | File Path | Summary of Changes |
| :--- | :--- | :--- |
| `[NEW]` | [`src/agents/inventory/inventory-saga.ts`](../../src/agents/inventory/inventory-saga.ts) | Implemented `reserveItemsSaga` to atomically reserve multiple items inside `Saga.fallibleTransaction` with `Saga.withFallibleCompensation` releasing allocations on failure. |
| `[MODIFY]` | [`src/agents/inventory/index.ts`](../../src/agents/inventory/index.ts) | Re-exported `inventory-saga.ts`. |
| `[MODIFY]` | [`src/agents/cart/cart-agent.ts`](../../src/agents/cart/cart-agent.ts) | 1) Replaced manual reservation loop in `prepareCheckout` with `reserveItemsSaga`.<br>2) Removed premature `fulfillReservation` loop in `confirmCheckout`.<br>3) Cleaned up unused imports. |
| `[MODIFY]` | [`src/agents/order/order-agent.ts`](../../src/agents/order/order-agent.ts) | Replaced 42 lines of duplicate manual array tracking and error taps in `create` with `reserveItemsSaga`. |
| `[MODIFY]` | [`test/cart-checkout.test.ts`](../../test/cart-checkout.test.ts) | Added automated test suite for multi-item sequential reservation with reverse-order compensation unwind and inventory allocation lifecycle preservation. |
| `[MODIFY]` | [`web/assets/chat-common.js`](../../web/assets/chat-common.js) | Centralized `parseStreamEvents`, `createRunningToolCard`, `updateCompletedToolCard`, and `createCompletedToolCard` so stream event normalization and tool card rendering are shared. |
| `[MODIFY]` | [`web/assets/assistant.js`](../../web/assets/assistant.js) | Simplified to consume shared `parseStreamEvents` and tool card helpers from `chat-common.js`. |
| `[MODIFY]` | [`web/assets/manager.js`](../../web/assets/manager.js) | Simplified to consume shared `parseStreamEvents` and tool card helpers from `chat-common.js`. |
| `[NEW]` | [`test/chat-common.test.ts`](../../test/chat-common.test.ts) | Added unit tests validating `parseStreamEvents` across WIT variant arrays, tagged formats, kebab-case tags, and malformed inputs. |

---

## 3. Key Logic & API Changes

### 1. `reserveItemsSaga` (`src/agents/inventory/inventory-saga.ts`)
```typescript
export const reserveItemsSaga = ({
  orderId,
  region,
  items,
  expiresAt,
}: {
  readonly orderId: string;
  readonly region: string;
  readonly items: ReadonlyArray<ReservationItem>;
  readonly expiresAt?: DateTime.Utc;
}) =>
  Saga.fallibleTransaction(
    Effect.forEach(
      items,
      (item) =>
        Effect.gen(function* () {
          const invClient = yield* InventoryAgent.client
            .get({ id: item.productId })
            .pipe(Effect.orDie);

          yield* Saga.withFallibleCompensation(
            invClient
              .reserveQuantity({
                orderId,
                region,
                quantity: item.quantity,
                expiresAt,
              })
              .pipe(
                Effect.catchTag("inventory-not-found", (err) =>
                  Effect.fail({
                    _tag: "insufficient-inventory" as const,
                    message: err.message,
                    productId: item.productId,
                    region,
                    requested: item.quantity,
                    available: 0,
                  }),
                ),
                orDieRpc,
              ),
            () => invClient.releaseReservation.trigger({ orderId }).pipe(Effect.asVoid),
          );
        }),
      { discard: true },
    ),
  ).pipe(
    Effect.catchTag("NestedSagaError", (err) => Effect.die(err)),
    Effect.catchTag("FailedAndRolledBackCompletely", (failure) => {
      const err = failure.error as InsufficientInventoryError;
      return Effect.fail(err);
    }),
    Effect.catchTag("FailedAndRolledBackPartially", (failure) => {
      const err = failure.error as InsufficientInventoryError;
      return Effect.logWarning(
        `Reservation saga rolled back partially. Error: ${String(failure.compensationError)}`,
      ).pipe(Effect.andThen(Effect.fail(err)));
    }),
  );
```

### 2. Lifecycle Fix in `CartAgent.confirmCheckout`
Removed the loop:
```typescript
// REMOVED: Premature inventory deduction before shipping
yield* Effect.forEach(
  current.items,
  (item) => invClient.fulfillReservation.trigger({ orderId }),
  { concurrency: "unbounded" },
);
```
Confirmed orders in `"new"` status now preserve their `OrderAllocation` in `InventoryAgent` until:
- **`OrderAgent.shipOrder`**: Executes `fulfillReservation` to permanently deduct allocated items from warehouse `totalQuantity`.
- **`OrderAgent.cancelOrder`**: Executes `releaseReservation` to return held stock back to available inventory.

---

## 4. Verification & Validation Results

### 4.1 Code Formatting
Command executed:
```bash
npm run format:check
```
Result: All files match formatting standards.

### 4.2 Type Checking
Command executed:
```bash
npm run typecheck
```
Result:
```text
> typecheck
> tsc --noEmit

[0 errors]
```

### 4.3 Linter Verification
Command executed:
```bash
npm run lint
```
Result: Zero errors in `src/` and `test/`.

### 4.4 Automated Unit Tests
Command executed:
```bash
npm test
```
Result:
```text
✔ Two-Phase Checkout: Inventory Reservation & Expiration (22.42ms)
  ✔ determines allocation expiration correctly
  ✔ decodes CheckoutDraft correctly via Schema
  ✔ decodes Cart with active draft and validates structure
  ✔ validates PrepareCheckoutError and ConfirmCheckoutError union schemas
  ✔ enforces cart draft locking and expiration invariants
  ✔ derives prepare_checkout, confirm_checkout, and cancel_checkout assistant tools
  ✔ rolls back prior reservations in reverse order when a subsequent item fails
  ✔ preserves inventory allocation across confirmCheckout until shipment or cancellation
✔ parseStreamEvents normalizes Golem WIT variant array batches
✔ parseStreamEvents normalizes text_delta, tool_result, and done events
✔ parseStreamEvents handles tagged format and kebab-case keys
✔ parseStreamEvents handles empty or malformed input safely
...
ℹ tests 76
ℹ suites 8
ℹ pass 76
ℹ fail 0
```

### 4.5 Golem Build
Command executed:
```bash
golem build --yes
```
Result:
```text
Selected components and layers:
  golem-shopping-effect:effect-main: effect, effect[optimized], golem-shopping-effect:effect-main
Building components
  Building golem-shopping-effect:effect-main
  Executing external command 'npx tsc ...'
  Executing external command 'npx --no rollup ...'
  created golem-temp/ts-dist/golem-shopping-effect-effect-main/main.js in 12s
  Injecting JS module into QuickJS WASM agent_guest.wasm
  Pre-initializing JS component into golem_shopping_effect_effect_main.preinitialized.wasm
  Done! Input: 22616.8 KB, Output: 84239.9 KB

Finished building [OK]
```
