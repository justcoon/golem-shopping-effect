import { Duration, Effect, Redacted, Ref } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { Retry } from "@golemcloud/effect-golem";
import { arrayChunks, getCurrentDatetime } from "../../common/index.js";
import { CartAgentDefinition } from "../cart/index.js";
import { OrderAgent, OrderItem } from "../order/index.js";
import {
  ShoppingAssistantConfig,
  ShoppingAssistantDefinition,
} from "./shopping-assistant-definition.js";
import {
  LLMRecommendations,
  RECOMMENDATION_BRAND_COUNT,
  RECOMMENDATION_INPUT_COUNT,
  RECOMMENDATION_PRODUCT_COUNT,
  RecommendedItems,
} from "./shopping-assistant-schema.js";

interface ShoppingAssistantAgentState {
  readonly userId: string;
  readonly recommendedItems: RecommendedItems;
}

function cleanMarkdownJsonString(input: string): string {
  return input.replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, "$1").trim();
}

function reduceOrderItems(items: readonly OrderItem[]): OrderItem[] {
  const itemMap = new Map<string, OrderItem>();

  for (const item of items) {
    const existing = itemMap.get(item.productId);
    if (existing) {
      itemMap.set(item.productId, {
        ...existing,
        quantity: existing.quantity + item.quantity,
      });
    } else {
      itemMap.set(item.productId, { ...item });
    }
  }

  return Array.from(itemMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, RECOMMENDATION_INPUT_COUNT);
}

const llmRetryPolicy = Retry.NamedPolicy.named(
  "shopping-assistant-llm-retry",
  Retry.Policy.exponential(Duration.millis(400), 2).withJitter(0.15).maxRetries(3),
);

export const ShoppingAssistantAgent = ShoppingAssistantDefinition.implement({
  init: ({ id }) =>
    Effect.gen(function* () {
      const date = yield* getCurrentDatetime;
      return yield* Ref.make<ShoppingAssistantAgentState>({
        userId: id,
        recommendedItems: {
          productIds: [],
          productBrands: [],
          createdAt: date,
          updatedAt: date,
        },
      });
    }),
  methods: (state) => ({
    getRecommendedItems: () =>
      Ref.get(state).pipe(Effect.map(({ recommendedItems }) => recommendedItems)),

    recommendItems: () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { userId } = yield* Ref.get(state);
          yield* Effect.logInfo(`Recommend items for user: ${userId}`);

          const cartClient = yield* CartAgentDefinition.client
            .get({ id: userId })
            .pipe(Effect.orDie);
          const cart = yield* cartClient.get({}).pipe(Effect.orDie);

          const collectedItems: OrderItem[] = [];

          if (cart && cart.previousOrderIds.length > 0) {
            const idChunks = arrayChunks(cart.previousOrderIds, 5);

            for (const chunk of idChunks) {
              const orderEffects = chunk.map((orderId: string) =>
                Effect.gen(function* () {
                  const orderClient = yield* OrderAgent.client
                    .get({ id: orderId })
                    .pipe(Effect.orDie);
                  return yield* orderClient.get({}).pipe(Effect.orDie);
                }),
              );

              const orders = yield* Effect.all(orderEffects, {
                concurrency: "unbounded",
              });
              for (const order of orders) {
                if (order) {
                  collectedItems.push(...order.items);
                }
              }
            }
          }

          const reducedItems = reduceOrderItems(collectedItems);

          const configResolution = Effect.gen(function* () {
            const config = yield* ShoppingAssistantConfig;
            const apiKeySecret = yield* config.llm.apiKey.get;
            const modelSecret = yield* config.llm.model.get;
            return {
              apiKey: Redacted.value(apiKeySecret),
              model: Redacted.value(modelSecret),
            };
          }).pipe(
            Effect.catch(() => Effect.succeed({ apiKey: "", model: "openrouter/owl-alpha" })),
          );

          const { apiKey: apiKeyValue, model: modelValue } = yield* configResolution;

          if (!apiKeyValue) {
            yield* Effect.logWarning(
              "ShoppingAssistant: OPENROUTER_KEY / llm.apiKey is empty or not configured",
            );
            return false;
          }

          const currentItemsString = JSON.stringify(reducedItems);
          const promptPayload = {
            model: modelValue,
            messages: [
              {
                role: "system",
                content: `You MUST respond with JSON in the following schema:
{
  "type": "object",
  "properties": {
    "productBrands": {
      "type": "array",
      "items": {"type": "string"}
    },
    "productIds": {
      "type": "array",
      "items": {"type": "string"}
    }
  },
  "required": ["productBrands", "productIds"],
  "additionalProperties": false
}

Return ONLY valid JSON, no other text.`,
              },
              {
                role: "user",
                content: `We have a list of order items: ${currentItemsString}.
Can you do ${RECOMMENDATION_PRODUCT_COUNT} recommendations for products items to buy based on previous order items.
Can you do ${RECOMMENDATION_BRAND_COUNT} recommendations for product brands to buy based on previous order items.
Return the list of productId-s and list of productBrand-s as a valid JSON object. Return JSON only.`,
              },
            ],
            response_format: { type: "json_object" },
          };

          const postEffect = HttpClientRequest.post(
            "https://openrouter.ai/api/v1/chat/completions",
          ).pipe(
            HttpClientRequest.setHeaders({
              Authorization: `Bearer ${apiKeyValue}`,
              "Content-Type": "application/json",
            }),
            HttpClientRequest.bodyJson(promptPayload),
            Effect.flatMap(HttpClient.execute),
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap((response) => response.json),
            Effect.provide(FetchHttpClient.layer),
          );

          const llmResult = yield* Retry.withPolicy(llmRetryPolicy, postEffect).pipe(
            Effect.catch((err) =>
              Effect.logWarning(`LLM recommendations request failed: ${err}`).pipe(Effect.as(null)),
            ),
          );

          if (!llmResult) {
            return false;
          }

          const choices = (
            llmResult as {
              choices?: Array<{ message?: { content?: string } }>;
            }
          ).choices;

          const concatenated = choices?.map((c) => c.message?.content ?? "").join("") ?? "";
          const llmResponse = cleanMarkdownJsonString(concatenated);

          if (!llmResponse) {
            return false;
          }

          try {
            const parsed = JSON.parse(llmResponse) as LLMRecommendations;
            const date = yield* getCurrentDatetime;
            yield* Ref.update(state, (prev) => ({
              ...prev,
              recommendedItems: {
                productIds: parsed.productIds || [],
                productBrands: parsed.productBrands || [],
                createdAt: prev.recommendedItems.createdAt,
                updatedAt: date,
              },
            }));
            yield* Effect.logInfo(
              `Recommend items for user: ${userId} - productIds: ${parsed.productIds?.length || 0}, productBrands: ${parsed.productBrands?.length || 0}`,
            );
            return true;
          } catch (err) {
            yield* Effect.logWarning(
              `LLM recommendations - failed to parse JSON: ${llmResponse}: ${err}`,
            );
            return false;
          }
        }),
      ).pipe(
        Effect.catch((err) =>
          Effect.logWarning(`recommendItems unexpected error: ${err}`).pipe(Effect.as(false)),
        ),
      ),
  }),
});
