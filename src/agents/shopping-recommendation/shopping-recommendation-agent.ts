import { Effect, Redacted, Ref } from "effect";
import { Snapshot } from "@golemcloud/effect-golem";
import { getCurrentDatetime } from "../../common/index.js";
import {
  ShoppingRecommendationConfig,
  ShoppingRecommendationDefinition,
} from "./shopping-recommendation-definition.js";
import { executeRecommendItems } from "./shopping-recommendation-logic.js";
import {
  ShoppingRecommendationAgentState,
} from "./shopping-recommendation-schema.js";

const resolveLlmConfig = Effect.gen(function* () {
  const config = yield* ShoppingRecommendationConfig;
  const apiKey = Redacted.value(yield* config.llm.apiKey.get);
  const model = Redacted.value(yield* config.llm.model.get);
  const apiUrl = Redacted.value(yield* config.llm.apiUrl.get);

  return { apiKey, model, apiUrl };
});

export const ShoppingRecommendationAgent = ShoppingRecommendationDefinition.implement<
  Ref.Ref<ShoppingRecommendationAgentState>
>({
  init: ({ id }) =>
    Effect.gen(function* () {
      const date = yield* getCurrentDatetime;
      return yield* Ref.make<ShoppingRecommendationAgentState>({
        userId: id,
        recommendedItems: {
          productIds: [],
          productBrands: [],
          createdAt: date,
          updatedAt: date,
        },
      });
    }),
  snapshot: Snapshot.ref<ShoppingRecommendationAgentState>(),
  methods: (state) => ({
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
