# Feature Implementation Walkthrough: Two-Phase Prepare/Confirm Checkout & Inventory Reservation

- **Feature ID / Slug**: `prepare_confirm_checkout`
- **Date**: 2026-11-06
- **Status**: Ready for Review

---

## 1. Executive Summary

This feature implements the two-phase checkout lifecycle (`prepare_checkout` $\to$ `confirm_checkout`) with temporary inventory hold and lazy expiration in the `@golemcloud/effect-golem` application, mirroring the architecture and semantics from `golem-shopping-rust`:
1. **Inventory Agent Reservation & Lazy Purge**: Added optional `expiresAt` (`Schema.DateTimeUtcFromString`) to `OrderAllocation` and `reserveQuantity`. Active available stock queries ignore expired allocations, and allocations are lazily purged on write operations.
2. **Cart Two-Phase Lifecycle & Modifiability Guard**: Added `prepareCheckout`, `confirmCheckout`, and `cancelCheckout` agent methods and REST endpoints with inline Effect implementations. When a draft is active, the cart is locked from modifications and prices/items are frozen in `get()`. Expired drafts are automatically released and purged. The redundant legacy `checkout` method was removed to align directly with `golem-shopping-rust`.
3. **Shopping Assistant AI Tools**: Replaced the direct `checkout_cart` tool with `prepare_checkout`, `confirm_checkout`, and `cancel_checkout`, updating the system prompt with explicit instructions on navigating the 2-step flow.
4. **Frontend Checkout & Cart UX**: Added checkout draft state, countdown timer with visual progress bar, hold notifications, and locked item controls in `CartView.vue` and `CheckoutView.vue`.
5. **Benchmark & Fixtures**: Updated `benchmark/src/main.rs` to split `create_and_checkout_cart` into `cart-prepare-checkout` and `cart-confirm-checkout`, updated payload models in `benchmark/src/domain.rs`, and updated inventory fixtures.

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path | Summary of Changes |
| :--------- | :-------- | :----------------- |
| `[MODIFY]` | [`src/common/models.ts`](../../src/common/models.ts) | Added `CHECKOUT_RESERVATION_TTL_SECONDS = 600` (10 minutes). |
| `[MODIFY]` | [`src/agents/inventory/inventory-schema.ts`](../../src/agents/inventory/inventory-schema.ts) | Added `expiresAt` to `OrderAllocation`, added `isAllocationExpired` and `purgeExpiredAllocations` helpers, updated `calculateAvailableQuantity`. |
| `[MODIFY]` | [`src/agents/inventory/inventory-agent.ts`](../../src/agents/inventory/inventory-agent.ts) | Updated `reserveQuantity` input schema and implementation to accept optional `expiresAt`, lazy purge on write, and filter expired allocations on availability check. |
| `[MODIFY]` | [`src/agents/cart/cart-schema.ts`](../../src/agents/cart/cart-schema.ts) | Added `CheckoutDraft`, `ActionNotAllowedError`, `PrepareCheckoutError`, `ConfirmCheckoutError`, added `draft` to `Cart` schema, removed unused `CheckoutError`. |
| `[MODIFY]` | [`src/agents/cart/cart-definition.ts`](../../src/agents/cart/cart-definition.ts) | Added `prepareCheckout`, `confirmCheckout`, and `cancelCheckout` method specifications and HTTP routes (`POST /checkout/prepare`, `POST /checkout/confirm`, `POST /checkout/cancel`), removed redundant `checkout` method. |
| `[MODIFY]` | [`src/agents/cart/cart-agent.ts`](../../src/agents/cart/cart-agent.ts) | Implemented draft creation, inventory pre-allocation, draft expiration check, cart locking, order creation, compensation on failure, with completely inline `prepareCheckout` and `confirmCheckout` handlers, and encapsulated `getOrCreateCart` inside `ensureModifiable`. |
| `[MODIFY]` | [`src/agents/order/order-agent.ts`](../../src/agents/order/order-agent.ts) | Supplied `expiresAt: undefined` to durable order inventory allocations to conform with updated schema. |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-tools.ts`](../../src/agents/shopping-assistant/shopping-assistant-tools.ts) | Registered `prepare_checkout`, `confirm_checkout`, and `cancel_checkout` tools. |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-loop.ts`](../../src/agents/shopping-assistant/shopping-assistant-loop.ts) | Updated system prompt instructions for two-phase checkout guidance. |
| `[MODIFY]` | [`frontend/src/api/services/cartService.ts`](../../frontend/src/api/services/cartService.ts) | Added `CheckoutDraft` interface, `prepareCheckout`, `confirmCheckout`, and `cancelCheckout` API methods. |
| `[MODIFY]` | [`frontend/src/stores/cartStore.ts`](../../frontend/src/stores/cartStore.ts) | Added `activeDraft`, `isCheckoutActive`, and actions `prepareCheckout`, `confirmCheckout`, `cancelCheckout`. |
| `[MODIFY]` | [`frontend/src/stores/assistantStore.ts`](../../frontend/src/stores/assistantStore.ts) | Added `prepare_checkout`, `confirm_checkout`, and `cancel_checkout` to `cartMutatingTools`. |
| `[MODIFY]` | [`frontend/src/views/CheckoutView.vue`](../../frontend/src/views/CheckoutView.vue) | Added 10-minute countdown timer with reservation hold banner and cancel/confirm controls. |
| `[MODIFY]` | [`frontend/src/views/CartView.vue`](../../frontend/src/views/CartView.vue) | Added active reservation notification banner and locked quantity modifications while in checkout. |
| `[MODIFY]` | [`benchmark/src/domain.rs`](../../benchmark/src/domain.rs) | Added `CheckoutDraft`, `CartWithDraft`, and `OrderConfirmation` structs. |
| `[MODIFY]` | [`benchmark/src/main.rs`](../../benchmark/src/main.rs) | Updated `create_and_checkout_cart` to execute `cart-prepare-checkout` then `cart-confirm-checkout`. |
| `[MODIFY]` | [`benchmark/fixtures/inventory.csv`](../../benchmark/fixtures/inventory.csv) | Increased initial stock from 10 to 100 per product. |
| `[NEW]`    | [`test/cart-checkout.test.ts`](../../test/cart-checkout.test.ts) | Added unit tests for reservation expiration, schema decoding, cart draft invariants, and tool generation. |

---

## 3. Verification & Validation Results

### 3.1 Code Formatting

Command executed:
```bash
npm run format:check
```

**Result**:
```text
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
> typecheck
> tsc --noEmit

(Clean exit, 0 errors)
```

### 3.3 Linter Verification

Command executed:
```bash
npm run lint
```

**Result**:
```text
> lint
> eslint src/ test/

✖ 2 problems (0 errors, 2 warnings)
```

### 3.4 Automated Test Suite Execution

Command executed:
```bash
npm test
```

**Result**:
```text
> test
> tsx --test "test/**/*.test.ts"

▶ Two-Phase Checkout: Inventory Reservation & Expiration
  ✔ determines allocation expiration correctly (3.583639ms)
  ✔ decodes CheckoutDraft correctly via Schema (5.538347ms)
  ✔ decodes Cart with active draft and validates structure (2.619896ms)
  ✔ validates PrepareCheckoutError and ConfirmCheckoutError union schemas (0.7366ms)
  ✔ enforces cart draft locking and expiration invariants (0.52383ms)
  ✔ derives prepare_checkout, confirm_checkout, and cancel_checkout assistant tools (0.966376ms)
✔ Two-Phase Checkout: Inventory Reservation & Expiration (16.333505ms)
...
ℹ tests 50
ℹ suites 7
ℹ pass 50
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1635.842493
```

### 3.5 Rust Benchmark Validation

Command executed:
```bash
cargo check --manifest-path benchmark/Cargo.toml
```

**Result**:
```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.19s
```

### 3.6 Golem Build

Command executed:
```bash
golem build --yes
```

**Result**:
```text
Building components
  Building golem-shopping-effect:effect-main
    Executing external command 'npx tsc ...'
    Executing external command 'npx --no rollup ...'
    Injecting JS module into QuickJS WASM agent_guest.wasm
    Pre-initializing JS component ...
Done! Input: 22199.1 KB, Output: 68314.7 KB
  Adding metadata to golem-shopping-effect:effect-main

Finished building [OK]
```

---

## 4. How to Run & Verify

1. **Build the Application**:
   ```bash
   golem build
   ```
2. **Run Tests**:
   ```bash
   npm test
   ```
3. **Deploy to Local Golem Server**:
   ```bash
   golem deploy
   ```
4. **Prepare Checkout via CLI**:
   ```bash
   golem agent invoke \
     --component golem-shopping-effect:effect-main \
     --agent CartAgent/{cartId} \
     prepareCheckout
   ```
5. **Confirm Checkout via CLI**:
   ```bash
   golem agent invoke \
     --component golem-shopping-effect:effect-main \
     --agent CartAgent/{cartId} \
     confirmCheckout '{"orderId": "<ORDER_ID_FROM_PREPARE>"}'
   ```
6. **Cancel Checkout via CLI**:
   ```bash
   golem agent invoke \
     --component golem-shopping-effect:effect-main \
     --agent CartAgent/{cartId} \
     cancelCheckout
   ```

---

## 5. Sign-off / Next Steps

- All requirements from the approved feature plan `docs/implementation/prepare_confirm_checkout_feature_plan.md` have been fulfilled.
- Ready for final user approval (Stage 5 Gate).

