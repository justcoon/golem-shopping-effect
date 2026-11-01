# Feature Plan: Universal Agent-Method Tool Generation for All Shopping Assistant Tools

## 1. Problem Statement & Motivation
In the previous step, we introduced `createToolFromAgentMethod` and successfully migrated 4 cart tools (`clearCartTool`, `setShippingAddressTool`, `setBillingAddressTool`, `setEmailTool`).
However, the remaining 11 tools (`searchProductsTool`, `getProductDetailsTool`, `getCartTool`, `addToCartTool`, `updateCartQuantityTool`, `removeFromCartTool`, `getSavedContactInfoTool`, `applySavedContactInfoTool`, `checkoutCartTool`, `getOrderHistoryTool`, `getOrderDetailsTool`) are still defined manually with boilerplate specifications in `shopping-assistant-tools.ts` and `shopping-assistant-tool-specs.ts`.

By applying the agent-method tool generator universally across all tools:
1. **Single Source of Truth**: The agent definitions (`CartAgentDefinition`, `OrderAgent`, `ProductSearchAgent`) declare the method parameters, return schemas, domain error schemas, and human/LLM documentation (`description`, `promptHint`).
2. **Support for Diverse Agent Topologies**:
   - Durable agents with caller context identity (`CartAgentDefinition` using `userId`).
   - Durable agents with argument-derived identity (`OrderAgent` using `args.orderId`).
   - Ephemeral agents (`ProductSearchAgent` using `newPhantom({})`).
3. **Preserving Typed Domain Errors**: All tools will leverage Effect 4's `Result` type (`Result.Success` and `Result.Failure`), enabling LLM agents to reliably inspect business failure tags and recovery paths.

---

## 2. Proposed Changes

### A. Generator Enhancements (`src/agents/shopping-assistant/shopping-assistant-tool-generator.ts`)
- **Support Ephemeral Agents (`newPhantom`)**:
  - Check if `agent.client.newPhantom` is available. If present, instantiate the ephemeral client via `agent.client.newPhantom({})` without requiring an agent ID.
- **Support Argument-Derived Target Agent ID (`resolveId`)**:
  - Update `resolveId` signature to `(ctx: ToolContext, args: any) => TIdInput`.
  - For `OrderAgent`, allows extracting `id: args.orderId`.
- **Support Parameter Extensions / Mappings (`extraParameters`, `mapInput`)**:
  - When an agent method's identity is parameterized at the agent level (e.g. `OrderAgent.get` has `input: {}` because `orderId` is the agent ID), allow `extraParameters: { orderId: Schema.String }` so the tool exposes `orderId` to the LLM.
  - Allow optional `mapInput: (args: any) => any` for tools where tool argument names differ from internal agent method names (e.g. `productId` -> `ids: productId`).
- **Support Custom Summarizers (`formatSummary`)**:
  - Retain ability to format clear, human-readable summaries for the chat UI (e.g. cart totals, checkout order ID, product count).

### B. Agent Method Annotations
- **`src/agents/order/order-agent.ts`**:
  - Annotate `OrderAgent.methods.get` with rich `description` and `promptHint` ("Retrieve complete order details including items, pricing, delivery status, and tracking").
- **`src/agents/product-search/product-search-agent.ts`**:
  - Annotate `searchWithPrices` and `getByIdsWithPrices` with `description`, `promptHint`, and field-level annotations (`query`, `currency`, `ids`).

### C. Shopping Assistant Tools Migration (`src/agents/shopping-assistant/shopping-assistant-tools.ts`)
- Replace the remaining manual `createAssistantTool` calls with `createToolFromAgentMethod`:
  1. `getCartTool` -> `createToolFromAgentMethod(CartAgentDefinition, "get", ...)`
  2. `addToCartTool` -> `createToolFromAgentMethod(CartAgentDefinition, "addItem", ...)`
  3. `updateCartQuantityTool` -> `createToolFromAgentMethod(CartAgentDefinition, "updateItemQuantity", ...)`
  4. `removeFromCartTool` -> `createToolFromAgentMethod(CartAgentDefinition, "removeItem", ...)`
  5. `getSavedContactInfoTool` -> `createToolFromAgentMethod(CartAgentDefinition, "getSavedContactInfo", ...)`
  6. `applySavedContactInfoTool` -> `createToolFromAgentMethod(CartAgentDefinition, "applySavedContactInfo", ...)`
  7. `checkoutCartTool` -> `createToolFromAgentMethod(CartAgentDefinition, "checkout", ...)`
  8. `getOrderHistoryTool` -> `createToolFromAgentMethod(CartAgentDefinition, "getOrderHistory", ...)`
  9. `getOrderDetailsTool` -> `createToolFromAgentMethod(OrderAgent, "get", ...)`
  10. `searchProductsTool` -> `createToolFromAgentMethod(ProductSearchAgent, "searchWithPrices", ...)`
  11. `getProductDetailsTool` -> `createToolFromAgentMethod(ProductSearchAgent, "getByIdsWithPrices", ...)`
- Clean up unused specs and redundant schema definitions in `shopping-assistant-tool-specs.ts`.

### D. Unit Tests (`test/tool-generator.test.ts`)
- Add test cases covering:
  - Ephemeral agent method tool execution (`newPhantom`).
  - Argument-derived agent ID resolution (e.g. `resolveId: (_ctx, args) => ({ id: args.orderId })`).
  - `extraParameters` and `mapInput` parameter transformations.

---

## 3. Verification Plan

1. **Prettier Formatter**: `npm run format:check` & `npm run format`
2. **ESLint**: `npm run lint`
3. **TypeScript Typecheck**: `npm run typecheck`
4. **Unit Tests**: `npm test`
5. **Golem WASM Build**: `golem build --yes` (with `BypassSandbox: true` as needed)
6. **Walkthrough Document**: `docs/implementation/all-tools-agent-method-generator_implementation_walkthrough.md`

---

## 4. User Review Required

> [!IMPORTANT]
> **Tool Naming & Signatures**:
> All existing tool names (`search_products`, `get_product_details`, `get_cart`, `add_to_cart`, `update_cart_quantity`, `remove_from_cart`, `clear_cart`, `get_saved_contact_info`, `apply_saved_contact_info`, `set_shipping_address`, `set_billing_address`, `set_email`, `checkout_cart`, `get_order_history`, `get_order_details`) and their input signatures will remain 100% backward-compatible with prompt definitions and LLM tool calling.

