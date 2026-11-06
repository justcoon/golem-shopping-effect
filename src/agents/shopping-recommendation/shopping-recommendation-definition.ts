import { Schema } from "effect";
import { defineAgent, defineConfig, Http, method } from "@golemcloud/effect-golem";
import { RecommendedItems } from "./shopping-recommendation-schema.js";

export class ShoppingRecommendationConfig extends defineConfig(
  "ShoppingRecommendationAgent.Config",
  {
    llm: Schema.Struct({
      apiKey: Schema.Redacted(Schema.String),
      model: Schema.Redacted(Schema.String),
      apiUrl: Schema.Redacted(Schema.String),
    }),
  },
) {}

export const ShoppingRecommendationDefinition = defineAgent({
  name: "ShoppingRecommendationAgent",
  mode: "durable",
  id: { id: Schema.String },
  config: ShoppingRecommendationConfig,
  http: Http.mount("/v1/recommendation/{id}"),
  methods: {
    getRecommendedItems: method({
      input: {},
      success: RecommendedItems,
      readOnly: true,
      http: [Http.get("/recommended-items")],
      description: "Get personalized recommended items for a user",
    }),
    recommendItems: method({
      input: {},
      success: Schema.Boolean,
      description: "Generate and store updated recommendations based on past order history",
    }),
  },
});
