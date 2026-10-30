# Implementation Walkthrough: Shopping Assistant Full Experience with Domain Agent Tools & Streaming

- **Feature ID / Slug**: `shopping-assistant-full-experience`
- **Date**: 2026-10-30
- **Status**: Completed

---

## 1. Summary of Changes

We have upgraded the `ShoppingAssistantAgent` from a simple static recommendation generator into a conversational personal shopping assistant with **real-time streaming**, **autonomous tool execution**, and **frictionless checkout**.

Following a domain-driven approach, all new business operations were implemented as first-class methods on the underlying domain agents (`CartAgent`, `ProductSearchAgent`), and then bound 1:1 to the shopping assistant's tool suite.

---

### Component-by-Component Changes

#### 1. `CartAgent` (`src/agents/cart/`)
- **New Schema `SavedContactInfo`** ([cart-schema.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/cart/cart-schema.ts)):
  ```typescript
  export const SavedContactInfo = Schema.Struct({
    shippingAddress: Schema.NullOr(Address),
    billingAddress: Schema.NullOr(Address),
    email: Schema.NullOr(Schema.String),
    sourceOrderId: Schema.NullOr(Schema.String),
  });
  ```
- **New Methods in `CartAgentDefinition` & `CartAgent`**:
  - `getSavedContactInfo` (`GET /v1/cart/{id}/saved-contact`): Reads latest order shipping/billing addresses and email without modifying cart state.
  - `applySavedContactInfo` (`POST /v1/cart/{id}/use-saved-contact`): Copies the saved contact details from the previous order to the active cart in a single step.
  - `getOrderHistory` (`GET /v1/cart/{id}/orders?limit={limit}`): Retrieves user past orders in concurrent chunks (most recent first, with optional `limit` parameter).

#### 2. `ProductSearchAgent` (`src/agents/product-search/`)
- **New Schema `ProductWithPrice`** ([product-search-agent.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/product-search/product-search-agent.ts)):
  ```typescript
  export const ProductWithPrice = Schema.Struct({
    productId: Schema.String,
    name: Schema.String,
    brand: Schema.String,
    description: Schema.String,
    tags: Schema.Array(Schema.String),
    price: Schema.NullOr(PricingItem),
    createdAt: Datetime.Datetime,
    updatedAt: Datetime.Datetime,
  });
  ```
- **New Methods in `ProductSearchAgent`**:
  - `searchWithPrices` (`GET /v1/product/search-with-prices?query={query}&currency={currency}`): Dispatches query matching across catalog products and parallel-resolves active item pricing from `PricingAgent` via `pricingClient.getPrice` with optional currency fallback to `CURRENCY = "USD"` and `PRICING_REGION_DEFAULT = "global"`.
  - `getByIdsWithPrices` (`GET /v1/product/with-prices?ids={ids}&currency={currency}`): Resolves specific product IDs with active item pricing attached via `pricingClient.getPrice` (powers both multi-item and single-item `get_product_details`).

#### 3. Shopping Assistant Suite (`src/agents/shopping-assistant/`)
- **Schemas** ([shopping-assistant-schema.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-schema.ts)):
  - `ChatRole`, `ToolCallRecord`, `ChatMessage` (with durable message history).
  - `ChatChunkType` (`tool_start`, `tool_result`, `text_delta`, `done`, `error`), `ChatChunk`.
  - `ChatRequest`, `ChatResponse`.
- **Tools Suite** ([shopping-assistant-tools.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-tools.ts)):
  - `search_products`: Calls `ProductSearchAgent.client.newPhantom({}).searchWithPrices`.
  - `get_product_details`: Calls `ProductSearchAgent.client.newPhantom({}).getByIdsWithPrices`.
  - `get_cart`: Calls `CartAgent.get`.
  - `add_to_cart`: Calls `CartAgent.addItem`.
  - `update_cart_quantity`: Calls `CartAgent.updateItemQuantity`.
  - `remove_from_cart`: Calls `CartAgent.removeItem`.
  - `clear_cart`: Calls `CartAgent.clear`.
  - `get_saved_contact_info`: Calls `CartAgent.getSavedContactInfo`.
  - `apply_saved_contact_info`: Calls `CartAgent.applySavedContactInfo`.
  - `set_shipping_address`: Calls `CartAgent.updateShippingAddress`.
  - `set_billing_address`: Calls `CartAgent.updateBillingAddress`.
  - `set_email`: Calls `CartAgent.updateEmail`.
  - `checkout_cart`: Calls `CartAgent.checkout`.
  - `get_order_history`: Calls `CartAgent.getOrderHistory`.
  - `get_order_details`: Calls `OrderAgent.get`.
- **Streaming Tool Loop** ([shopping-assistant-loop.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-loop.ts)):
  - Communicates with OpenRouter / OpenAI compatible chat completion endpoints over `FetchHttpClient`.
  - Multi-step tool loop capped at 5 turns per user prompt.
  - Emits real-time event chunks (`tool_start`, `tool_result`, `text_delta`, `done`).
- **Endpoints in `ShoppingAssistantDefinition` & Agent** ([shopping-assistant-definition.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-definition.ts), [shopping-assistant-agent.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-agent.ts)):
  - `POST /v1/assistant/{id}/chat`: Synchronous request/response.
  - `POST /v1/assistant/{id}/chat-stream`: Real-time streaming using `WitTypes.AgentStream(ChatChunk)`.
  - `GET /v1/assistant/{id}/history`: Returns complete multi-turn session history.
  - `POST /v1/assistant/{id}/clear-history`: Resets session messages.
  - `GET /v1/assistant/{id}/recommended-items`: Preserved read-only recommendations.
  - `POST /v1/assistant/{id}/recommend-items`: Preserved recommendation generation, delegating execution to [shopping-assistant-recommendations.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/src/agents/shopping-assistant/shopping-assistant-recommendations.ts).

#### 4. Frontend Integration (`frontend/src/`)
- **Assistant API Client** ([assistantService.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/frontend/src/api/services/assistantService.ts)):
  - `chatWithAssistant`: Sends synchronous user prompt and returns assistant reply and tools used.
  - `streamChatWithAssistant`: Connects to `POST /api/v1/assistant/{id}/chat-stream` using the Fetch Streams API, emitting chunks (`tool_start`, `tool_result`, `text_delta`, `done`, `error`) in real time.
  - `getAssistantHistory` & `clearAssistantHistory`: Manages multi-turn conversation persistence.
- **Assistant Pinia Store** ([assistantStore.ts](file:///Users/coon/workspace-zv/git/golem-shopping-effect/frontend/src/stores/assistantStore.ts)):
  - Manages messages, active executing tools, streaming text deltas, and loading state.
  - Automatically refreshes the shopping cart via `cartStore.fetchCart` whenever a cart-mutating tool (`add_to_cart`, `remove_from_cart`, `clear_cart`, `checkout_cart`, etc.) is executed by the assistant.
- **Shopping Assistant View** ([ShoppingAssistantView.vue](file:///Users/coon/workspace-zv/git/golem-shopping-effect/frontend/src/views/ShoppingAssistantView.vue)):
  - Accessible at `/assistant`.
  - Interactive chat window with real-time text streaming and typing cursor.
  - Tool execution pills showing which tools were invoked, along with collapsible inspectors for tool arguments and results.
  - One-click starter suggestions (e.g. search with prices, check cart, 1-click checkout, recent orders).
- **Global Navigation & Floating Launcher** ([App.vue](file:///Users/coon/workspace-zv/git/golem-shopping-effect/frontend/src/App.vue), [HomeView.vue](file:///Users/coon/workspace-zv/git/golem-shopping-effect/frontend/src/views/HomeView.vue)):
  - Navigation bar link to `🤖 AI Assistant`.
  - Floating action button (FAB) in the bottom-right corner for 1-click access across all views.
  - Hero action button on the home page.

---

## 2. Verification Results

All automated checks and quality gates passed cleanly:

| Check | Command | Result | Notes |
|---|---|---|---|
| **Prettier Formatting** | `npm run format:check` | `PASS` | All matched files use Prettier style. |
| **Type Checking** | `npm run typecheck` | `PASS` | Zero TypeScript compiler errors (`tsc --noEmit`). |
| **Linting** | `npm run lint` | `PASS` | Zero ESLint errors, zero warnings. |
| **Automated Tests** | `npm test` | `PASS` | All unit tests passed. |
| **Rollup Component Bundling** | `npx rollup src/main.ts ...` | `PASS` | Bundled cleanly into ESM in 3.2s with zero warnings. |

---

## 3. Key Decisions & Architecture Highlights

1. **Clean Separation of Concerns**:
   No e-commerce business logic is duplicated inside the Shopping Assistant. Every tool delegates directly to an agent method that can also be used by web/mobile frontends or external MCP clients.
2. **First-Time vs Returning Customers**:
   - Returning customers benefit from `get_saved_contact_info` and `apply_saved_contact_info` for 1-click checkout.
   - First-time customers (or orders shipping to a different destination) use `set_shipping_address`, `set_billing_address`, and `set_email`.
3. **Graceful Fallback**:
   If `OPENROUTER_KEY` is not configured in local environment secrets, the assistant returns a clear prompt instructing the developer to provide the secret, rather than crashing or throwing unhandled defects.
4. **Roadmap to `@earendil-works/pi-ai`**:
   The current architecture uses standard Effect AI / HTTP for guaranteed QuickJS WASM compatibility. As noted in the plan, `@earendil-works/pi-ai` is documented as an exciting next-step benchmark once testing against multi-component Golem environments.

