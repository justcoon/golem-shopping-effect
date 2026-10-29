import { Schema } from "effect";
import { defineAgent, defineConfig, Http, method } from "@golemcloud/effect-golem";
import { RecommendedItems } from "./shopping-assistant-schema.js";

export class ShoppingAssistantConfig extends defineConfig("ShoppingAssistantAgent.Config", {
  llm: Schema.Struct({
    apiKey: Schema.Redacted(Schema.String),
    model: Schema.Redacted(Schema.String),
  }),
}) {}

export const ShoppingAssistantDefinition = defineAgent({
  name: "ShoppingAssistantAgent",
  mode: "durable",
  id: { id: Schema.String },
  config: ShoppingAssistantConfig,
  http: Http.mount("/v1/assistant/{id}"),
  methods: {
    getRecommendedItems: method({
      input: {},
      success: RecommendedItems,
      readOnly: true,
      http: [Http.get("/recommended-items")],
      description: "Get recommended items state",
    }),
    recommendItems: method({
      input: {},
      success: Schema.Boolean,
      description: "Recommend items",
    }),
  },
});
