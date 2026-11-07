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

export const customerOrderTools = Tool.toolDefinition("customer-order-tools", {
  doc: "Customer order tools for viewing order history and specific order status",
})
  .command("get-order-history", (cmd) =>
    cmd.body((b) =>
      b
        .option("user-id", Schema.String, { doc: "Customer user ID" })
        .option("limit", Schema.optional(Schema.Number), {
          doc: "Maximum number of past orders to return",
        })
        .returns(Schema.Array(Order), { doc: "List of orders placed by customer" }),
    ),
  )
  .command("get-order-details", (cmd) =>
    cmd.body((b) =>
      b
        .option("order-id", Schema.String, { doc: "Order ID (e.g. ord-123)" })
        .returns(Schema.NullOr(Order), { doc: "Full details of the order or null if not found" }),
    ),
  )
  .implement(
    {
      getOrderHistory: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getOrderSearchClient;
            const orders = yield* client
              .getOrdersByUserId({
                userId: input["user-id"],
                limit: input.limit,
              })
              .pipe(Effect.orDie);
            return orders;
          }),
        ),
      getOrderDetails: (input) =>
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* getOrderClient(input["order-id"]);
            const order = yield* client.get({}).pipe(Effect.orDie);
            return order;
          }),
        ),
    },
    Layer.empty,
  );
