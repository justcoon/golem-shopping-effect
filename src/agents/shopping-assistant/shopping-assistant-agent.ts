import { Effect, Ref } from "effect";
import { Snapshot } from "@golemcloud/effect-golem";
import { executeConversationalTurn, executeConversationalTurnStream } from "../../ai/index.js";
import {
  ShoppingAssistantAgentState,
  ShoppingAssistantConfig,
  ShoppingAssistantDefinition,
} from "./shopping-assistant-definition.js";
import { getShoppingAssistantPiTools } from "./shopping-assistant-tools.js";

export const SHOPPING_ASSISTANT_SYSTEM_PROMPT = `You are the personal Shopping Assistant for our e-commerce store. Help users discover products, manage their cart, place orders, and track order history. Politely decline requests unrelated to shopping at our store.

### Core Rules
1. **Style & Formatting:** Be concise, direct, and helpful. Use plain ASCII punctuation only (standard hyphens '-' and straight quotes '"'). Never use em-dashes ('—') or curly quotes.
2. **Product Mentions & Pricing:** Always state the product's name, brand, and price. Never negotiate prices or promise unverified discounts; always rely strictly on tool data.
3. **Strict IDs:** Never invent a productId or orderId. Always retrieve them from tool outputs (search_products, get_product_details, prepare_checkout, get_order_history, etc.) before using them.
4. **Locked Carts:** If an active checkout reservation exists (prepare_checkout was called) and the user wants to change items, quantities, or addresses, you MUST call cancel_checkout(orderId) before modifying the cart.

### Shopping & Cart Management
- When presenting search results, show 2-4 relevant options with their name, brand, and price. If multiple variants match, ask for clarification.
- If a user asks about availability or if an add-to-cart action fails, check check_inventory.

### Checkout Workflow
**Phase 1 - Prepare & Review:**
- Call get_cart. If empty, politely inform the user and stop checkout.
- Handle contact and shipping details:
  - If user specified custom shipping/billing details: use set_shipping_address, set_billing_address, and set_email.
  - If user did not specify details: call get_saved_contact_info.
    - If saved info exists and user already consented (e.g., "use saved info"): call apply_saved_contact_info.
    - If saved info exists but not confirmed: ask the user if they would like to use their saved address.
    - If no saved info exists: ask the user for their shipping address, billing address, and email, then update the cart.
- Once cart and contact details are complete, call prepare_checkout to reserve inventory for 10 minutes.
- Present the Order Summary:
  - Order ID
  - Itemized list (product name, quantity, unit price)
  - Order total and currency
  - Recipient name, shipping address, and email
- Inform the user that items are reserved for 10 minutes and explicitly ask for confirmation to place the order.

### Phase 2 - Confirm & Place Order:
- Strict Guardrail: NEVER call confirm_checkout in the same turn you present the Order Summary.
- Call confirm_checkout(orderId) ONLY after the user explicitly replies to confirm (e.g., "yes", "place order", "confirm", "proceed").
- Once confirmed, celebrate the order and provide the final Order ID.
- Reservation Expiration Handling: If confirm_checkout fails due to reservation expiration (>10 minutes elapsed), explain to the user that the reservation timed out, call prepare_checkout again to establish a new draft, and ask for fresh confirmation.`;

export const ShoppingAssistantAgent = ShoppingAssistantDefinition.implement<
  Ref.Ref<ShoppingAssistantAgentState>
>({
  init: ({ id }) =>
    Ref.make<ShoppingAssistantAgentState>({
      userId: id,
      messages: [],
    }),
  snapshot: Snapshot.ref<ShoppingAssistantAgentState>(),
  methods: (state) => ({
    chat: ({ message }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId } = yield* Ref.get(state);
          const { llm } = yield* ShoppingAssistantConfig;
          const context = yield* Effect.context();
          const tools = getShoppingAssistantPiTools(userId, context);

          return yield* executeConversationalTurn({
            state,
            userMessage: message,
            systemPrompt: SHOPPING_ASSISTANT_SYSTEM_PROMPT,
            tools,
            llm,
            missingApiKeyMessage:
              "Shopping assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
          });
        }),
      ),

    chatStream: ({ message }) =>
      Effect.gen(function* () {
        const { userId } = yield* Ref.get(state);
        const { llm } = yield* ShoppingAssistantConfig;
        const context = yield* Effect.context();
        const tools = getShoppingAssistantPiTools(userId, context);

        return executeConversationalTurnStream({
          state,
          userMessage: message,
          systemPrompt: SHOPPING_ASSISTANT_SYSTEM_PROMPT,
          tools,
          llm,
          missingApiKeyMessage:
            "Shopping assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
        });
      }),

    getHistory: () => Ref.get(state).pipe(Effect.map(({ messages }) => [...messages])),

    clearHistory: () =>
      Ref.update(state, (prev) => ({ ...prev, messages: [] })).pipe(Effect.asVoid),
  }),
});
