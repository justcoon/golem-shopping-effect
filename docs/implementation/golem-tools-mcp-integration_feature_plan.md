# Feature Plan: Categorized Golem Tools Definition, MCP Export & Multi-Agent Reuse

- **Feature ID / Slug**: `golem-tools-mcp-integration`
- **Date**: 2026-11-07
- **Status**: Completed <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Currently, the application defines agent-to-tool mappings using a custom generator (`src/ai/tool-generator.ts`) specifically for internal `@earendil-works/pi-agent-core` agents (`ShoppingAssistantAgent` and `ManagerAgent`). However, these tools were not natively known to Golem and could not be directly exported to external AI clients (e.g., Claude Desktop, Cursor, external agent harnesses) via the Model Context Protocol (MCP).

This feature introduces **native Golem Tool definitions** (`Tool.toolDefinition`) categorized by domain, wires them into `golem.yaml` for **local MCP deployments** (`shop-mcp` and `admin-mcp`), and establishes a foundation so that **internal Pi agents (`ManagerAgent` and `ShoppingAssistantAgent`) can reuse these categorized tools**.

### Goals

1. **Categorized Native Golem Tools**: Define modular Golem tools using `Tool.toolDefinition` from `@golemcloud/effect-golem` across 5 distinct categories:
   - **`catalog-tools`**: `search-products`, `get-product-details`
   - **`inventory-tools`**: `check-inventory`
   - **`cart-tools`**: `get-cart`, `add-to-cart`, `update-cart-quantity`, `remove-from-cart`, `clear-cart` (with explicit `user-id` parameter for now)
   - **`customer-order-tools`**: `get-order-history` (by customer `user-id`), `get-order-details`
   - **`manager-order-tools`**: `search-orders`, `list-recent-orders`, `get-order-details`, `ship-order`, `cancel-order`
2. **MCP Export**: Expose these tools via `golem.yaml` under `mcp.deployments.local.tools` with `include` selections:
   - `shop-mcp` (subdomain `shop-mcp`, port `9007`): exports `catalog-tools`, `inventory-tools`, `cart-tools`, and `customer-order-tools`.
   - `admin-mcp` (subdomain `admin-mcp`, port `9007`): exports `catalog-tools`, `inventory-tools`, and `manager-order-tools`.
3. **Multi-Agent Reuse**:
   - Enable `createPiAgentTools` / `createToolFromAgentMethod` to seamlessly derive Pi Agent tools from both agent definitions and categorized store tools.
4. **Quality Assurance**: Maintain 100% test pass rate across unit/integration tests (62 passing tests), typechecks (`tsc --noEmit`), formatting (`prettier`), linting (`eslint`), and full `golem build` compilation to WebAssembly.

### Non-Goals

- Implementing OAuth/OIDC authentication on the MCP endpoint (this phase focuses on functional tool export with explicit `userId`; security schemes and token-based `Middleware.typed` can be added in a subsequent phase).
- Modifying underlying agent durable logic (`CartAgent`, `OrderAgent`, `ProductSearchAgent`).

---

## 2. Architecture & Technical Design

### Tool Architecture

```text
                               ┌────────────────────────────────────────────────────────┐
                               │               Underlying Golem Agents                  │
                               │   (CartAgent, OrderAgent, ProductSearchAgent, ...)     │
                               └────────────────────────────────────────────────────────┘
                                                           ▲
                                                           │ (Direct Effect RPC Calls)
                               ┌────────────────────────────────────────────────────────┐
                               │           Categorized Golem Tool Definitions           │
                               │                    (`src/tools/`)                      │
                               │  - catalog-tools        - customer-order-tools         │
                               │  - inventory-tools      - manager-order-tools          │
                               │  - cart-tools                                          │
                               └────────────────────────────────────────────────────────┘
                                        │                                   │
                       (Exported via golem.yaml)               (Adapted for Pi Agent Core)
                                        │                                   │
                                        ▼                                   ▼
                       ┌──────────────────────────────────┐        ┌──────────────────────────────────┐
                       │    Golem MCP Deployments (9007)  │        │   Pi Agent Tools (`AgentTool`)   │
                       │  - `shop-mcp.localhost:9007`     │        │                                  │
                       │  - `admin-mcp.localhost:9007`    │        │  - Manager: admin & catalog tools│
                       │  (Claude Desktop, Cursor, etc.)  │        │  - Assistant: shop tools + cart  │
                       └──────────────────────────────────┘        └──────────────────────────────────┘
```

### Key Design Decisions

1. **Categorized Tool Organization**:
   - Split tools into fine-grained domain categories (`catalog-tools`, `inventory-tools`, `cart-tools`, `customer-order-tools`, `manager-order-tools`) rather than a single monolithic tool definition.
   - Separate order tools into **customer-specific** (requires customer `user-id`) and **manager-specific** (global multi-order query and fulfillment actions).
2. **Explicit `user-id` on Cart Tools**:
   - Public cart commands accept `user-id` explicitly (`user-id` option in Golem tool, mapped to camelCase `userId`).
   - This facilitates direct MCP client usage and testing without requiring token-derived context headers.
3. **Two Distinct MCP Subdomains**:
   - `shop-mcp`: Public customer shopping surface (`catalog-tools`, `inventory-tools`, `cart-tools`, `customer-order-tools`).
   - `admin-mcp`: Back-office management surface (`catalog-tools`, `inventory-tools`, `manager-order-tools`).

---

## 3. Implemented Changes & File Impact

| Action     | File Path                                       | Description                                                                                         |
| :--------- | :---------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `[NEW]`    | `src/tools/catalog-tools.ts`                    | Native Golem `catalog-tools` (`search-products`, `get-product-details`).                            |
| `[NEW]`    | `src/tools/inventory-tools.ts`                  | Native Golem `inventory-tools` (`check-inventory`).                                                 |
| `[NEW]`    | `src/tools/cart-tools.ts`                       | Native Golem `cart-tools` (`get-cart`, `add-to-cart`, `update-cart-quantity`, etc.).                |
| `[NEW]`    | `src/tools/customer-order-tools.ts`             | Native Golem `customer-order-tools` (`get-order-history`, `get-order-details`).                     |
| `[NEW]`    | `src/tools/manager-order-tools.ts`              | Native Golem `manager-order-tools` (`search-orders`, `list-recent-orders`, `ship-order`, etc.).      |
| `[NEW]`    | `src/tools/index.ts`                            | Barrel export for all categorized tool definitions.                                                 |
| `[MODIFY]` | `src/main.ts`                                   | Side-effect registration and re-export of all 5 tool definitions.                                   |
| `[MODIFY]` | `golem.yaml`                                    | Configured `tools:`, `components.tools`, and `mcp.deployments.local` (`shop-mcp` and `admin-mcp`). |
| `[MODIFY]` | `src/agents/order/order-schema.ts`              | Cleaned import of `InsufficientInventoryError` to avoid circular WASM import in Node test runner.   |
| `[NEW]`    | `test/golem-tools.test.ts`                      | Comprehensive unit tests covering tool derivation, validation, and multi-agent Pi conversion.       |

---

## 4. Verification Results

- **Unit & Integration Tests**: `npm test` -> 62 tests across 8 suites passing (100%).
- **Type Checking**: `npm run typecheck` (`tsc --noEmit`) -> 0 errors.
- **Formatting**: `npm run format:check` -> All files matched Prettier code style.
- **Linting**: `npm run lint` (`eslint src/ test/`) -> 0 errors.
- **Golem Build**: `golem build --yes` -> WASM bundle bundled with Rollup, pre-initialized with Wizer, completed successfully with `Finished building [OK]`.
