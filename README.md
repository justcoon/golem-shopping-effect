# golem-shopping-effect

## Overview

This is an e-commerce application built with an agent-based architecture on [Golem Cloud](https://learn.golem.cloud). Built with TypeScript and [Effect](https://effect.website), each agent represents a durable, distributed micro-entity with its own isolated state, life cycle, and transactional RPC interfaces. The application provides product catalog browsing, dynamic pricing, cart management, order processing, and an autonomous AI-powered shopping assistant.

![Architecture Diagram](architecture.png)

*Figure 1: Golem Shopping Application Architecture*

## Architecture Components

### Agents
- **Product Agent**: Manages the product catalog, details, and product metadata.
- **Pricing Agent**: Handles product pricing, currency conversions, volume discounts, and promotions.
- **Inventory Agent**: Manages regional product stock levels, time-bounded checkout reservations (TTL holds), and order allocations, ensuring consistency during checkout and post-checkout order modifications.
- **Cart Agent**: Stateful per-user shopping carts that manage item additions, quantities, two-phase checkout (`prepareCheckout` → `confirmCheckout`) with locked reservation drafts, cart-to-order conversions, and asynchronous triggers for post-checkout recommendation refreshes.
- **Order Agent**: Manages the end-to-end order lifecycle from checkout to fulfillment.
- **Product Search Agent**: Provides catalog search with flexible query filtering (keywords, brands, tags).
- **Order Search Agent**: Provides system-wide order search, filtering by status, user ID, or free-text query, and date sorting.
- **Shopping Assistant Agent**: Autonomous customer-facing AI assistant providing real-time streaming dialogue and executing multi-turn tool calling across domain agents using durable Golem RPC.
- **Shopping Recommendation Agent**: Dedicated per-user recommendation engine that analyzes past purchase history and generates personalized product recommendations using LLM reasoning, updating asynchronously upon checkout without blocking chat execution.
- **Manager Agent**: Autonomous AI assistant for store managers to search, modify, ship, and cancel orders, and inspect catalog/inventory.

### AI & Agent Tool Architecture (`src/ai/`)
- **Shared AI Framework**: General-purpose AI subsystem (`src/ai/`) powering both `ShoppingAssistantAgent` and `ManagerAgent`.
- **Autonomous Agent Loop**: Powered by `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`, managing multi-turn conversational state, message history, and autonomous tool calling.
- **Multi-Provider LLM Support**: Native support for Google Gemini (with cryptographic thought signatures for function calling), OpenRouter, and any OpenAI-compatible provider.
- **Dynamic Tool Generation**: Declaratively converts agent methods into type-safe LLM tools with schema validation, custom input mapping, and automatic agent ID resolution.
- **Durable Streaming & Multi-Turn**: Exposes synchronous `chat` and Durable Streams `chatStream` methods with real-time token and tool event streaming.
- **Structured WASI Logging**: Logs tool invocation lifecycle events (`[ShoppingAssistant]` and `[ManagerAgent]`) through Effect WASI logging.

### Key Features
- **Two-Phase Checkout & Reservation**: Time-bounded inventory reservations (10-minute hold window) during checkout preparation, preventing race conditions and cart modifications until confirmation or cancellation.
- **RESTful HTTP API**: All agents expose HTTP endpoints declared in `golem.yaml` and mapped directly to agent methods.
- **Built-in Web Interfaces**: Zero-setup web clients served directly by Golem:
  - `/assistant`: Customer shopping assistant with real-time SSE streaming, collapsible tool inspection, and dynamic recommendations.
  - `/manager`: Store operations dashboard for searching, inspecting, modifying, shipping, and cancelling orders, plus inventory checks.
- **Storefront Frontend**: Vue 3 and Vite e-commerce storefront for product browsing, cart, and checkout.
- **Durable Execution & State**: State persistence, retries, and crash recovery are managed automatically by Golem Cloud.
- **Agent-to-Agent RPC**: Zero-boilerplate, type-safe RPC between agents with ambient context propagation.

---

## Quick Start

### 1. Prerequisites
- [Golem CLI](https://learn.golem.cloud/cli) (version 1.6.3+)
- [Node.js](https://nodejs.org) (v20+)
- Running Golem environment (local or cloud). See [Golem Quickstart](https://learn.golem.cloud/quickstart) for more information.

### 2. LLM Configuration
The AI agents (`ShoppingAssistantAgent`, `ShoppingRecommendationAgent`, and `ManagerAgent`) require an LLM provider configured in `golem.yaml` under `secretDefaults.local.llm`:

#### Option A: Google Gemini (Default)
Export your Gemini API key:
```bash
export GEMINI_API_KEY="your-gemini-api-key"
```
In `golem.yaml`:
```yaml
secretDefaults:
  local:
    llm:
      apiKey: '{{ GEMINI_API_KEY }}'
      model: "gemini-3.1-flash-lite"
      apiUrl: "https://generativelanguage.googleapis.com/v1beta"
```

#### Option B: OpenRouter
Export your OpenRouter API key:
```bash
export OPENROUTER_KEY="your-openrouter-key"
```
In `golem.yaml`:
```yaml
secretDefaults:
  local:
    llm:
      apiKey: '{{ OPENROUTER_KEY }}'
      model: "openrouter/anthropic/claude-3.5-sonnet"
      apiUrl: "https://openrouter.ai/api/v1"
```

### 3. Build and Deploy
```bash
# Install dependencies
npm install

# Build WASM components
golem build --yes

# Deploy to local Golem environment
golem deploy --yes
```

### 4. Import Sample Data
To populate the product catalog, pricing, and regional inventory, see the [Data README](./data/README.md).

From the `data/` directory:
```bash
HOST=http://localhost:9006 API_HOST=localhost:9006 drill --benchmark import.yaml --stats
```

### 5. Launch the Web Assistant Interface
The web client is hosted directly by Golem (no separate frontend server required). Open your browser and navigate to:
```
http://localhost:9006/assistant
```
Supports live SSE streaming, collapsible tool execution details, prompt reuse (`🔄`), error retry, dynamic product recommendations, and multi-user switching.

### 6. Launch the Store Manager Interface
The store management interface is hosted directly by Golem at `/manager`:
```
http://localhost:9006/manager
```
Empowers store managers to search, inspect, modify, cancel, and ship orders, and inspect catalog/inventory allocations with live SSE streaming and collapsible tool execution details.

### 7. Storefront Frontend (Vue 3)
A full e-commerce storefront for product browsing, cart management, and checkout is available in the [`frontend/`](./frontend) directory:
```bash
cd frontend
npm install
npm run dev
```
The application will be available at `http://localhost:3000`. See the [Frontend README](./frontend/README.md) for more details.

---

## Development & Testing

```bash
# Run unit tests
npm test

# Check code formatting
npm run format:check

# Format code
npm run format

# Run TypeScript type check
npm run typecheck

# Run linter
npm run lint

# Build Golem component
golem build --yes
```
