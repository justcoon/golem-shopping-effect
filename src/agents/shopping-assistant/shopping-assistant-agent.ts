import { Effect, Redacted, Ref } from "effect";
import {
  ShoppingAssistantConfig,
  ShoppingAssistantDefinition,
} from "./shopping-assistant-definition.js";
import { executeChatTurn, executeChatTurnStream } from "./shopping-assistant-loop.js";
import { ChatMessage } from "./shopping-assistant-schema.js";

interface ShoppingAssistantAgentState {
  readonly userId: string;
  readonly messages: readonly ChatMessage[];
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
      return yield* Ref.make<ShoppingAssistantAgentState>({
        userId: id,
        messages: [],
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
        const { userId, messages } = yield* Ref.get(state);
        const { apiKey, model, apiUrl } = yield* resolveLlmConfig;

        return executeChatTurnStream({
          userId,
          apiKey,
          model,
          apiUrl,
          history: messages,
          userMessage: message,
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
