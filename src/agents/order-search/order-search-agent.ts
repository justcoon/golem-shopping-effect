import { Chunk, DateTime, Effect, Schema, Stream } from "effect";
import { Agents, defineAgent, Http, method } from "@golemcloud/effect-golem";
import { arrayChunks } from "../../common/index.js";
import { Order, OrderAgent, OrderStatus } from "../order/index.js";
import { OrderQueryMatcher } from "./order-query-matcher.js";

function getOrderAgentId(agentName: string): string | undefined {
  const match = agentName.match(/^OrderAgent\("([^"]+)"\)$/);
  return match ? match[1] : undefined;
}

function fetchOrdersByIds(ids: readonly string[]) {
  return Effect.gen(function* () {
    const result: Order[] = [];

    if (ids.length > 0) {
      const idChunks = arrayChunks(ids, 5);
      for (const chunk of idChunks) {
        const orderEffects = chunk.map((id) =>
          Effect.gen(function* () {
            const client = yield* OrderAgent.client.get({ id }).pipe(Effect.orDie);
            return yield* client.get({}).pipe(Effect.orDie);
          }),
        );

        const orders = yield* Effect.all(orderEffects, {
          concurrency: "unbounded",
        });
        for (const order of orders) {
          if (order && order.orderId && order.items) {
            result.push(order);
          }
        }
      }
    }

    return result;
  });
}

function getAllOrderAgentIds() {
  return Effect.gen(function* () {
    const componentId = yield* Agents.resolveComponentId("golem-shopping-effect:effect-main").pipe(
      Effect.catch(() =>
        Agents.getSelfMetadata.pipe(
          Effect.map((meta) => meta.agentId.componentId),
          Effect.catch(() => Effect.succeed(undefined)),
        ),
      ),
    );

    if (!componentId) {
      yield* Effect.logWarning("OrderSearchAgent: ComponentId could not be resolved");
      return [];
    }

    const processedIds = new Set<string>();
    const filter = Agents.Filter.name("starts-with", "OrderAgent(");
    const agentMetadataStream = Agents.getAgents({
      componentId,
      filter,
      precise: true,
    });

    const agentMetadataChunk = yield* Stream.runCollect(agentMetadataStream).pipe(
      Effect.catch((err) =>
        Effect.logWarning(`Failed to stream order agents: ${err}`).pipe(Effect.as(Chunk.empty())),
      ),
    );

    const ids: string[] = [];
    for (const meta of agentMetadataChunk) {
      const rawName = meta.agentId.agentId;
      const oid = getOrderAgentId(rawName);
      if (oid && !processedIds.has(oid)) {
        processedIds.add(oid);
        ids.push(oid);
      }
    }

    return ids;
  });
}

function sortOrdersDesc(orders: Order[]): Order[] {
  return orders.sort((a, b) => {
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
          const orderIds = yield* getAllOrderAgentIds();
          const allOrders = yield* fetchOrdersByIds(orderIds);

          const matcher = query ? new OrderQueryMatcher(query) : null;
          let matched = allOrders.filter((order) => {
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
          });

          matched = sortOrdersDesc(matched);
          const max = limit ?? 20;
          return matched.slice(0, max);
        }),
      ),

    getOrdersByUserId: ({ userId, limit }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const orderIds = yield* getAllOrderAgentIds();
          const allOrders = yield* fetchOrdersByIds(orderIds);
          let matched = allOrders.filter((order) => order.userId === userId);
          matched = sortOrdersDesc(matched);
          const max = limit ?? 20;
          return matched.slice(0, max);
        }),
      ),

    getOrdersByStatus: ({ status, limit }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const orderIds = yield* getAllOrderAgentIds();
          const allOrders = yield* fetchOrdersByIds(orderIds);
          let matched = allOrders.filter((order) => order.orderStatus === status);
          matched = sortOrdersDesc(matched);
          const max = limit ?? 20;
          return matched.slice(0, max);
        }),
      ),

    getRecentOrders: ({ limit }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const orderIds = yield* getAllOrderAgentIds();
          const allOrders = yield* fetchOrdersByIds(orderIds);
          const sorted = sortOrdersDesc(allOrders);
          const max = limit ?? 20;
          return sorted.slice(0, max);
        }),
      ),
  }),
});
