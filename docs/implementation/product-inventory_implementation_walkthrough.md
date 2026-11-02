# Implementation Walkthrough: Per-Product Regional Inventory Management

- **Feature ID**: `product-inventory`
- **Date**: 2026-11-02
- **Status**: Completed & Verified

---

## 1. Overview of Changes

We implemented a durable, region-aware inventory management system for the Golem Shopping application. Each product is backed by its own durable `InventoryAgent` that tracks total regional stock and order allocations. The shopping cart, order processing, and shopping assistant now validate and coordinate inventory reservations across all stages of the customer buying lifecycle.

```mermaid
flowchart TD
    subgraph InventoryAgent ["InventoryAgent (productId)"]
        TotalStock["Total Stock per Region\n(e.g., US: 50, EU: 30, global: 10)"]
        Allocations["Allocations per Order ID\n(order-1 -> 2, order-2 -> 4)"]
        AvailCalc["Available Stock = Total - Sum(Allocations)"]
        TotalStock --> AvailCalc
        Allocations --> AvailCalc
    end

    CartAgent["CartAgent (userId)"] -->|1. Soft Availability Check\n(prevent out-of-stock additions)| AvailCalc
    OrderAgent["OrderAgent (orderId)"] -->|2. Hard Reservation at Checkout\n& Adjust / Release / Fulfill| Allocations
```

---

## 2. Key Code Modifications

### 2.1 `InventoryAgent` & Schemas (`src/agents/inventory/`)
- [`inventory-schema.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/inventory/inventory-schema.ts):
  - Defined schemas: `InventoryItem`, `OrderAllocation`, `Inventory`, `Availability`, and `InsufficientInventoryError`.
  - Added helper `mergeInventoryItems` for merging regional updates.
- [`inventory-agent.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/inventory/inventory-agent.ts):
  - Created durable `InventoryAgent` mounted at `/v1/inventory/{id}`.
  - Implemented methods:
    - `initializeInventory`: Sets initial regional stock (`POST /`).
    - `updateInventory`: Merges new regional quantities with existing stock (`PUT /`).
    - `get`: Read-only method returning the full inventory state (`GET /`).
    - `getAvailableQuantity`: Read-only method calculating $Q_{available} = \max(0, Q_{total} - Q_{allocated})$ (`GET /availability?region={region}`).
    - `reserveQuantity`: Atomically creates or adjusts order allocations (Internal RPC only, no HTTP endpoint).
    - `releaseReservation`: Removes allocations for an order (Internal RPC only, no HTTP endpoint).
    - `fulfillReservation`: Deducts allocated quantities from regional totals and clears the order allocation (Internal RPC only, no HTTP endpoint).
  - Configured `InventoryAgent` in `golem.yaml` under `httpApi.deployments.local.agents`.

### 2.2 Cart Integration (`src/agents/cart/`)
- [`cart-schema.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/cart/cart-schema.ts):
  - Added `InsufficientStockError` to `AddItemError`, `UpdateItemQuantityError`, and `CheckoutError`.
- [`cart-agent.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/cart/cart-agent.ts):
  - In `addItem`, execution strictly follows the priority order:
    1. **Product Verification**: Checks `ProductAgent.get({ id })` and fails immediately with `product-not-found` if the product does not exist.
    2. **Pricing Verification**: Retrieves `PricingAgent.getPrice` for new items and fails with `pricing-not-found` if pricing is missing.
    3. **Inventory Verification**: Queries `InventoryAgent.getAvailableQuantity({ region: INVENTORY_REGION_DEFAULT })` and fails with `insufficient-stock` if requested quantity exceeds availability.
  - In `updateItemQuantity`, validates available inventory with `InventoryAgent`.
  - In `checkout`, maps `insufficient-inventory` failures from `OrderAgent.create` directly into typed `insufficient-stock` checkout errors.

### 2.3 Order Lifecycle & Post-Checkout Modifications (`src/agents/order/`)
- [`order-schema.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/order/order-schema.ts):
  - Integrated `InsufficientInventoryError` into `InitOrderError`, `AddItemError`, and `UpdateItemQuantityError`.
- [`order-agent.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/order/order-agent.ts):
  - **`addItem`**: Validates `ProductAgent` first, then validates `PricingAgent` for new items, and only performs the stateful `InventoryAgent.reserveQuantity` once both product and pricing are confirmed valid. This eliminates any need for compensating reservation cancellations when pricing is absent.
  - **`create`**: Atomically reserves stock in `InventoryAgent` for all line items using `INVENTORY_REGION_DEFAULT`. If any item reservation fails, rollback logic releases all already-reserved items for that order.
  - **`updateItemQuantity`**: Adjusts the existing reservation up or down using `INVENTORY_REGION_DEFAULT`.
  - **`removeItem`**: Releases the reservation for that product.
  - **`cancelOrder`**: Releases all reserved inventory for the order back to available stock.
  - **`shipOrder`**: Calls `fulfillReservation` on all items, permanently decrementing physical stock and clearing allocations.

### 2.4 Product Search & Shopping Assistant
- [`product-search-agent.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/product-search/product-search-agent.ts):
  - Enriched `ProductWithPrice` with `availableQuantity: Schema.optional(Schema.Number)` so search results expose real-time stock.
- [`shopping-assistant-tools.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-tools.ts):
  - Generated and registered `check_inventory` tool derived from `InventoryAgent.getAvailableQuantity`.

### 2.5 Seed Data, Import & Documentation
- [`data/fixtures/tech_inventory.csv`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/data/fixtures/tech_inventory.csv):
  - Initialized 10 units in the `"global"` region for all 26 catalog products.
- [`data/import.yaml`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/data/import.yaml) & [`data/README.md`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/data/README.md):
  - Added drill import step for `/v1/inventory/{{ item.productId }}` and documented sample data usage.
- [`architecture.puml`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/architecture.puml) & [`README.md`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/README.md):
  - Documented `InventoryAgent`, gateway route `/v1/inventory/**`, and agent-to-agent interactions.

---

## 3. Verification Results

All automated checks passed with zero errors:

| Check | Command | Result |
| :--- | :--- | :--- |
| **Formatting** | `npm run format:check` | PASSED (All files conform to Prettier) |
| **Type Checking** | `npm run typecheck` | PASSED (0 TypeScript errors) |
| **Linting** | `npm run lint` | PASSED (0 ESLint errors) |
| **Unit Tests** | `npm test` | PASSED (34 tests in 4 test suites passed) |
| **Golem Build** | `npm run build` | PASSED (`Finished building [OK]`, WASM component assembled and preinitialized) |

---

## 4. Usage Example

### Initializing Inventory (via HTTP REST)
```http
POST /v1/inventory/ap001
Content-Type: application/json

{
  "items": [
    { "region": "global", "totalQuantity": 10 },
    { "region": "us", "totalQuantity": 5 }
  ]
}
```

### Checking Availability
```http
GET /v1/inventory/ap001/availability?region=global
```
**Response**:
```json
{
  "productId": "ap001",
  "region": "global",
  "availableQuantity": 10,
  "totalQuantity": 10,
  "allocatedQuantity": 0
}
```

### Adding to Cart (Soft Stock Check)
```http
PUT /v1/cart/user-123/items/ap001
Content-Type: application/json

{ "quantity": 15 }
```
**Response (400 / Failure)**:
```json
{
  "_tag": "insufficient-stock",
  "message": "Insufficient stock for product ap001 in region global. Requested: 15, available: 10",
  "productId": "ap001",
  "region": "global",
  "requested": 15,
  "available": 10
}
```

## Error Handling Refactoring

All boilerplate type/tag checks of the form:
```typescript
if (err && typeof err === "object" && "_tag" in err && err._tag === "...")
```
have been completely eliminated.

Instead, idiomatic Effect combinators are used:
1. `Effect.catchTag("inventory-not-found", (err) => Effect.fail(...))`
2. `orDieRpc` helper in `src/common/models.ts` using `Effect.catchTags({ RpcCallError: Effect.die, ... })` to cleanly convert transport-level RPC failures into defects while preserving domain error types.
3. `Effect.catchTag("insufficient-inventory", ...)` followed by `Effect.catch((err) => ...)` in `CartAgent.checkout`.
4. Fire-and-forget `trigger` (`client.releaseReservation.trigger(...)` and `client.fulfillReservation.trigger(...)`) for asynchronous reservation release and fulfillment in order rollback, cancellation, item removal, and shipment.

## Verification Results

1. **TypeScript Typecheck**:
   `npm run typecheck` passed with 0 errors.
2. **Formatting**:
   `npm run format:check` passed with all files styled.
3. **Linting**:
   `npm run lint` passed with 0 errors.
4. **Unit Tests**:
   `npm test` passed: 34 tests passing across 4 test suites.
5. **Component Build**:
   `npm run build` (`golem build --yes`) succeeded (`Finished building [OK]`).


