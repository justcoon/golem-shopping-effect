import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method, Snapshot } from "@golemcloud/effect-golem";
import { getCurrentDatetime } from "../../common/index.js";
import {
  mergePricingItems,
  mergeSalePricingItems,
  Pricing,
  PricingAgentState,
  PricingItem,
  SalePricingItem,
} from "./pricing-schema.js";

export const PricingAgent = defineAgent({
  name: "PricingAgent",
  mode: "durable",
  id: { id: Schema.String },
  snapshotting: Snapshot.define({
    schema: PricingAgentState,
    policy: Snapshot.policy.everyN(10),
  }),
  http: Http.mount("/v1/pricing/{id}"),
  methods: {
    initializePricing: method({
      input: {
        msrpPrices: Schema.Array(PricingItem),
        listPrices: Schema.Array(PricingItem),
        salePrices: Schema.Array(SalePricingItem),
      },
      success: Schema.Void,
      http: [Http.post("/")],
      description: "Initialize pricing",
    }),
    updatePricing: method({
      input: {
        msrpPrices: Schema.Array(PricingItem),
        listPrices: Schema.Array(PricingItem),
        salePrices: Schema.Array(SalePricingItem),
      },
      success: Schema.Void,
      http: [Http.put("/")],
      description: "Update pricing",
    }),
    getPrice: method({
      input: {
        currency: Schema.String,
        region: Schema.String,
      },
      success: Schema.NullOr(PricingItem),
      readOnly: true,
      description: "Get price by currency and region",
    }),
    get: method({
      input: {},
      success: Schema.NullOr(Pricing),
      readOnly: true,
      http: [Http.get("/")],
      description: "Get pricing",
    }),
  },
}).implement<Ref.Ref<PricingAgentState>>({
  init: ({ id }) =>
    Ref.make<PricingAgentState>({
      productId: id,
      pricing: null,
    }),
  snapshot: Snapshot.ref<PricingAgentState>(),
  methods: (state) => ({
    initializePricing: ({ msrpPrices, listPrices, salePrices }) =>
      Effect.gen(function* () {
        const { productId } = yield* Ref.get(state);
        const date = yield* getCurrentDatetime;
        const pricing: Pricing = {
          productId,
          msrpPrices,
          listPrices,
          salePrices,
          createdAt: date,
          updatedAt: date,
        };
        yield* Ref.update(state, (curr) => ({ ...curr, pricing }));
      }),
    updatePricing: ({ msrpPrices, listPrices, salePrices }) =>
      Effect.gen(function* () {
        const date = yield* getCurrentDatetime;
        yield* Ref.update(state, (curr) => {
          if (!curr.pricing) return curr;
          return {
            ...curr,
            pricing: {
              ...curr.pricing,
              msrpPrices: mergePricingItems(curr.pricing.msrpPrices, msrpPrices),
              listPrices: mergePricingItems(curr.pricing.listPrices, listPrices),
              salePrices: mergeSalePricingItems(curr.pricing.salePrices, salePrices),
              updatedAt: date,
            },
          };
        });
      }),
    getPrice: ({ currency, region }) =>
      Ref.get(state).pipe(
        Effect.map(({ pricing }) => {
          if (!pricing) return null;
          const listPrice = pricing.listPrices.find(
            (p) => p.currency === currency && p.region === region,
          );
          if (listPrice) return listPrice;
          const msrpPrice = pricing.msrpPrices.find(
            (p) => p.currency === currency && p.region === region,
          );
          return msrpPrice ?? null;
        }),
      ),
    get: () => Ref.get(state).pipe(Effect.map(({ pricing }) => pricing)),
  }),
});
