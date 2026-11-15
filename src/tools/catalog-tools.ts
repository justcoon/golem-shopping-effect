import { Effect, Layer, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import { ProductSearchAgent, ProductWithPrice } from "../agents/product-search/index.js";

const getSearchClient = Effect.gen(function* () {
  const client = yield* ProductSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
  return client;
});

export const catalogToolHandlers = {
  searchProducts: ({ query, currency }: { query: string; currency?: string | null }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getSearchClient;
        const res = yield* client
          .searchWithPrices({ query, currency: currency ?? undefined })
          .pipe(Effect.orDie);
        return res.value;
      }),
    ),
  getProductDetails: (input: { "product-id": string; currency?: string | null }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getSearchClient;
        const productId = input["product-id"];
        const currency = input.currency ?? undefined;
        const res = yield* client
          .getByIdsWithPrices({ ids: productId, currency })
          .pipe(Effect.orDie);
        return res.value[0] ?? null;
      }),
    ),
};

export const catalogToolDefinition = Tool.toolDefinition("catalog-tools", {
  doc: "Store catalog tools for searching products and viewing item details",
})
  .command("search-products", (cmd) =>
    cmd.body((b) =>
      b
        .option("query", Schema.String, {
          doc: "Search query string, keywords, or brand",
          required: true,
        })
        .option("currency", Schema.String, {
          doc: "Optional currency code, e.g. USD, EUR",
        })
        .returns(Schema.Array(ProductWithPrice), {
          doc: "Matching products with current prices",
        }),
    ),
  )
  .command("get-product-details", (cmd) =>
    cmd.body((b) =>
      b
        .option("product-id", Schema.String, {
          doc: "Unique product identifier, e.g. 'ap001'",
          required: true,
        })
        .option("currency", Schema.String, {
          doc: "Optional currency code, e.g. USD, EUR",
        })
        .returns(Schema.NullOr(ProductWithPrice), {
          doc: "Product details or null if not found",
        }),
    ),
  );

// Register provider implementation with Golem runtime
catalogToolDefinition.implement(catalogToolHandlers, Layer.empty);

export const catalogTools = Object.assign(catalogToolDefinition, {
  handlers: catalogToolHandlers,
});
