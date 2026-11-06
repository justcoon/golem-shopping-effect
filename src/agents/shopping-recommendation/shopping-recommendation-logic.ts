import { Duration, Effect } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Retry } from "@golemcloud/effect-golem";
import { arrayChunks, getCurrentDatetime, safeJsonStringify } from "../../common/index.js";
import { extractLlmErrorMessage } from "../../ai/index.js";
import { CartAgentDefinition } from "../cart/cart-definition.js";
import { OrderAgent, OrderItem } from "../order/index.js";
import {
  cleanMarkdownJsonString,
  LLMRecommendations,
  RECOMMENDATION_BRAND_COUNT,
  RECOMMENDATION_PRODUCT_COUNT,
  RecommendedItems,
  reduceOrderItems,
} from "./shopping-recommendation-schema.js";

const llmRetryPolicy = Retry.NamedPolicy.named(
  "shopping-recommendation-llm-retry",
  Retry.Policy.exponential(Duration.millis(1000), 2).withJitter(0.2).maxRetries(3),
);

export interface ExecuteRecommendItemsOptions {
  readonly userId: string;
  readonly apiKey: string;
  readonly model: string;
  readonly apiUrl?: string;
  readonly previousRecommendedItems: RecommendedItems;
}

export function executeRecommendItems(options: ExecuteRecommendItemsOptions) {
  return Effect.gen(function* () {
    const { userId, apiKey, model, apiUrl, previousRecommendedItems } = options;
    yield* Effect.logInfo(`Recommend items for user: ${userId}`);

    const cartClient = yield* CartAgentDefinition.client.get({ id: userId }).pipe(Effect.orDie);
    const cart = yield* cartClient.get({}).pipe(Effect.orDie);

    const collectedItems: OrderItem[] = [];

    if (cart && cart.previousOrderIds.length > 0) {
      const idChunks = arrayChunks(cart.previousOrderIds, 5);

      for (const chunk of idChunks) {
        const orderEffects = chunk.map((orderId: string) =>
          Effect.gen(function* () {
            const orderClient = yield* OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);
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

    if (!apiKey) {
      yield* Effect.logWarning(
        "ShoppingRecommendation: LLM API key (GEMINI_API_KEY / OPENROUTER_KEY) is empty or not configured",
      );
      return null;
    }

    const currentItemsString = safeJsonStringify(reducedItems);
    const promptPayload = {
      model,
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

    const endpoint = apiUrl
      ? `${apiUrl.replace(/\/$/, "")}/chat/completions`
      : "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

    const postEffect = HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.setHeaders({
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://golem.cloud",
        "X-Title": "Golem Shopping Effect",
      }),
      HttpClientRequest.bodyText(safeJsonStringify(promptPayload), "application/json"),
      HttpClient.execute,
      Effect.flatMap((response) =>
        Effect.gen(function* () {
          if (response.status >= 200 && response.status < 300) {
            return yield* response.json;
          }
          const bodyText = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")));
          const logMsg = extractLlmErrorMessage(response.status, bodyText);
          return yield* Effect.fail(new Error(`HTTP ${response.status}: ${logMsg}`));
        }),
      ),
      Effect.provide(FetchHttpClient.layer),
    );

    const llmResult = yield* Retry.withPolicy(llmRetryPolicy, postEffect).pipe(
      Effect.catch((err) =>
        Effect.logWarning(`LLM recommendations request failed: ${err}`).pipe(Effect.as(null)),
      ),
    );

    if (!llmResult) {
      return null;
    }

    const choices = (
      llmResult as {
        choices?: Array<{ message?: { content?: string } }>;
      }
    ).choices;

    const concatenated = choices?.map((c) => c.message?.content ?? "").join("") ?? "";
    const llmResponse = cleanMarkdownJsonString(concatenated);

    if (!llmResponse) {
      return null;
    }

    try {
      const parsed = JSON.parse(llmResponse) as LLMRecommendations;
      const date = yield* getCurrentDatetime;
      const updated: RecommendedItems = {
        productIds: parsed.productIds || [],
        productBrands: parsed.productBrands || [],
        createdAt: previousRecommendedItems.createdAt,
        updatedAt: date,
      };
      yield* Effect.logInfo(
        `Recommend items for user: ${userId} - productIds: ${parsed.productIds?.length || 0}, productBrands: ${parsed.productBrands?.length || 0}`,
      );
      return updated;
    } catch (err) {
      yield* Effect.logWarning(
        `LLM recommendations - failed to parse JSON: ${llmResponse}: ${err}`,
      );
      return null;
    }
  });
}
