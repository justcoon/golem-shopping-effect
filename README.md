# golem-shopping-effect

## Overview

This is an e-commerce application built with an agent-based architecture on [Golem Cloud](https://learn.golem.cloud). Built with TypeScript and [Effect](https://effect.website), each agent represents a durable, distributed micro-entity with its own isolated state, life cycle, and transactional RPC interfaces. The application provides product catalog browsing, dynamic pricing, cart management, order processing, and an autonomous AI-powered shopping assistant.

![Architecture Diagram](architecture.png)

*Figure 1: Golem Shopping Application Architecture*

## Architecture Components

### Agents
- **Product Agent**: Manages the product catalog, details, inventory, and product metadata.
- **Pricing Agent**: Handles product pricing, currency conversions, volume discounts, and promotions.
- **Cart Agent**: Stateful per-user shopping carts that manage item additions, quantities, and cart-to-order conversions.
- **Order Agent**: Manages the end-to-end order lifecycle from checkout to fulfillment.
- **Product Search Agent**: Provides catalog search with flexible query filtering (keywords, brands, tags).
- **Shopping Assistant Agent**: Autonomous AI assistant that plans and executes multi-turn tool calling across domain agents using durable Golem RPC.

### Shopping Assistant Architecture
- **Autonomous Agent Loop**: Manages multi-turn conversational state, model message history, and autonomous tool calling.
- **Multi-Provider LLM Support**: Supports Google Gemini (with cryptographic thought signatures for function calling), OpenRouter, and any OpenAI-compatible provider.
- **Durable Golem RPC Tools**: Tools (`search_products`, `get_cart`, `add_to_cart`, `clear_cart`, `checkout_cart`, `get_order_details`) run within the agent's ambient Effect context, invoking domain agents via type-safe Golem RPC.
- **Streaming & Multi-Turn**: Exposes both synchronous `chat` and streaming `chatStream` methods, streaming incremental text and tool updates.
- **Structured WASI Logging**: Logs tool invocation lifecycle events (`[ShoppingAssistant] Invoking tool...` and `[ShoppingAssistant] Tool ... completed`) through Effect WASI logging.

### Key Features
- **RESTful HTTP API**: All agents expose HTTP endpoints declared in `golem.yaml` and mapped directly to agent methods.
- **Durable Execution & State**: State persistence, retries, and crash recovery are managed automatically by Golem Cloud.
- **Agent-to-Agent RPC**: Zero-boilerplate, type-safe RPC between agents with ambient context propagation.

---

## Quick Start

### 1. Prerequisites
- [Golem CLI](https://learn.golem.cloud/cli) (version 1.6.0+)
- [Node.js](https://nodejs.org) (v20+)
- Running Golem environment (local or cloud). See [Golem Quickstart](https://learn.golem.cloud/quickstart) for more information.

### 2. LLM Configuration
The Shopping Assistant requires an LLM provider configured in `golem.yaml` under `secretDefaults.local.llm`:

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
golem deploy
```

### 4. Import Sample Data
To populate the product catalog and pricing, see the [Data README](./data/README.md).

From the `data/` directory:
```bash
HOST=http://localhost:9006 API_HOST=localhost:9006 drill --benchmark import.yaml --stats
```

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
