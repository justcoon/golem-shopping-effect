import { Effect, Ref } from "effect";
import { Snapshot } from "@golemcloud/effect-golem";
import { executeConversationalTurn, executeConversationalTurnStream } from "../../ai/index.js";
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
          const { managerId } = yield* Ref.get(state);
          const { llm } = yield* ManagerAgentConfig;
          const context = yield* Effect.context();
          const tools = getManagerPiTools(managerId, context);

          return yield* executeConversationalTurn({
            state,
            userMessage: message,
            systemPrompt: MANAGER_SYSTEM_PROMPT,
            tools,
            llm,
            missingApiKeyMessage:
              "Manager assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
          });
        }),
      ),

    chatStream: ({ message }) =>
      Effect.gen(function* () {
        const { managerId } = yield* Ref.get(state);
        const { llm } = yield* ManagerAgentConfig;
        const context = yield* Effect.context();
        const tools = getManagerPiTools(managerId, context);

        return executeConversationalTurnStream({
          state,
          userMessage: message,
          systemPrompt: MANAGER_SYSTEM_PROMPT,
          tools,
          llm,
          missingApiKeyMessage:
            "Manager assistant is ready, but no LLM API key is configured. Please provide GEMINI_API_KEY or OPENROUTER_KEY in your environment or secrets.",
        });
      }),

    getHistory: () => Ref.get(state).pipe(Effect.map(({ messages }) => [...messages])),

    clearHistory: () =>
      Ref.update(state, (prev) => ({ ...prev, messages: [] })).pipe(Effect.asVoid),
  }),
});
