# Feature Plan: Effect TS Best Practices & Idiomatic Improvements (Item 2)

## Motivation & Context
Review recommendation **2** focuses on idiomatic Effect TS best practices and performance improvements across the application:
1. **2.1 Replace Custom `arrayChunks` with Native `Array.chunksOf`**:
   - `src/common/models.ts` defines a manual imperative `arrayChunks<T>` function.
   - Effect's `Array` module provides `Array.chunksOf(chunkSize)` natively. We will update `arrayChunks` or callers across `src/agents/product-search/product-search-agent.ts`, `src/agents/order-search/order-search-agent.ts`, `src/agents/cart/cart-agent.ts`, and `src/agents/shopping-recommendation/shopping-recommendation-logic.ts`.
2. **2.2 Impure `new Date()` vs. Effect `DateTime`**:
   - `shopping-assistant-agent.ts` and `manager-agent.ts` call impure `new Date().toISOString()`, executing side effects outside Effect pipelines.
   - We will introduce `getCurrentDatetimeIso: Effect.Effect<string>` (or use `DateTime.now.pipe(Effect.map(DateTime.formatIso))`) to keep time operations pure, deterministic, and idiomatic within Effect generators.
3. **2.3 Concurrent Fan-Out over Item Operations**:
   - In `order-agent.ts` (`cancelOrder`, `shipOrder`) and `cart-agent.ts` (`confirmCheckout`, `cancelCheckout`, and `refreshItemsInCart`), operations over lists of items run in sequential `for` loops.
   - We will replace sequential loops with `Effect.forEach(..., { concurrency: "unbounded" })` to execute independent Golem host calls concurrently with structured concurrency.

---

## User Review Required

> [!IMPORTANT]
> - `arrayChunks` will be powered by `Array.chunksOf` from `effect`. Callers can continue to call `arrayChunks(array, size)` or use `Array.chunksOf(array, size)` cleanly.
> - `new Date().toISOString()` in `ShoppingAssistantAgent` and `ManagerAgent` will be replaced with `yield* getCurrentDatetimeIso`, which formats ISO-8601 timestamps using Effect's `DateTime`.
> - Item-level operations (inventory fulfill/release reservations and cart product/price refreshes) will run concurrently using `Effect.forEach(..., { concurrency: "unbounded" })`.
> - Sequential validation checks that intentionally fail-fast (e.g. `reserveQuantity` during checkout preparation) will be preserved as sequential or handled with fail-fast semantics.

---

## Proposed Changes

### 1. `src/common/models.ts` & `src/common/index.ts`
- Implement `arrayChunks` using `Array.chunksOf(array, chunkSize)` from `"effect"`:
  ```typescript
  import { Array, DateTime, Effect, Schema } from "effect";

  export const arrayChunks = <T>(array: readonly T[], chunkSize: number): T[][] =>
    Array.chunksOf(array, chunkSize);
  ```
- Export `getCurrentDatetimeIso`:
  ```typescript
  export const getCurrentDatetimeIso: Effect.Effect<string> = DateTime.now.pipe(
    Effect.map(DateTime.formatIso),
  );
  ```

### 2. `src/agents/shopping-assistant/shopping-assistant-agent.ts` & `src/agents/manager/manager-agent.ts`
- Replace all 4 occurrences of `const now = new Date().toISOString();` with `const now = yield* getCurrentDatetimeIso;`.

### 3. `src/agents/order/order-agent.ts`
- In `cancelOrder`: replace sequential `for (const item of current.items)` releasing reservations with:
  ```typescript
  yield* Effect.forEach(
    current.items,
    (item) =>
      Effect.gen(function* () {
        const invClient = yield* InventoryAgent.client
          .get({ id: item.productId })
          .pipe(Effect.orDie);
        yield* invClient.releaseReservation
          .trigger({ orderId: current.orderId })
          .pipe(Effect.ignore);
      }),
    { concurrency: "unbounded" },
  );
  ```
- In `shipOrder`: replace sequential `for (const item of current.items)` fulfilling reservations with `Effect.forEach(..., { concurrency: "unbounded" })`.

### 4. `src/agents/cart/cart-agent.ts`
- In `confirmCheckout`: replace sequential reservation fulfillment loop with `Effect.forEach(..., { concurrency: "unbounded" })`.
- In `cancelCheckout`: replace sequential reservation release loop with `Effect.forEach(..., { concurrency: "unbounded" })`.
- In cart price & detail refresh (`getOrCreateCart` / `refreshCart`): replace sequential product & pricing fetch with:
  ```typescript
  const refreshedItems = yield* Effect.forEach(
    activeCart.items,
    (item) =>
      Effect.gen(function* () {
        const productClient = yield* ProductAgent.client
          .get({ id: item.productId })
          .pipe(Effect.orDie);
        const product = yield* productClient.get({}).pipe(Effect.orDie);
        const pricingClient = yield* PricingAgent.client
          .get({ id: item.productId })
          .pipe(Effect.orDie);
        const pricing = yield* pricingClient
          .getPrice({
            currency: activeCart.currency,
            region: PRICING_REGION_DEFAULT,
          })
          .pipe(Effect.orDie);

        const currentPrice = pricing ? pricing.price : item.price;
        return {
          productId: item.productId,
          productName: product ? product.name : item.productName,
          productBrand: product ? product.brand : item.productBrand,
          price: currentPrice,
          quantity: item.quantity,
        };
      }),
    { concurrency: "unbounded" },
  );
  ```

---

## Verification Plan

### Automated Tests
1. `npm run format:check` / `npm run format`
2. `npx tsc --noEmit`
3. `npm run lint`
4. `npm test` (all 70 tests across 8 suites)
5. `/Users/coon/opt/golem/bin/golem build --yes`
