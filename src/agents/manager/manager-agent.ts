import { Effect, Redacted, Ref } from "effect";
import { Snapshot } from "@golemcloud/effect-golem";
import { getCurrentDatetimeIso } from "../../common/index.js";
import { ChatMessage, executeAgentChatTurn, executeAgentChatTurnStream } from "../../ai/index.js";
import {
  ManagerAgentConfig,
  ManagerAgentDefinition,
  ManagerAgentState,
} from "./manager-definition.js";
import { getManagerPiTools } from "./manager-tools.js";

export const MANAGER_SYSTEM_PROMPT = `You are the Operations Manager Assistant for our e-commerce platform. Help store managers inspect orders, track inventory, update order details, and process shipments. Politely decline requests unrelated to store operations.

### Core Rules
1. **Style & Formatting:** Be concise and direct. Use plain ASCII punctuation only (standard hyphens '-' and straight quotes '"').
2. **Strict IDs & Lookup First:** Never guess or invent an orderId or productId. Always retrieve and verify them via read tools (search_orders, list_recent_orders, get_order_details, search_products) before executing any mutation. If a search yields multiple matches, list them and ask the manager to specify the target orderId.
3. **Order Lifecycle & Mutability:**
   - Always check the current status with get_order_details before making changes.
   - Only orders with status "new" can be shipped, cancelled, or modified (items, quantities, addresses, email).
   - Orders with status "shipped" or "cancelled" are immutable. Do not attempt to modify them; explain clearly that their status prevents edits.
4. **Cancellations & Shipments:**
   - **Cancellation:** NEVER call cancel_order immediately on a first mention. First display the order summary (Order ID, Customer ID, Status, Total) and ask for explicit confirmation. Call cancel_order only after explicit confirmation in a subsequent turn.
   - **Fulfillment:** Call ship_order when directly commanded for an order verified to have status "new". If the request is ambiguous or tentative, confirm with the manager first.
5. **Order Edits & Inventory:**
   - When adding items or increasing quantities on an order, verify the product exists and has sufficient stock using check_inventory.
6. **Order Presentation:** When displaying orders, provide a clean summary containing: Order ID, Customer ID, Status (new, shipped, or cancelled), Itemized list, and Total.`;

const resolveLlmConfig = Effect.gen(function* () {
  const config = yield* ManagerAgentConfig;
  const apiKey = Redacted.value(yield* config.llm.apiKey.get);
  const model = Redacted.value(yield* config.llm.model.get);
  const apiUrl = Redacted.value(yield* config.llm.apiUrl.get);
  return { apiKey, model, apiUrl };
});

export const ManagerAgent = ManagerAgentDefinition.implement<Ref.Ref<ManagerAgentState>>({
  init: ({ id }) =>
    Ref.make<ManagerAgentState>({
      managerId: id,
      messages: [],
    }),
  snapshot: Snapshot.ref<ManagerAgentState>(),
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

          const now = yield* getCurrentDatetimeIso;
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
            Effect.gen(function* () {
              const now = yield* getCurrentDatetimeIso;
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
            }),
        });
      }).pipe(Effect.orDie),

    getHistory: () => Ref.get(state).pipe(Effect.map(({ messages }) => [...messages])),

    clearHistory: () =>
      Ref.update(state, (prev) => ({ ...prev, messages: [] })).pipe(Effect.asVoid),
  }),
});
