import { Effect, Schema, Stream } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import { CURRENCY, INVENTORY_REGION_DEFAULT, PRICING_REGION_DEFAULT } from "../../common/index.js";
import { streamAgentIds } from "../../common/agent-discovery.js";
import { InventoryAgent } from "../inventory/index.js";
import { PricingAgent, PricingItem } from "../pricing/index.js";
import { Product, ProductAgent } from "../product/index.js";
import { ProductQueryMatcher } from "./product-query-matcher.js";

export const ProductWithPrice = Schema.Struct({
  productId: Schema.String,
  name: Schema.String,
  brand: Schema.String,
  description: Schema.String,
  tags: Schema.Array(Schema.String),
  price: Schema.NullOr(PricingItem),
  availableQuantity: Schema.NullOr(Schema.Number),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type ProductWithPrice = typeof ProductWithPrice.Type;

function fetchProductsByIds(ids: string) {
  return Effect.gen(function* () {
    const productIds = ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    yield* Effect.logInfo(`Get products - ids: (${productIds.join(",")})`);

    if (productIds.length === 0) {
      return [];
    }

    return yield* Stream.fromIterable(productIds).pipe(
      Stream.mapEffect(
        (id) =>
          ProductAgent.client.get({ id }).pipe(
            Effect.flatMap((client) => client.get({})),
            Effect.orDie,
          ),
        { concurrency: 10 },
      ),
      Stream.filter((product): product is Product => Boolean(product)),
      Stream.runCollect,
    );
  });
}

function searchProductsByQuery(query: string) {
  return Effect.gen(function* () {
    yield* Effect.logInfo(`Search products - query: ${query}`);

    const matcher = new ProductQueryMatcher(query);

    return yield* streamAgentIds({ agentPrefix: "ProductAgent" }).pipe(
      Stream.mapEffect(
        (id) =>
          ProductAgent.client.get({ id }).pipe(
            Effect.flatMap((client) => client.get({})),
            Effect.orDie,
          ),
        { concurrency: 10 },
      ),
      Stream.filter((product): product is Product => Boolean(product && matcher.matches(product))),
      Stream.runCollect,
    );
  });
}

function attachPricingToProducts(products: readonly Product[], currency?: string) {
  return Effect.gen(function* () {
    if (products.length === 0) return [];
    const targetCurrency = currency ?? CURRENCY;
    const targetRegion = PRICING_REGION_DEFAULT;
    const inventoryRegion = INVENTORY_REGION_DEFAULT;

    return yield* Stream.fromIterable(products).pipe(
      Stream.mapEffect(
        (product) =>
          Effect.gen(function* () {
            const pricingClient = yield* PricingAgent.client
              .get({ id: product.productId })
              .pipe(Effect.orDie);
            const price = yield* pricingClient
              .getPrice({ currency: targetCurrency, region: targetRegion })
              .pipe(Effect.orDie);

            const invClient = yield* InventoryAgent.client
              .get({ id: product.productId })
              .pipe(Effect.orDie);
            const avail = yield* invClient
              .getAvailableQuantity({ region: inventoryRegion })
              .pipe(Effect.orDie);

            return {
              ...product,
              price: price ?? null,
              availableQuantity: avail.availableQuantity,
            };
          }),
        { concurrency: 10 },
      ),
      Stream.runCollect,
    );
  });
}

export const ProductSearchAgent = defineAgent({
  name: "ProductSearchAgent",
  mode: "ephemeral",
  id: {},
  http: Http.mount("/v1/product"),
  methods: {
    getByIds: method({
      input: { ids: Schema.String },
      success: Schema.Array(Product),
      http: [Http.get("/?ids={ids}")],
      description: "Get products by ids",
    }),
    search: method({
      input: { query: Schema.String },
      success: Schema.Array(Product),
      http: [Http.get("/search?query={query}")],
      description: "Search products",
    }),
    getByIdsWithPrices: method({
      input: {
        ids: Schema.String.annotate({
          description: "Comma-separated list of product IDs from catalog search",
        }),
        currency: Schema.optional(Schema.String).annotate({
          description: "Optional currency code for converted prices, e.g. 'USD' or 'EUR'",
        }),
      },
      success: Schema.Array(ProductWithPrice),
      http: [Http.get("/with-prices?ids={ids}&currency={currency}")],
      description: "Get detailed product information with current pricing by product ID(s).",
      promptHint:
        "Call this to fetch specifications, descriptions, brands, tags, and prices for specific products.",
    }),
    searchWithPrices: method({
      input: {
        query: Schema.String.annotate({
          description: "Search query keyword, e.g. 'earbuds', 'brand:Apple', or 'tag:flagship'",
        }),
        currency: Schema.optional(Schema.String).annotate({
          description: "Optional currency code for pricing, e.g. 'USD' or 'EUR'",
        }),
      },
      success: Schema.Array(ProductWithPrice),
      http: [Http.get("/search-with-prices?query={query}&currency={currency}")],
      description:
        "Search product catalog with keyword, brand, or tag filters including active prices.",
      promptHint:
        "Call this when the user is searching for products, asking recommendations, or looking for item options.",
    }),
  },
}).implement({
  init: () => Effect.void,
  methods: () => ({
    getByIds: ({ ids }) => Effect.scoped(fetchProductsByIds(ids)),
    search: ({ query }) => Effect.scoped(searchProductsByQuery(query)),
    getByIdsWithPrices: ({ ids, currency }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const products = yield* fetchProductsByIds(ids);
          return yield* attachPricingToProducts(products, currency);
        }),
      ),
    searchWithPrices: ({ query, currency }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const products = yield* searchProductsByQuery(query);
          return yield* attachPricingToProducts(products, currency);
        }),
      ),
  }),
});
