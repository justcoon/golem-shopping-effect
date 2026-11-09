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

export const managerOrderToolHandlers = {
  searchOrders: (input: {
    query?: string | null;
    status?: typeof OrderStatus.Type | null;
    "user-id"?: string | null;
    limit?: number | null;
  }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getOrderSearchClient;
        const res = yield* client
          .searchOrders({
            query: input.query ?? undefined,
            status: input.status ?? undefined,
            userId: input["user-id"] ?? undefined,
            limit: input.limit ?? undefined,
          })
          .pipe(Effect.orDie);
        return res;
      }),
    ),
  listRecentOrders: (input: { limit?: number | null }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getOrderSearchClient;
        const res = yield* client
          .getRecentOrders({ limit: input.limit ?? undefined })
          .pipe(Effect.orDie);
        return res;
      }),
    ),
  getOrderDetails: (input: { "order-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getOrderClient(input["order-id"]);
        return yield* client.get({}).pipe(Effect.orDie);
      }),
    ),
  shipOrder: (input: { "order-id": string }) =>
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
  cancelOrder: (input: { "order-id": string }) =>
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
};

export const managerOrderToolDefinition = Tool.toolDefinition("manager-order-tools", {
  doc: "Store manager tools for order search, fulfillment, and lifecycle management",
})
  .command("search-orders", (cmd) =>
    cmd.body((b) =>
      b
        .option("query", Schema.String, {
          doc: "Free-text query across products, email, or customer name",
        })
        .option("status", OrderStatus, {
          doc: "Filter by order status: 'new', 'shipped', or 'cancelled'",
        })
        .option("user-id", Schema.String, {
          doc: "Filter by customer user ID",
        })
        .option("limit", Schema.Number, {
          doc: "Maximum number of orders to return",
        })
        .returns(Schema.Array(Order), { doc: "Matching orders across the system" }),
    ),
  )
  .command("list-recent-orders", (cmd) =>
    cmd.body((b) =>
      b
        .option("limit", Schema.Number, {
          doc: "Maximum number of recent orders to return (defaults to 10)",
        })
        .returns(Schema.Array(Order), { doc: "Most recent orders placed in the store" }),
    ),
  )
  .command("get-order-details", (cmd) =>
    cmd.body((b) =>
      b
        .option("order-id", Schema.String, {
          doc: "Order ID (e.g. ord-123)",
          required: true,
        })
        .returns(Schema.NullOr(Order), { doc: "Order details or null if not found" }),
    ),
  )
  .command("ship-order", (cmd) =>
    cmd.body((b) =>
      b
        .option("order-id", Schema.String, {
          doc: "Order ID to fulfill and ship",
          required: true,
        })
        .returns(
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
      b
        .option("order-id", Schema.String, {
          doc: "Order ID to cancel",
          required: true,
        })
        .returns(
          Schema.Struct({
            orderId: Schema.String,
            status: Schema.Literal("cancelled"),
          }),
          { doc: "Cancellation confirmation" },
        ),
    ),
  );

// Register provider implementation with Golem runtime
managerOrderToolDefinition.implement(managerOrderToolHandlers, Layer.empty);

export const managerOrderTools = managerOrderToolDefinition;
