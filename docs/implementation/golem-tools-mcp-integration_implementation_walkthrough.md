# Feature Implementation Walkthrough: Categorized Golem Tools Definition, MCP Export & Multi-Agent Reuse

- **Feature ID / Slug**: `golem-tools-mcp-integration`
- **Date**: 2026-11-07
- **Status**: Ready for Review <!-- Ready for Review | Approved -->

---

## 1. Executive Summary

This implementation delivers categorized native Golem Tool definitions (`Tool.toolDefinition` from `@golemcloud/effect-golem`), wires them into `golem.yaml` for Model Context Protocol (MCP) exports across two specialized subdomains (`shop-mcp` and `admin-mcp`), and connects both internal `@earendil-works/pi-agent-core` agents (`ManagerAgent` and `ShoppingAssistantAgent`) to reuse these tools directly via a unified adapter (`golemToolToPiAgentTools`).

There is **only one single definition for every tool** — all commands are defined as Golem Tools in `src/tools/`. Redundant parallel tool definitions have been completely removed. Both the Manager and Shopping Assistant agents derive their Pi Agent tools dynamically from the Golem Tool definitions, with automatic parameter binding (e.g. injecting `user-id` from ambient session context).

All automated checks passed: Prettier formatting (100%), TypeScript typecheck (0 errors), ESLint (0 errors), automated test suite (63/63 tests passing across 8 suites), and Golem WASM build & pre-initialization (`golem build --yes` succeeded).

---

## 2. Changes Implemented

### File Modifications

| Action     | File Path                                                                                                                 | Summary of Changes                                                                                                                                                 |
| :--------- | :------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[NEW]`    | [`src/tools/catalog-tools.ts`](../../src/tools/catalog-tools.ts)                 | Implemented Golem `catalogTools` (`search-products`, `get-product-details`) with `handlers`. No redundant duplicates.                                              |
| `[NEW]`    | [`src/tools/inventory-tools.ts`](../../src/tools/inventory-tools.ts)             | Implemented Golem `inventoryTools` (`check-inventory`) with `handlers`. No redundant duplicates.                                                                   |
| `[NEW]`    | [`src/tools/cart-tools.ts`](../../src/tools/cart-tools.ts)                       | Implemented Golem `cartTools` (`get-cart`, `add-to-cart`, etc.) with `handlers`. No redundant duplicates.                                                           |
| `[NEW]`    | [`src/tools/customer-order-tools.ts`](../../src/tools/customer-order-tools.ts)         | Implemented Golem `customerOrderTools` (`get-order-history`, `get-order-details`) with `handlers`.                                                                 |
| `[NEW]`    | [`src/tools/manager-order-tools.ts`](../../src/tools/manager-order-tools.ts)           | Implemented Golem `managerOrderTools` (`search-orders`, `list-recent-orders`, `get-order-details`, `ship-order`, `cancel-order`) with `handlers`.                  |
| `[NEW]`    | [`src/tools/index.ts`](../../src/tools/index.ts)                                 | Barrel export for all 5 categorized Golem tool definitions and handlers.                                                                                           |
| `[MODIFY]` | [`src/ai/pi-tools.ts`](../../src/ai/pi-tools.ts)                                     | Added `golemToolToPiAgentTools` adapter that dynamically derives `AgentTool`s from Golem `ToolDefinition`s, mapping schemas, parameter binding, and execution.   |
| `[MODIFY]` | [`src/agents/manager/manager-tools.ts`](../../src/agents/manager/manager-tools.ts)                     | `getManagerPiTools` dynamically derives catalog, inventory, and manager order tools from `catalogTools`, `inventoryTools`, and `managerOrderTools`.               |
| `[MODIFY]` | [`src/agents/shopping-assistant/shopping-assistant-tools.ts`](../../src/agents/shopping-assistant/shopping-assistant-tools.ts) | `getShoppingAssistantPiTools` dynamically derives catalog, inventory, cart, and order tools from Golem tools, binding `user-id` from session context.            |
| `[MODIFY]` | [`src/main.ts`](../../src/main.ts)                                                 | Registered all 5 Golem tools for runtime export.                                                                                                                  |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                                   | Configured `tools:`, `components.tools`, and `mcp.deployments.local` (`shop-mcp` and `admin-mcp`).                                                                    |
| `[MODIFY]` | [`test/golem-tools.test.ts`](../../test/golem-tools.test.ts)                           | Added tests verifying `golemToolToPiAgentTools` parameter binding, schema projection, and execution.                                                              |

---

### Key Logic & API Changes

#### 1. Single Tool Definition via `Tool.toolDefinition`
Every tool has only **one** definition:
- Defined using `@golemcloud/effect-golem`'s `Tool.toolDefinition(name).command(...).implement(handlers, Layer.empty)`.
- No separate or duplicate `createToolFromAgentMethod` definitions.

#### 2. Dynamic Golem-to-Pi Adapter (`golemToolToPiAgentTools`)
The adapter in [`src/ai/pi-tools.ts`](../../src/ai/pi-tools.ts):
- Iterates over `tool.definition.model.children`.
- Maps command names to LLM tool names (e.g. `search-products` -> `search_products`).
- Derives JSON Schema from `cmd.body.fields`.
- If an argument is bound (e.g. `bind: { "user-id": userId }`), it strips the argument from the LLM parameters so the model is not burdened with supplying it, and injects it at execution time.
- Executes `handlers[camelCase(cmdName)](input)` inside an Effect fiber with full context propagation.

#### 3. Categorized Tool Groups
- **`catalog-tools`**: `search-products`, `get-product-details`
- **`inventory-tools`**: `check-inventory`
- **`cart-tools`**: `get-cart`, `add-to-cart`, `update-cart-quantity`, `remove-from-cart`, `clear-cart` (explicit `user-id` for MCP, context-bound for assistant)
- **`customer-order-tools`**: `get-order-history` (scoped by `user-id`), `get-order-details`
- **`manager-order-tools`**: `search-orders`, `list-recent-orders`, `get-order-details`, `ship-order`, `cancel-order`

#### 4. Local MCP Server Deployments (`golem.yaml`)
- **`shop-mcp`** (`http://shop-mcp.localhost:9007/mcp`):
  - `catalog-tools`, `inventory-tools`, `cart-tools`, `customer-order-tools`
- **`admin-mcp`** (`http://admin-mcp.localhost:9007/mcp`):
  - `catalog-tools`, `inventory-tools`, `manager-order-tools`

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
Done! Input: 22600.4 KB, Output: 83756.9 KB
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
▶ Categorized Store Tools & Multi-Agent Reuse (7 passed)
▶ Inventory Schema & Business Logic (3 passed)
▶ Manager Tools & AI Tool Generation (2 passed)
▶ OrderQueryMatcher (7 passed)
▶ Pi Agent & Stream Tests (7 passed)
▶ ProductQueryMatcher (6 passed)
▶ Shopping Recommendation (4 passed)
▶ Tool Generator (11 passed)

ℹ tests 63
ℹ suites 8
ℹ pass 63
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

---

## 4. Verification & Usage Guide

### 4.1 Running the Golem Dev Server & Deploying
```bash
# In terminal 1:
golem server run

# In terminal 2:
golem deploy --yes
```

### 4.2 Connecting MCP Clients
- **Customer Shopping Assistant MCP**:
  - Endpoint: `http://shop-mcp.localhost:9007/mcp`
  - Tools: `search-products`, `get-product-details`, `check-inventory`, `get-cart`, `add-to-cart`, `update-cart-quantity`, `remove-from-cart`, `clear-cart`, `get-order-history`, `get-order-details`.

- **Store Manager / Admin MCP**:
  - Endpoint: `http://admin-mcp.localhost:9007/mcp`
  - Tools: `search-products`, `get-product-details`, `check-inventory`, `search-orders`, `list-recent-orders`, `get-order-details`, `ship-order`, `cancel-order`.
