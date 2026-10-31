# Feature Plan: Effect Reimplementation of Golem Shopping Application

- **Feature ID / Slug**: `effect-shopping-reimplementation`
- **Date**: 2026-10-29
- **Status**: Draft <!-- Draft | Approved | In Progress | Completed -->

---

## 1. Overview & Goals

Reimplement the Golem Shopping e-commerce application in TypeScript using the **Effect** paradigm and `@golemcloud/effect-golem` SDK, migrating the existing functionality from `/Users/coon/workspace-zv/git/golem-shopping-ts/src`.

As specifically requested, the new implementation will organize all agent code into dedicated folders per agent (`src/agents/<agent-name>/`).

### Goals

- Reimplement all 6 agents from the reference TypeScript SDK project into `@golemcloud/effect-golem`:
  1. **`ProductAgent`**: Durable agent for product catalog entries, initialization, and retrieval.
  2. **`PricingAgent`**: Durable agent managing MSRP, list, and sale prices with merging logic.
  3. **`CartAgent`**: Durable agent for user shopping carts, item management, address/email updates, live cart recalculation from Product and Pricing agents, and checkout orchestration.
  4. **`OrderAgent`**: Durable agent managing order lifecycle (`new`, `cancelled`, `shipped`), item modifications, and status transitions.
  5. **`ProductSearchAgent`**: Ephemeral agent implementing product search and filtering across instances using Golem's `Agents.getAgents` stream and query pattern matching.
  6. **`ShoppingAssistantAgent`**: Durable agent providing LLM-powered personalized product and brand recommendations via OpenRouter using Effect's HTTP client (`effect/http`), typed configuration, and secrets (`defineConfig`, `Schema.Redacted`).
- Maintain exact REST API endpoint shapes and semantics for HTTP compatibility:
  - Product: `POST /v1/product/{id}`, `GET /v1/product/{id}`
  - Pricing: `POST /v1/pricing/{id}`, `PUT /v1/pricing/{id}`, `GET /v1/pricing/{id}`
  - Cart: `PUT /v1/cart/{id}/items/{productId}`, `DELETE /v1/cart/{id}/items/{productId}`, `PUT /v1/cart/{id}/billing-address`, `PUT /v1/cart/{id}/shipping-address`, `PUT /v1/cart/{id}/email`, `POST /v1/cart/{id}/checkout`, `GET /v1/cart/{id}`
  - Order: `PUT /v1/order/{id}/items/{productId}`, `DELETE /v1/order/{id}/items/{productId}`, `PUT /v1/order/{id}/billing-address`, `PUT /v1/order/{id}/shipping-address`, `PUT /v1/order/{id}/email`, `POST /v1/order/{id}/cancel-order`, `POST /v1/order/{id}/ship-order`, `GET /v1/order/{id}`
  - Product Search: `GET /v1/product?ids={ids}`, `GET /v1/product/search?query={query}`
  - Shopping Assistant: `GET /v1/assistant/{id}/recommended-items`
- Enforce the required project structure: **folders for agents** under `src/agents/<agent-name>/`.
- Pass all strict quality gates: formatting (`npm run format:check`), typechecking (`npm run typecheck`), linting (`npm run lint`), automated tests (`npm test`), and WASM compilation (`npm run build` via `golem build --yes`).

### Non-Goals

- Modifying the frontend application in `frontend/`.
- Changing external OpenRouter API schemas or endpoints.

---

## 2. Architecture & Technical Design

### Agent Folder Layout

Per the user's requirement, code for each agent is isolated in its own folder:

```text
src/
├── common/
│   ├── models.ts              # Common models (Address, constants, arrayChunks, Datetime utilities)
│   └── index.ts
├── agents/
│   ├── product/
│   │   ├── product-schema.ts  # Effect Schema definitions (Product)
│   │   ├── product-agent.ts   # defineAgent & implement
│   │   └── index.ts
│   ├── pricing/
│   │   ├── pricing-schema.ts  # Effect Schema definitions (PricingItem, SalePricingItem, Pricing) & merge helpers
│   │   ├── pricing-agent.ts   # defineAgent & implement
│   │   └── index.ts
│   ├── cart/
│   │   ├── cart-schema.ts     # Effect Schema definitions (CartItem, Cart, CartUpdated, OrderConfirmation, Error variants)
│   │   ├── cart-agent.ts      # defineAgent & implement
│   │   └── index.ts
│   ├── order/
│   │   ├── order-schema.ts    # Effect Schema definitions (OrderStatus, OrderItem, CreateOrder, Order, Error variants)
│   │   ├── order-agent.ts     # defineAgent & implement
│   │   └── index.ts
│   ├── product-search/
│   │   ├── product-query-matcher.ts # Query tokenization and field filter matching
│   │   ├── product-search-agent.ts  # Ephemeral agent using Agents.getAgents stream
│   │   └── index.ts
│   └── shopping-assistant/
│       ├── shopping-assistant-schema.ts # RecommendedItems schema
│       ├── shopping-assistant-agent.ts  # LLM assistant with typed secret config & effect/http
│       └── index.ts
└── main.ts                    # Entry point: registers all agent implementations and exports agents
```

### Key Technical Decisions & Patterns

1. **Effect Schema & WIT Mapping**:
   - Agent identity declared via `id: { id: Schema.String }` or `{}` for singletons/ephemerals.
   - Timestamps represented using `@golemcloud/effect-golem`'s `Datetime.Datetime` struct (`{ seconds: Schema.BigInt, nanoseconds: Schema.Int }`), populated via `Datetime.fromDateTime(yield* DateTime.now)`.
   - Optional fields mapped with `Schema.optional(...)` or `Schema.NullOr(...)` for route parameters and query endpoints.
2. **Durable In-Memory State**:
   - Agents hold state in `Ref.Ref<T | null>` initialized during agent `init`.
   - Sequential invocation guarantees safety for in-memory state mutations.
3. **Agent-to-Agent RPC**:
   - `CartAgent` queries `ProductAgent.client.get({ id: productId })` and `PricingAgent.client.get({ id: productId })` during `addItem` and dynamic cart evaluation in `get()`.
   - `CartAgent.checkout` calls `OrderAgent.client.get({ id: orderId }).create({ order })`.
   - Post-checkout recommendation is fired asynchronously via fire-and-forget:
     `yield* assistant.recommendItems.trigger({})` preventing RPC deadlock cycles.
4. **Agent Discovery in `ProductSearchAgent`**:
   - Ephemeral agent (`mode: "ephemeral"`).
   - Resolves component identity with `yield* Agents.resolveComponentId("golem-shopping-effect:effect-main")` or `SelfAgentId`.
   - Uses `Agents.getAgents` with `Agents.Filter.name("starts-with", "ProductAgent(")` returning a stream of agent metadata.
   - Extracts `productId` from the agent instance name and queries `ProductAgent.client.get({ id: productId })` in concurrent batches using `arrayChunks`.
   - Filters through `ProductQueryMatcher`.
5. **LLM Recommendations with OpenRouter & Typed Secrets**:
   - `ShoppingAssistantConfig` defined with `defineConfig`:
     ```typescript
     export class ShoppingAssistantConfig extends defineConfig("ShoppingAssistantAgent.Config", {
       llm: Schema.Struct({
         apiKey: Schema.Redacted(Schema.String),
         model: Schema.Redacted(Schema.String),
       }),
     }) {}
     ```
   - Outbound HTTP executed with `HttpClientRequest.post("https://openrouter.ai/api/v1/chat/completions")` provided with `FetchHttpClient.layer`.
   - Managed with Golem host retry policy `Retry.withPolicy` for exponential backoff on transient failures.
6. **Manifest & Deployment Configuration (`golem.yaml`)**:
   - HTTP API deployment exposes all 6 agents on the local subdomain/domain.
   - `secretDefaults` configured for `ShoppingAssistantAgent.llm.apiKey` and `llm.model`.

---

## 3. Proposed Changes & File Impact

| Action     | File Path                                                                                  | Description                                                                              |
| :--------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| `[DELETE]` | [`src/counter-agent.ts`](../../src/counter-agent.ts)                                       | Remove template counter agent                                                            |
| `[MODIFY]` | [`package.json`](../../package.json)                                                       | Add scripts (`typecheck`, `format`, `format:check`, `lint`, `build`, `test`) & dev deps  |
| `[MODIFY]` | [`golem.yaml`](../../golem.yaml)                                                           | Configure 6 agents under `httpApi` deployments and secret defaults for assistant         |
| `[NEW]`    | [`src/common/models.ts`](../../src/common/models.ts)                                       | Common schemas (`Address`), constants (`CURRENCY`, region), `arrayChunks`, datetime util|
| `[NEW]`    | [`src/common/index.ts`](../../src/common/index.ts)                                         | Re-export common utilities                                                               |
| `[NEW]`    | [`src/agents/product/product-schema.ts`](../../src/agents/product/product-schema.ts)       | `Product` Schema definitions                                                             |
| `[NEW]`    | [`src/agents/product/product-agent.ts`](../../src/agents/product/product-agent.ts)         | `ProductAgent` definition and implementation                                             |
| `[NEW]`    | [`src/agents/product/index.ts`](../../src/agents/product/index.ts)                         | Barrel export for product agent and schema                                               |
| `[NEW]`    | [`src/agents/pricing/pricing-schema.ts`](../../src/agents/pricing/pricing-schema.ts)       | `PricingItem`, `SalePricingItem`, `Pricing` schemas and merge algorithms                 |
| `[NEW]`    | [`src/agents/pricing/pricing-agent.ts`](../../src/agents/pricing/pricing-agent.ts)         | `PricingAgent` definition and implementation                                             |
| `[NEW]`    | [`src/agents/pricing/index.ts`](../../src/agents/pricing/index.ts)                         | Barrel export for pricing agent and schema                                               |
| `[NEW]`    | [`src/agents/order/order-schema.ts`](../../src/agents/order/order-schema.ts)               | `OrderStatus`, `OrderItem`, `CreateOrder`, `Order` schemas and typed errors              |
| `[NEW]`    | [`src/agents/order/order-agent.ts`](../../src/agents/order/order-agent.ts)                 | `OrderAgent` definition and implementation                                               |
| `[NEW]`    | [`src/agents/order/index.ts`](../../src/agents/order/index.ts)                             | Barrel export for order agent and schema                                                 |
| `[NEW]`    | [`src/agents/cart/cart-schema.ts`](../../src/agents/cart/cart-schema.ts)                   | `CartItem`, `Cart`, `CartUpdated`, `OrderConfirmation` schemas and error variants        |
| `[NEW]`    | [`src/agents/cart/cart-agent.ts`](../../src/agents/cart/cart-agent.ts)                     | `CartAgent` definition, RPC client interactions, dynamic cart calculations              |
| `[NEW]`    | [`src/agents/cart/index.ts`](../../src/agents/cart/index.ts)                             | Barrel export for cart agent and schema                                                  |
| `[NEW]`    | [`src/agents/product-search/product-query-matcher.ts`](../../src/agents/product-search/product-query-matcher.ts) | Search query tokenizer and matcher logic                                  |
| `[NEW]`    | [`src/agents/product-search/product-search-agent.ts`](../../src/agents/product-search/product-search-agent.ts)   | `ProductSearchAgent` ephemeral agent implementation                     |
| `[NEW]`    | [`src/agents/product-search/index.ts`](../../src/agents/product-search/index.ts)           | Barrel export for product search agent                                                   |
| `[NEW]`    | [`src/agents/shopping-assistant/shopping-assistant-schema.ts`](../../src/agents/shopping-assistant/shopping-assistant-schema.ts) | `RecommendedItems` schema                                        |
| `[NEW]`    | [`src/agents/shopping-assistant/shopping-assistant-agent.ts`](../../src/agents/shopping-assistant/shopping-assistant-agent.ts)   | `ShoppingAssistantAgent` definition, LLM HTTP client, host retries      |
| `[NEW]`    | [`src/agents/shopping-assistant/index.ts`](../../src/agents/shopping-assistant/index.ts)   | Barrel export for shopping assistant agent                                               |
| `[NEW]`    | [`test/product-query-matcher.test.ts`](../../test/product-query-matcher.test.ts)           | Unit tests for query matcher (wildcard, field filters, token matching)                   |
| `[MODIFY]` | [`src/main.ts`](../../src/main.ts)                                                         | Side-effect registration and agent exports                                               |

---

## 4. Verification Plan

### Automated Checks

1. **Code Formatting**:
   ```bash
   npm run format:check
   ```
   Ensures all TypeScript code conforms to Prettier rules.
2. **Type Checking**:
   ```bash
   npm run typecheck
   ```
   Executes `tsc --noEmit` to verify strict TypeScript typing across all schemas, agents, and handlers.
3. **Linter Verification**:
   ```bash
   npm run lint
   ```
   Runs ESLint with typescript-eslint rules to guarantee zero lint errors and no unused imports.
4. **Automated Unit Tests**:
   ```bash
   npm test
   ```
   Runs Node test runner against unit test suite (`test/product-query-matcher.test.ts`).
5. **Golem Component Build**:
   ```bash
   npm run build
   ```
   Invokes `golem build --yes` to bundle TypeScript with Rollup and compile the QuickJS WASM component, verifying component exports and WIT schema generation.

---

## 5. Risks & Open Questions

- **Risk**: Component name resolution in `ProductSearchAgent`.
  - *Mitigation*: In `golem.yaml`, the component is defined as `golem-shopping-effect:effect-main`. We will resolve this component ID via `yield* Agents.resolveComponentId("golem-shopping-effect:effect-main")` or query metadata using `SelfAgentId` if applicable.
- **Risk**: OpenRouter API key requirement for `ShoppingAssistantAgent`.
  - *Mitigation*: The agent handles missing key / HTTP error gracefully without crashing, logging a warning and returning empty recommendations just like the reference implementation.

