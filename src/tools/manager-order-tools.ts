import { Effect, Layer, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import { Order, OrderAgent, OrderStatus } from "../agents/order/index.js";
import { OrderSearchAgent } from "../agents/order-search/index.js";

const getOrderSearchClient = Effect.gen(function* () {
  const client = yield* OrderSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
  return client;
});

const getOrderClient = (orderId: string) =>
  OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);

export const managerOrderTools = Tool.toolDefinition("manager-order-tools", {
  doc: "Store manager tools for order search, fulfillment, and lifecycle management",
})
  .command("search-orders", (cmd) =>
    cmd.body((b) =>
      b
        .option("query", Schema.optional(Schema.String), {
          doc: "Free-text query across products, email, or customer name",
        })
        .option("status", Schema.optional(OrderStatus), {
          doc: "Filter by order status: 'new', 'shipped', or 'cancelled'",
        })
        .option("user-id", Schema.optional(Schema.String), {
          doc: "Filter by customer user ID",
        })
        .option("limit", Schema.optional(Schema.Number), {
          doc: "Maximum number of orders to return",
        })
        .returns(Schema.Array(Order), { doc: "Matching orders across the system" }),
    ),
  )
  .command("list-recent-orders", (cmd) =>
    cmd.body((b) =>
      b
        .option("limit", Schema.optional(Schema.Number), {
          doc: "Maximum number of recent orders to return (defaults to 10)",
        })
        .returns(Schema.Array(Order), { doc: "Most recent orders placed in the store" }),
    ),
  )
  .command("get-order-details", (cmd) =>
    cmd.body((b) =>
      b
        .option("order-id", Schema.String, { doc: "Order ID (e.g. ord-123)" })
        .returns(Schema.NullOr(Order), { doc: "Order details or null if not found" }),
    ),
  )
  .command("ship-order", (cmd) =>
    cmd.body((b) =>
      b.option("order-id", Schema.String, { doc: "Order ID to fulfill and ship" }).returns(
        Schema.Struct({
          orderId: Schema.String,
          status: Schema.Literal("shipped"),
        }),
        { doc: "Fulfillment confirmation" },
      ),
    ),
  )
  .command("cancel-order", (cmd) =>
    cmd.body((b) =>
      b.option("order-id", Schema.String, { doc: "Order ID to cancel" }).returns(
        Schema.Struct({
          orderId: Schema.String,
          status: Schema.Literal("cancelled"),
        }),
        { doc: "Cancellation confirmation" },
      ),
    ),
  )
  .implement(
    {
      searchOrders: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getOrderSearchClient;
            const res = yield* client
              .searchOrders({
                query: input.query,
                status: input.status,
                userId: input["user-id"],
                limit: input.limit,
              })
              .pipe(Effect.orDie);
            return res;
          }),
        ),
      listRecentOrders: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getOrderSearchClient;
            const res = yield* client.getRecentOrders({ limit: input.limit }).pipe(Effect.orDie);
            return res;
          }),
        ),
      getOrderDetails: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getOrderClient(input["order-id"]);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        ),
      shipOrder: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getOrderClient(input["order-id"]);
            yield* client.shipOrder({}).pipe(Effect.orDie);
            return {
              orderId: input["order-id"],
              status: "shipped" as const,
            };
          }),
        ),
      cancelOrder: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getOrderClient(input["order-id"]);
            yield* client.cancelOrder({}).pipe(Effect.orDie);
            return {
              orderId: input["order-id"],
              status: "cancelled" as const,
            };
          }),
        ),
    },
    Layer.empty,
  );
