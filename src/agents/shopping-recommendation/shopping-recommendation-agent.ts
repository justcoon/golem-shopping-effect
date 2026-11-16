import { Effect, Ref } from "effect";
import { Snapshot } from "@golemcloud/effect-golem";
import { getCurrentDatetime } from "../../common/index.js";
import {
  ShoppingRecommendationConfig,
  ShoppingRecommendationDefinition,
} from "./shopping-recommendation-definition.js";
import { executeRecommendItems } from "./shopping-recommendation-logic.js";
import { ShoppingRecommendationAgentState } from "./shopping-recommendation-schema.js";

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
          const { llm } = yield* ShoppingRecommendationConfig;

          const updated = yield* executeRecommendItems({
            userId,
            llm,
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
