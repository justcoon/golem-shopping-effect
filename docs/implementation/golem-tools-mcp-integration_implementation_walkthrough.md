# Feature Implementation Walkthrough: Categorized Golem Tools Definition, MCP Export & Multi-Agent Reuse

- **Feature ID / Slug**: `golem-tools-mcp-integration`
- **Date**: 2026-11-07
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

This implementation delivers categorized native Golem Tool definitions (`Tool.toolDefinition` from `@golemcloud/effect-golem`), wires them into `golem.yaml` for Model Context Protocol (MCP) exports across two specialized subdomains (`shop-mcp` and `admin-mcp`), and establishes a foundation for tool reuse between Golem MCP clients and internal `@earendil-works/pi-agent-core` agents (`ManagerAgent` and `ShoppingAssistantAgent`).

Public cart tools explicitly accept a `user-id` parameter, and order operations are split into customer-scoped tools (`customer-order-tools`) and back-office management tools (`manager-order-tools`).

All automated checks passed: Prettier formatting (100%), TypeScript typecheck (0 errors), ESLint (0 errors), automated test suite (62/62 tests passing across 8 suites), and Golem WASM build & pre-initialization (`golem build --yes` succeeded).

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                             | Summary of Changes                                                                                     |
| :--------- | :------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------- |
| `[NEW]`    | [`src/tools/catalog-tools.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/tools/catalog-tools.ts)         | Implemented `search-products` and `get-product-details` with RPC calls to `ProductSearchAgent`.        |
| `[NEW]`    | [`src/tools/inventory-tools.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/tools/inventory-tools.ts)     | Implemented `check-inventory` calling `InventoryAgent.client.get({ id: productId })`.                   |
| `[NEW]`    | [`src/tools/cart-tools.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/tools/cart-tools.ts)               | Implemented `get-cart`, `add-to-cart`, `update-cart-quantity`, `remove-from-cart`, and `clear-cart`.   |
| `[NEW]`    | [`src/tools/customer-order-tools.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/tools/customer-order-tools.ts) | Customer-facing order tools: `get-order-history` (by customer `user-id`) and `get-order-details`.     |
| `[NEW]`    | [`src/tools/manager-order-tools.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/tools/manager-order-tools.ts)   | Administrative order tools: `search-orders`, `list-recent-orders`, `get-order-details`, `ship-order`, `cancel-order`. |
| `[NEW]`    | [`src/tools/index.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/tools/index.ts)                         | Barrel export for all 5 categorized tool definitions.                                                 |
| `[MODIFY]` | [`src/main.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/main.ts)                                 | Side-effect registration and re-export of all 5 tool definitions.                                       |
| `[MODIFY]` | [`golem.yaml`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/golem.yaml)                                   | Manifest configuration for top-level `tools:`, `components.tools`, and `mcp.deployments.local`.        |
| `[MODIFY]` | [`src/agents/order/order-schema.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/order/order-schema.ts) | Cleaned `InsufficientInventoryError` import from schema directly, preventing WASM load errors in tests. |
| `[NEW]`    | [`test/golem-tools.test.ts`](file:///Users/coon/workspace-zv/git/golem-shopping-effect/test/golem-tools.test.ts)           | Unit and integration tests for categorized tool schemas and multi-agent Pi conversion.                  |

---

### Key Logic & API Changes

#### 1. Categorized Tool Organization
Rather than bundling all operations into a single tool, operations are grouped into 5 distinct categories:
- **`catalog-tools`**:
  - `search-products`: Query catalog with optional currency; unwraps ephemeral `ProductSearchAgent` phantom results.
  - `get-product-details`: Retrieve product details by ID list.
- **`inventory-tools`**:
  - `check-inventory`: Query stock levels, reserved quantities, and regional distribution by product ID.
- **`cart-tools`**:
  - Accepts explicit `user-id` option (mapped to camelCase `userId`).
  - Implements `get-cart`, `add-to-cart`, `update-cart-quantity`, `remove-from-cart`, and `clear-cart`.
- **`customer-order-tools`**:
  - `get-order-history`: Queries `OrderSearchAgent` filtering strictly by `user-id`.
  - `get-order-details`: Fetches full details for a given `order-id`.
- **`manager-order-tools`**:
  - `search-orders`: Multi-field search (status, customer, text, date range).
  - `list-recent-orders`: Returns latest placed orders.
  - `get-order-details`: Retrieves full order state.
  - `ship-order`: Transitions order to `Shipped` and confirms inventory fulfillment.
  - `cancel-order`: Transitions order to `Cancelled` and cancels inventory reservation.

#### 2. Local MCP Server Deployments (`golem.yaml`)
Configured under `mcp.deployments.local`:
- **`shop-mcp`**:
  - Domain: `http://shop-mcp.localhost:9007/mcp`
  - Includes: `catalog-tools`, `inventory-tools`, `cart-tools`, `customer-order-tools`
- **`admin-mcp`**:
  - Domain: `http://admin-mcp.localhost:9007/mcp`
  - Includes: `catalog-tools`, `inventory-tools`, `manager-order-tools`

---

## 3. Verification & Validation Results

### 3.1 Code Formatting
Command:
```bash
npm run format:check
```
**Result**:
```text
Checking formatting...
All matched files use Prettier code style!
```

### 3.2 Type Checking
Command:
```bash
npm run typecheck
```
**Result**:
```text
> typecheck
> tsc --noEmit
(zero errors, exit code 0)
```

### 3.3 Linter Verification
Command:
```bash
npm run lint
```
**Result**:
```text
> lint
> eslint src/ test/

✖ 11 problems (0 errors, 11 warnings)
(zero lint errors, exit code 0)
```

### 3.4 Golem Component Build
Command:
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
    Executing external command 'npx --no rollup ...'
    Injecting JS module into QuickJS WASM
    Pre-initializing JS component into golem_shopping_effect_effect_main.preinitialized.wasm
Writing pre-initialized component ...
Done! Input: 22603.5 KB, Output: 84161.5 KB
  Adding metadata to golem-shopping-effect:effect-main

Finished building [OK]
```

### 3.5 Automated Test Suite Execution
Command:
```bash
npm test
```
**Result**:
```text
▶ Two-Phase Checkout: Inventory Reservation & Expiration (6 passed)
▶ LLM Error Formatting (7 passed)
▶ Categorized Store Tools & Multi-Agent Reuse (6 passed)
▶ Inventory Schema & Business Logic (3 passed)
▶ Manager Tools & AI Tool Generation (2 passed)
▶ OrderQueryMatcher (7 passed)
▶ Pi Agent & Stream Tests (7 passed)
▶ ProductQueryMatcher (6 passed)
▶ Shopping Recommendation (4 passed)
▶ Tool Generator (11 passed)

ℹ tests 62
ℹ suites 8
ℹ pass 62
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

---

## 4. Verification & Usage Guide

### 4.1 Running the Golem Dev Server & Deploying
Start the local Golem development server and deploy the updated application:
```bash
# In terminal 1:
golem server run

# In terminal 2:
golem deploy --yes
```

### 4.2 Connecting MCP Clients
Once deployed, external MCP-compatible AI harnesses (Claude Desktop, Cursor, MCP Inspector) can connect to the local endpoints:

1. **Customer Shopping Assistant MCP**:
   - Endpoint: `http://shop-mcp.localhost:9007/mcp`
   - Available tools: `search-products`, `get-product-details`, `check-inventory`, `get-cart`, `add-to-cart`, `update-cart-quantity`, `remove-from-cart`, `clear-cart`, `get-order-history`, `get-order-details`.

2. **Store Manager / Admin MCP**:
   - Endpoint: `http://admin-mcp.localhost:9007/mcp`
   - Available tools: `search-products`, `get-product-details`, `check-inventory`, `search-orders`, `list-recent-orders`, `get-order-details`, `ship-order`, `cancel-order`.

3. **Testing with MCP Inspector**:
   ```bash
   npx @modelcontextprotocol/inspector http://shop-mcp.localhost:9007/mcp
   ```

