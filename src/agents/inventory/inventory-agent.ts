import { Effect, Ref, Schema } from "effect";
import { defineAgent, Http, method } from "@golemcloud/effect-golem";
import { getCurrentDatetime } from "../../common/index.js";
import {
  Availability,
  Inventory,
  InventoryItem,
  mergeInventoryItems,
  OrderAllocation,
  ReserveQuantityError,
} from "./inventory-schema.js";

interface InventoryAgentState {
  readonly productId: string;
  readonly inventory: Inventory | null;
}

export const InventoryAgent = defineAgent({
  name: "InventoryAgent",
  mode: "durable",
  id: { id: Schema.String },
  http: Http.mount("/v1/inventory/{id}"),
  methods: {
    initializeInventory: method({
      input: {
        items: Schema.Array(InventoryItem),
      },
      success: Schema.Void,
      http: [Http.post("/")],
      description: "Initialize inventory with regional quantities",
    }),
    updateInventory: method({
      input: {
        items: Schema.Array(InventoryItem),
      },
      success: Schema.Void,
      http: [Http.put("/")],
      description: "Update inventory regional quantities",
    }),
    get: method({
      input: {},
      success: Schema.NullOr(Inventory),
      readOnly: true,
      http: [Http.get("/")],
      description: "Get full inventory details",
    }),
    getAvailableQuantity: method({
      input: {
        region: Schema.String,
      },
      success: Availability,
      readOnly: true,
      http: [Http.get("/availability?region={region}")],
      description: "Get available quantity in a region",
    }),
    reserveQuantity: method({
      input: {
        orderId: Schema.String,
        region: Schema.String,
        quantity: Schema.Number,
      },
      success: Schema.Void,
      error: ReserveQuantityError,
      description: "Reserve or adjust quantity for an order",
    }),
    releaseReservation: method({
      input: {
        orderId: Schema.String,
      },
      success: Schema.Void,
      description: "Release inventory reservation for an order",
    }),
    fulfillReservation: method({
      input: {
        orderId: Schema.String,
      },
      success: Schema.Void,
      description: "Fulfill reservation for an order upon shipping",
    }),
  },
}).implement({
  init: ({ id }) =>
    Ref.make<InventoryAgentState>({
      productId: id,
      inventory: null,
    }),
  methods: (state) => ({
    initializeInventory: ({ items }) =>
      Effect.gen(function* () {
        const { productId } = yield* Ref.get(state);
        const date = yield* getCurrentDatetime;
        const inventory: Inventory = {
          productId,
          items,
          allocations: [],
          createdAt: date,
          updatedAt: date,
        };
        yield* Ref.update(state, (curr) => ({ ...curr, inventory }));
      }),

    updateInventory: ({ items }) =>
      Effect.gen(function* () {
        const date = yield* getCurrentDatetime;
        yield* Ref.update(state, (curr) => {
          if (!curr.inventory) return curr;
          return {
            ...curr,
            inventory: {
              ...curr.inventory,
              items: mergeInventoryItems(curr.inventory.items, items),
              updatedAt: date,
            },
          };
        });
      }),

    get: () => Ref.get(state).pipe(Effect.map(({ inventory }) => inventory)),

    getAvailableQuantity: ({ region }) =>
      Ref.get(state).pipe(
        Effect.map(({ productId, inventory }) => {
          if (!inventory) {
            return {
              productId,
              region,
              availableQuantity: 0,
              totalQuantity: 0,
              allocatedQuantity: 0,
            };
          }
          const item = inventory.items.find((i) => i.region === region);
          const totalQuantity = item ? item.totalQuantity : 0;
          const allocatedQuantity = inventory.allocations
            .filter((a) => a.region === region)
            .reduce((sum, a) => sum + a.quantity, 0);
          const availableQuantity = Math.max(0, totalQuantity - allocatedQuantity);
          return {
            productId,
            region,
            availableQuantity,
            totalQuantity,
            allocatedQuantity,
          };
        }),
      ),

    reserveQuantity: ({ orderId, region, quantity }) =>
      Effect.gen(function* () {
        const { productId, inventory } = yield* Ref.get(state);
        if (!inventory) {
          return yield* Effect.fail({
            _tag: "inventory-not-found" as const,
            message: `Inventory for product ${productId} not found`,
            productId,
          });
        }

        const item = inventory.items.find((i) => i.region === region);
        const totalQuantity = item ? item.totalQuantity : 0;
        const otherAllocated = inventory.allocations
          .filter((a) => a.region === region && a.orderId !== orderId)
          .reduce((sum, a) => sum + a.quantity, 0);
        const availableForOrder = Math.max(0, totalQuantity - otherAllocated);

        if (quantity > availableForOrder) {
          return yield* Effect.fail({
            _tag: "insufficient-inventory" as const,
            message: `Insufficient inventory for product ${productId} in region ${region}. Requested: ${quantity}, available: ${availableForOrder}`,
            productId,
            region,
            requested: quantity,
            available: availableForOrder,
          });
        }

        const date = yield* getCurrentDatetime;
        const remainingAllocations = inventory.allocations.filter((a) => a.orderId !== orderId);
        const updatedAllocations: OrderAllocation[] =
          quantity > 0
            ? [...remainingAllocations, { orderId, region, quantity, updatedAt: date }]
            : remainingAllocations;

        const updatedInventory: Inventory = {
          ...inventory,
          allocations: updatedAllocations,
          updatedAt: date,
        };

        yield* Ref.update(state, (curr) => ({ ...curr, inventory: updatedInventory }));
      }),

    releaseReservation: ({ orderId }) =>
      Effect.gen(function* () {
        const date = yield* getCurrentDatetime;
        yield* Ref.update(state, (curr) => {
          if (!curr.inventory) return curr;
          const updatedAllocations = curr.inventory.allocations.filter(
            (a) => a.orderId !== orderId,
          );
          return {
            ...curr,
            inventory: {
              ...curr.inventory,
              allocations: updatedAllocations,
              updatedAt: date,
            },
          };
        });
      }),

    fulfillReservation: ({ orderId }) =>
      Effect.gen(function* () {
        const date = yield* getCurrentDatetime;
        yield* Ref.update(state, (curr) => {
          if (!curr.inventory) return curr;
          const orderAllocations = curr.inventory.allocations.filter((a) => a.orderId === orderId);
          if (orderAllocations.length === 0) return curr;

          // Deduct allocated quantities from regional totals
          const deductionMap = new Map<string, number>();
          for (const alloc of orderAllocations) {
            deductionMap.set(alloc.region, (deductionMap.get(alloc.region) ?? 0) + alloc.quantity);
          }

          const updatedItems = curr.inventory.items.map((item) => {
            const deducted = deductionMap.get(item.region) ?? 0;
            return {
              ...item,
              totalQuantity: Math.max(0, item.totalQuantity - deducted),
            };
          });

          const remainingAllocations = curr.inventory.allocations.filter(
            (a) => a.orderId !== orderId,
          );

          return {
            ...curr,
            inventory: {
              ...curr.inventory,
              items: updatedItems,
              allocations: remainingAllocations,
              updatedAt: date,
            },
          };
        });
      }),
  }),
});
