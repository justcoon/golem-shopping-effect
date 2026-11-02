import { Chunk, Effect, Schema, Stream } from "effect";
import { Agents, defineAgent, Http, method } from "@golemcloud/effect-golem";
import {
  arrayChunks,
  CURRENCY,
  INVENTORY_REGION_DEFAULT,
  PRICING_REGION_DEFAULT,
} from "../../common/index.js";
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
  availableQuantity: Schema.optional(Schema.Number),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type ProductWithPrice = typeof ProductWithPrice.Type;

function getProductAgentId(agentName: string): string | undefined {
  const match = agentName.match(/^ProductAgent\("([^"]+)"\)$/);
  return match ? match[1] : undefined;
}

function fetchProductsByIds(ids: string) {
  return Effect.gen(function* () {
    const productIds = ids
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    yield* Effect.logInfo(`Get products - ids: (${productIds.join(",")})`);
    const result: Product[] = [];

    if (productIds.length > 0) {
      const idChunks = arrayChunks(productIds, 5);
      for (const chunk of idChunks) {
        const productEffects = chunk.map((id) =>
          Effect.gen(function* () {
            const client = yield* ProductAgent.client.get({ id }).pipe(Effect.orDie);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        );

        const products = yield* Effect.all(productEffects, {
          concurrency: "unbounded",
        });
        for (const product of products) {
          if (product) {
            result.push(product);
          }
        }
      }
    }

    return result;
  });
}

function searchProductsByQuery(query: string) {
  return Effect.gen(function* () {
    yield* Effect.logInfo(`Search products - query: ${query}`);

    const componentId = yield* Agents.resolveComponentId("golem-shopping-effect:effect-main").pipe(
      Effect.catch(() =>
        Agents.getSelfMetadata.pipe(
          Effect.map((meta) => meta.agentId.componentId),
          Effect.catch(() => Effect.succeed(undefined)),
        ),
      ),
    );

    if (!componentId) {
      yield* Effect.logWarning("ProductSearchAgent: ComponentId could not be resolved");
      return [];
    }

    const matcher = new ProductQueryMatcher(query);
    const result: Product[] = [];
    const processedIds = new Set<string>();

    const filter = Agents.Filter.name("starts-with", "ProductAgent(");
    const agentMetadataStream = Agents.getAgents({
      componentId,
      filter,
      precise: true,
    });

    const agentMetadataChunk = yield* Stream.runCollect(agentMetadataStream).pipe(
      Effect.catch((err) =>
        Effect.logWarning(`Failed to stream agents: ${err}`).pipe(Effect.as(Chunk.empty())),
      ),
    );

    const ids: string[] = [];
    for (const meta of agentMetadataChunk) {
      const rawName = meta.agentId.agentId;
      const pid = getProductAgentId(rawName);
      if (pid && !processedIds.has(pid)) {
        processedIds.add(pid);
        ids.push(pid);
      }
    }

    if (ids.length > 0) {
      const idChunks = arrayChunks(ids, 5);
      for (const chunk of idChunks) {
        const fetchEffects = chunk.map((id) =>
          Effect.gen(function* () {
            const client = yield* ProductAgent.client.get({ id }).pipe(Effect.orDie);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        );

        const products = yield* Effect.all(fetchEffects, {
          concurrency: "unbounded",
        });
        for (const product of products) {
          if (product && matcher.matches(product)) {
            result.push(product);
          }
        }
      }
    }

    return result;
  });
}

function attachPricingToProducts(products: readonly Product[], currency?: string) {
  return Effect.gen(function* () {
    if (products.length === 0) return [];
    const targetCurrency = currency ?? CURRENCY;
    const targetRegion = PRICING_REGION_DEFAULT;
    const inventoryRegion = INVENTORY_REGION_DEFAULT;
    const chunks = arrayChunks(products, 5);
    const enriched: ProductWithPrice[] = [];
    for (const chunk of chunks) {
      const pricingEffects = chunk.map((product) =>
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
      );
      const results = yield* Effect.all(pricingEffects, { concurrency: "unbounded" });
      enriched.push(...results);
    }
    return enriched;
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
          description: "Comma-separated list of product IDs, e.g. 'ap001,sm002'",
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
