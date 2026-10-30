import { Effect, Redacted, Ref, Stream } from "effect";
import { getCurrentDatetime } from "../../common/index.js";
import {
  ShoppingAssistantConfig,
  ShoppingAssistantDefinition,
} from "./shopping-assistant-definition.js";
import { executeChatTurn } from "./shopping-assistant-loop.js";
import { executeRecommendItems } from "./shopping-assistant-recommendations.js";
import { ChatMessage, RecommendedItems } from "./shopping-assistant-schema.js";

interface ShoppingAssistantAgentState {
  readonly userId: string;
  readonly messages: readonly ChatMessage[];
  readonly recommendedItems: RecommendedItems;
}

const resolveLlmConfig = Effect.gen(function* () {
  const config = yield* ShoppingAssistantConfig;
  const apiKey = Redacted.value(yield* config.llm.apiKey.get);
  const model = Redacted.value(yield* config.llm.model.get);
  const apiUrl = Redacted.value(yield* config.llm.apiUrl.get);

  return { apiKey, model, apiUrl };
});

export const ShoppingAssistantAgent = ShoppingAssistantDefinition.implement({
  init: ({ id }) =>
    Effect.gen(function* () {
      const date = yield* getCurrentDatetime;
      return yield* Ref.make<ShoppingAssistantAgentState>({
        userId: id,
        messages: [],
        recommendedItems: {
          productIds: [],
          productBrands: [],
          createdAt: date,
          updatedAt: date,
        },
      });
    }),
  methods: (state) => ({
    chat: ({ message }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, messages } = yield* Ref.get(state);
          const { apiKey, model, apiUrl } = yield* resolveLlmConfig;

          const result = yield* executeChatTurn({
            userId,
            apiKey,
            model,
            apiUrl,
            history: messages,
            userMessage: message,
          });

          const now = new Date().toISOString();
          const userMsg: ChatMessage = {
            role: "user",
            content: message,
            timestamp: now,
          };
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: result.reply,
            toolCalls: result.toolCallsUsed.length > 0 ? [...result.toolCallsUsed] : undefined,
            timestamp: now,
          };

          yield* Ref.update(state, (prev) => ({
            ...prev,
            messages: [...prev.messages, userMsg, assistantMsg],
          }));

          return {
            reply: result.reply,
            toolCallsUsed: [...result.toolCallsUsed],
          };
        }),
      ).pipe(Effect.orDie),

    chatStream: ({ message }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, messages } = yield* Ref.get(state);
          const { apiKey, model, apiUrl } = yield* resolveLlmConfig;

          const result = yield* executeChatTurn({
            userId,
            apiKey,
            model,
            apiUrl,
            history: messages,
            userMessage: message,
          });

          const now = new Date().toISOString();
          const userMsg: ChatMessage = {
            role: "user",
            content: message,
            timestamp: now,
          };
          const assistantMsg: ChatMessage = {
            role: "assistant",
            content: result.reply,
            toolCalls: result.toolCallsUsed.length > 0 ? [...result.toolCallsUsed] : undefined,
            timestamp: now,
          };

          yield* Ref.update(state, (prev) => ({
            ...prev,
            messages: [...prev.messages, userMsg, assistantMsg],
          }));

          return Stream.fromIterable(result.chunks);
        }),
      ).pipe(Effect.orDie),

    getHistory: () => Ref.get(state).pipe(Effect.map(({ messages }) => [...messages])),

    clearHistory: () =>
      Ref.update(state, (prev) => ({ ...prev, messages: [] })).pipe(Effect.asVoid),

    getRecommendedItems: () =>
      Ref.get(state).pipe(Effect.map(({ recommendedItems }) => recommendedItems)),

    recommendItems: () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId, recommendedItems: prevItems } = yield* Ref.get(state);
          const { apiKey, model, apiUrl } = yield* resolveLlmConfig;

          const updated = yield* executeRecommendItems({
            userId,
            apiKey,
            model,
            apiUrl,
            previousRecommendedItems: prevItems,
          });

          if (!updated) {
            return false;
          }

          yield* Ref.update(state, (prev) => ({
            ...prev,
            recommendedItems: updated,
          }));
          return true;
        }),
      ).pipe(
        Effect.catch((err) =>
          Effect.logWarning(`recommendItems unexpected error: ${err}`).pipe(Effect.as(false)),
        ),
        Effect.orDie,
      ),
  }),
});
