import { DateTime, Effect, Schema, Stream } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import { streamAgentIds } from "../../common/agent-discovery.js";
import { Order, OrderAgent, OrderStatus } from "../order/index.js";
import { OrderQueryMatcher } from "./order-query-matcher.js";

function streamAllOrders() {
  return streamAgentIds({ agentPrefix: "OrderAgent" }).pipe(
    Stream.mapEffect(
      (id) =>
        OrderAgent.client.get({ id }).pipe(
          Effect.flatMap((client) => client.get({})),
          Effect.orDie,
        ),
      { concurrency: 10 },
    ),
    Stream.filter((order): order is Order => Boolean(order && order.orderId && order.items)),
  );
}

function sortOrdersDesc(orders: readonly Order[]): Order[] {
  return [...orders].sort((a, b) => {
    const timeA = DateTime.toEpochMillis(a.createdAt);
    const timeB = DateTime.toEpochMillis(b.createdAt);
    return timeB - timeA;
  });
}

export const OrderSearchAgent = defineAgent({
  name: "OrderSearchAgent",
  mode: "ephemeral",
  id: {},
  http: Http.mount("/v1/order-search"),
  methods: {
    searchOrders: method({
      input: {
        query: Schema.optional(Schema.String),
        status: Schema.optional(OrderStatus),
        userId: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.Number),
      },
      success: Schema.Array(Order),
      http: [Http.get("/search?query={query}&status={status}&userId={userId}&limit={limit}")],
      description: "Search orders across system by query string, status, or userId",
    }),

    getOrdersByUserId: method({
      input: {
        userId: Schema.String,
        limit: Schema.optional(Schema.Number),
      },
      success: Schema.Array(Order),
      http: [Http.get("/user/{userId}?limit={limit}")],
      description: "Get orders placed by a specific customer userId",
    }),

    getOrdersByStatus: method({
      input: {
        status: OrderStatus,
        limit: Schema.optional(Schema.Number),
      },
      success: Schema.Array(Order),
      http: [Http.get("/status/{status}?limit={limit}")],
      description: "Get orders filtered by status (new, shipped, cancelled)",
    }),

    getRecentOrders: method({
      input: {
        limit: Schema.optional(Schema.Number),
      },
      success: Schema.Array(Order),
      http: [Http.get("/recent?limit={limit}")],
      description: "List recent orders across the store",
    }),
  },
}).implement({
  init: () => Effect.void,
  methods: () => ({
    searchOrders: ({ query, status, userId, limit }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const matcher = query ? new OrderQueryMatcher(query) : null;
          const matched = yield* streamAllOrders().pipe(
            Stream.filter((order) => {
              if (status && order.orderStatus !== status) {
                return false;
              }
              if (userId && order.userId !== userId) {
                return false;
              }
              if (matcher && !matcher.matches(order)) {
                return false;
              }
              return true;
            }),
            Stream.runCollect,
            Effect.map(sortOrdersDesc),
          );

          const max = limit ?? 20;
          return matched.slice(0, max);
        }),
      ),

    getOrdersByUserId: ({ userId, limit }) =>
      Effect.scoped(
        streamAllOrders().pipe(
          Stream.filter((order) => order.userId === userId),
          Stream.runCollect,
          Effect.map((orders) => sortOrdersDesc(orders).slice(0, limit ?? 20)),
        ),
      ),

    getOrdersByStatus: ({ status, limit }) =>
      Effect.scoped(
        streamAllOrders().pipe(
          Stream.filter((order) => order.orderStatus === status),
          Stream.runCollect,
          Effect.map((orders) => sortOrdersDesc(orders).slice(0, limit ?? 20)),
        ),
      ),

    getRecentOrders: ({ limit }) =>
      Effect.scoped(
        streamAllOrders().pipe(
          Stream.runCollect,
          Effect.map((orders) => sortOrdersDesc(orders).slice(0, limit ?? 20)),
        ),
      ),
  }),
});
