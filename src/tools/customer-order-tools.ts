import { Effect, Layer, Schema } from "effect";
import { Tool } from "@golemcloud/effect-golem";
import { Order, OrderAgent } from "../agents/order/index.js";
import { OrderSearchAgent } from "../agents/order-search/index.js";

const getOrderSearchClient = Effect.gen(function* () {
  const client = yield* OrderSearchAgent.client.newPhantom({}).pipe(Effect.orDie);
  return client;
});

const getOrderClient = (orderId: string) =>
  OrderAgent.client.get({ id: orderId }).pipe(Effect.orDie);

export const customerOrderToolHandlers = {
  getOrderHistory: (input: { "user-id": string; limit?: number | null }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getOrderSearchClient;
        const res = yield* client
          .getOrdersByUserId({
            userId: input["user-id"],
            limit: input.limit ?? undefined,
          })
          .pipe(Effect.orDie);
        return res.value;
      }),
    ),
  getOrderDetails: (input: { "order-id": string }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* getOrderClient(input["order-id"]);
        const order = yield* client.get({}).pipe(Effect.orDie);
        return order;
      }),
    ),
};

export const customerOrderToolDefinition = Tool.toolDefinition("customer-order-tools", {
  doc: "Customer order tools for viewing order history and specific order status",
})
  .command("get-order-history", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID", required: true })
        .option("limit", Schema.Number, {
          doc: "Maximum number of past orders to return",
        })
        .returns(Schema.Array(Order), { doc: "List of orders placed by customer" }),
    ),
  )
  .command("get-order-details", (cmd) =>
    cmd.body((b) =>
      b
        .option("order-id", Schema.String, { doc: "Order ID (e.g. ord-123)", required: true })
        .returns(Schema.NullOr(Order), {
          doc: "Full details of the order or null if not found",
        }),
    ),
  );

// Register provider implementation with Golem runtime
customerOrderToolDefinition.implement(customerOrderToolHandlers, Layer.empty);

export const customerOrderTools = Object.assign(customerOrderToolDefinition, {
  handlers: customerOrderToolHandlers,
});
