import { Effect, Stream } from "effect";
import { extractLlmErrorMessage, fixMojibake, formatLlmErrorMessage } from "../../common/index.js";
import { ChatChunk, ChatMessage, setupModelsAndProvider } from "../../ai/index.js";
import { ChatTurnResult, executeAgentChatTurn } from "../../ai/agent-loop.js";
import { getShoppingAssistantPiTools } from "./shopping-assistant-tools.js";

export { extractLlmErrorMessage, fixMojibake, formatLlmErrorMessage, setupModelsAndProvider };
export type { ChatTurnResult };

export const SYSTEM_PROMPT = `You are a helpful, courteous, and efficient personal Shopping Assistant for our e-commerce store.
You have access to tools to help the user:
- Search products and inspect live pricing (search_products)
- Get full details on a specific product (get_product_details)
- View current cart items, totals, and address (get_cart)
- Add items, update quantities, remove items, or clear cart (add_to_cart, update_cart_quantity, remove_from_cart, clear_cart)
- Check saved shipping/billing addresses and email from previous orders (get_saved_contact_info)
- Pre-fill the cart with saved contact details for 1-click checkout (apply_saved_contact_info)
- Manually set shipping address, billing address, or email on the cart (set_shipping_address, set_billing_address, set_email)
- Place the order (checkout_cart)
- Check order history or track a specific order (get_order_history, get_order_details)
- Check product inventory (check_inventory)

Guidelines:
1. Be concise, polite, and directly address the user's intent.
2. When mentioning products, include their name, brand, and price.
3. For checkout:
   - Step 1 (Cart & Contact Info Review):
     * Always inspect the current cart using get_cart. If the cart is empty, politely inform the user and do not proceed with checkout.
     * Check for saved contact details using get_saved_contact_info.
     * If saved contact info exists, propose using those details (or apply them via apply_saved_contact_info if the user already agreed).
     * If no saved contact info exists (first-time customer), ask for their shipping address, billing address, and email, then update the cart using set_shipping_address, set_billing_address, and set_email.
     * Always present an Order Summary for user review before placing the order:
       - Itemized list with product name, quantity, and unit price
       - Order total amount
       - Recipient name, shipping address, and email
     * Explicitly ask the user to confirm placing the order (e.g. "Please review your order summary above. Would you like me to place this order now?").
   - Step 2 (Order Placement):
     * ONLY call checkout_cart AFTER the user has seen the order review and explicitly confirmed (e.g. "yes", "confirm", "proceed", "place order").
     * Never call checkout_cart in the same turn where the order summary is shown for the first time.
     * After checkout succeeds, celebrate the order and provide the order ID.
4. When showing order history, summarize recent orders clearly (status, total, date).
5. Output plain ASCII punctuation: use standard hyphens ('-') instead of special en-dashes ('–') or em-dashes ('—'), and standard quotes.`;

export function executeChatTurn(options: {
  readonly userId: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
  readonly history: readonly ChatMessage[];
  readonly userMessage: string;
}): Effect.Effect<ChatTurnResult> {
  return Effect.gen(function* () {
    const context = yield* Effect.context();
    const tools = getShoppingAssistantPiTools(options.userId, context);

    return yield* executeAgentChatTurn({
      systemPrompt: SYSTEM_PROMPT,
      tools,
      apiKey: options.apiKey,
      model: options.model,
      apiUrl: options.apiUrl,
      history: options.history,
      userMessage: options.userMessage,
      missingApiKeyMessage:
        "Shopping assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
    });
  });
}

export function executeChatTurnStream(options: {
  readonly userId: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
  readonly history: readonly ChatMessage[];
  readonly userMessage: string;
}): Stream.Stream<ChatChunk> {
  return Stream.fromEffect(executeChatTurn(options)).pipe(
    Stream.flatMap((result) => Stream.fromIterable(result.chunks)),
  );
}
