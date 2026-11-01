import { Schema } from "effect";
import { defineAgent, defineConfig, Http, method, WitTypes } from "@golemcloud/effect-golem";
import {
  ChatChunk,
  ChatMessage,
  ChatResponse,
  RecommendedItems,
} from "./shopping-assistant-schema.js";

export class ShoppingAssistantConfig extends defineConfig("ShoppingAssistantAgent.Config", {
  llm: Schema.Struct({
    apiKey: Schema.Redacted(Schema.String),
    model: Schema.Redacted(Schema.String),
    apiUrl: Schema.Redacted(Schema.String),
  }),
}) {}

export const ShoppingAssistantDefinition = defineAgent({
  name: "ShoppingAssistantAgent",
  mode: "durable",
  id: { id: Schema.String },
  config: ShoppingAssistantConfig,
  http: Http.mount("/v1/assistant/{id}"),
  methods: {
    chat: method({
      input: { message: Schema.String },
      success: ChatResponse,
      http: [Http.post("/chat")],
      description: "Chat synchronously with the shopping assistant",
    }),
    chatStream: method({
      input: { message: Schema.String },
      success: WitTypes.AgentStream(ChatChunk),
      http: [Http.post("/chat-stream")],
      description: "Stream conversational shopping assistant responses and tool activity",
    }),
    getHistory: method({
      input: {},
      success: Schema.Array(ChatMessage),
      readOnly: true,
      http: [Http.get("/history")],
      description: "Get conversation history with shopping assistant",
    }),
    clearHistory: method({
      input: {},
      success: Schema.Void,
      http: [Http.post("/clear-history")],
      description: "Clear conversation history with shopping assistant",
    }),
    getRecommendedItems: method({
      input: {},
      success: RecommendedItems,
      readOnly: true,
      http: [Http.get("/recommended-items"), Http.get("/recommendations")],
      description: "Get recommended items state",
    }),
    recommendItems: method({
      input: {},
      success: Schema.Boolean,
      description: "Recommend items",
    }),
  },
});
