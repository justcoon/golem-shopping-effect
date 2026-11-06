import { Effect, Redacted, Ref } from "effect";
import { ChatMessage, executeAgentChatTurn, executeAgentChatTurnStream } from "../../ai/index.js";
import { ManagerAgentConfig, ManagerAgentDefinition } from "./manager-definition.js";
import { getManagerPiTools } from "./manager-tools.js";

export const MANAGER_SYSTEM_PROMPT = `You are an expert, courteous, and efficient Store Management Assistant for our e-commerce store operations.
You assist store managers and administrators in managing orders, customers, inventory, and fulfillment.

You have access to tools to help:
- Search and list orders: search_orders, list_recent_orders, get_order_details
- Ship orders (fulfilling inventory): ship_order
- Cancel orders (releasing reserved inventory): cancel_order
- Modify orders (for orders with status 'new'):
  * add_order_item: add products to an order (reserves inventory)
  * remove_order_item: remove products from an order (releases inventory)
  * update_order_item_quantity: change item quantity (adjusts inventory)
  * update_order_shipping_address: change delivery destination
  * update_order_billing_address: change billing address
  * update_order_email: update customer contact email
- Check products and inventory:
  * check_product_details: inspect catalog product information
  * check_inventory: inspect available and total regional stock
  * search_products: search catalog

Guidelines:
1. Always confirm critical order actions like cancellation or shipment with the manager if not explicitly commanded.
2. When displaying orders, provide clear, concise summaries including Order ID, Customer ID, Status, Items, and Total.
3. If an order operation fails (for instance, trying to modify an order that is already shipped or cancelled), explain clearly why the action was rejected.
4. Output plain ASCII punctuation: use standard hyphens ('-') and standard quotes.`;

interface ManagerAgentState {
  readonly managerId: string;
  readonly messages: ChatMessage[];
}

const resolveLlmConfig = Effect.gen(function* () {
  const config = yield* ManagerAgentConfig;
  const apiKey = Redacted.value(yield* config.llm.apiKey.get);
  const model = Redacted.value(yield* config.llm.model.get);
  const apiUrl = Redacted.value(yield* config.llm.apiUrl.get);
  return { apiKey, model, apiUrl };
});

export const ManagerAgent = ManagerAgentDefinition.implement({
  init: ({ id }) =>
    Ref.make<ManagerAgentState>({
      managerId: id,
      messages: [],
    }),

  methods: (state) => ({
    chat: ({ message }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { managerId, messages } = yield* Ref.get(state);
          const { apiKey, model, apiUrl } = yield* resolveLlmConfig;
          const context = yield* Effect.context();
          const tools = getManagerPiTools(managerId, context);

          const result = yield* executeAgentChatTurn({
            systemPrompt: MANAGER_SYSTEM_PROMPT,
            tools,
            apiKey,
            model,
            apiUrl,
            history: messages,
            userMessage: message,
            missingApiKeyMessage:
              "Manager assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
          });

          const now = new Date().toISOString();
          const userMsg: ChatMessage = {
            role: "user",
            content: message,
            timestamp: now,
            type: "ok",
          };
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: result.reply,
            toolCalls: result.toolCallsUsed.length > 0 ? [...result.toolCallsUsed] : undefined,
            timestamp: now,
            type: result.type,
          };

          yield* Ref.update(state, (prev) => ({
            ...prev,
            messages: [...prev.messages, userMsg, assistantMsg],
          }));

          return {
            reply: result.reply,
            toolCallsUsed: [...result.toolCallsUsed],
            type: result.type,
          };
        }),
      ).pipe(Effect.orDie),

    chatStream: ({ message }) =>
      Effect.gen(function* () {
        const { managerId, messages } = yield* Ref.get(state);
        const { apiKey, model, apiUrl } = yield* resolveLlmConfig;
        const context = yield* Effect.context();
        const tools = getManagerPiTools(managerId, context);

        return executeAgentChatTurnStream({
          systemPrompt: MANAGER_SYSTEM_PROMPT,
          tools,
          apiKey,
          model,
          apiUrl,
          history: messages,
          userMessage: message,
          missingApiKeyMessage:
            "Manager assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
          onTurnComplete: (result) =>
            Ref.update(state, (prev) => {
              const now = new Date().toISOString();
              const userMsg: ChatMessage = {
                role: "user",
                content: message,
                timestamp: now,
                type: "ok",
              };
              const assistantMsg: ChatMessage = {
                role: "assistant",
                content: result.reply,
                toolCalls: result.toolCallsUsed.length > 0 ? [...result.toolCallsUsed] : undefined,
                timestamp: now,
                type: result.type,
              };
              return {
                ...prev,
                messages: [...prev.messages, userMsg, assistantMsg],
              };
            }),
        });
      }).pipe(Effect.orDie),

    getHistory: () => Ref.get(state).pipe(Effect.map(({ messages }) => [...messages])),

    clearHistory: () =>
      Ref.update(state, (prev) => ({ ...prev, messages: [] })).pipe(Effect.asVoid),
  }),
});
