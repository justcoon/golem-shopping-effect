import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { createPiAgentTools, createToolFromAgentMethod } from "../src/ai/index.js";
import { Cart } from "../src/agents/cart/cart-schema.js";
import { Order, OrderStatus } from "../src/agents/order/order-schema.js";
import { Availability } from "../src/agents/inventory/inventory-schema.js";

describe("Categorized Store Tools & Multi-Agent Reuse", () => {
  const mockProductSearchAgent = {
    name: "ProductSearchAgent",
    mode: "ephemeral",
    methods: {
      searchWithPrices: {
        description: "Search products in catalog with prices",
        input: { query: Schema.String, currency: Schema.optional(Schema.String) },
        success: Schema.Array(
          Schema.Struct({
            productId: Schema.String,
            name: Schema.String,
            brand: Schema.String,
          }),
        ),
      },
      getByIdsWithPrices: {
        description: "Get product details by IDs",
        input: { ids: Schema.String, currency: Schema.optional(Schema.String) },
        success: Schema.Array(
          Schema.Struct({
            productId: Schema.String,
            name: Schema.String,
          }),
        ),
      },
    },
    client: {
      newPhantom: () =>
        Effect.succeed({
          searchWithPrices: () => Effect.succeed({ value: [] }),
          getByIdsWithPrices: () => Effect.succeed({ value: [] }),
        }),
    },
  };

  const mockCartAgent = {
    name: "CartAgent",
    mode: "durable",
    methods: {
      get: {
        description: "Get cart",
        input: {},
        success: Cart,
      },
      addItem: {
        description: "Add item to cart",
        input: { productId: Schema.String, quantity: Schema.Number },
        success: Cart,
      },
    },
    client: {
      get: (_id: { id: string }) =>
        Effect.succeed({
          get: () => Effect.succeed(null),
          addItem: () => Effect.succeed(null),
        }),
    },
  };

  const mockOrderAgent = {
    name: "OrderAgent",
    mode: "durable",
    methods: {
      get: {
        description: "Get order details",
        input: {},
        success: Order,
      },
      shipOrder: {
        description: "Ship order",
        input: {},
        success: Schema.Void,
      },
      cancelOrder: {
        description: "Cancel order",
        input: {},
        success: Schema.Void,
      },
    },
    client: {
      get: (_id: { id: string }) =>
        Effect.succeed({
          get: () => Effect.succeed(null),
          shipOrder: () => Effect.void,
          cancelOrder: () => Effect.void,
        }),
    },
  };

  const mockOrderSearchAgent = {
    name: "OrderSearchAgent",
    mode: "durable",
    methods: {
      getOrdersByUserId: {
        description: "Get orders for customer",
        input: { userId: Schema.String, limit: Schema.optional(Schema.Number) },
        success: Schema.Array(Order),
      },
      searchOrders: {
        description: "Search orders across system",
        input: {
          query: Schema.optional(Schema.String),
          status: Schema.optional(OrderStatus),
          userId: Schema.optional(Schema.String),
        },
        success: Schema.Array(Order),
      },
      getRecentOrders: {
        description: "Get recent orders",
        input: { limit: Schema.optional(Schema.Number) },
        success: Schema.Array(Order),
      },
    },
    client: {
      get: () =>
        Effect.succeed({
          getOrdersByUserId: () => Effect.succeed([]),
          searchOrders: () => Effect.succeed([]),
          getRecentOrders: () => Effect.succeed([]),
        }),
    },
  };

  const mockInventoryAgent = {
    name: "InventoryAgent",
    mode: "durable",
    methods: {
      getAvailableQuantity: {
        description: "Get available quantity in region",
        input: { region: Schema.String },
        success: Availability,
      },
    },
    client: {
      get: (_id: { id: string }) =>
        Effect.succeed({
          getAvailableQuantity: () =>
            Effect.succeed({
              productId: "ap001",
              region: "global",
              availableQuantity: 50,
              totalQuantity: 100,
              allocatedQuantity: 50,
            }),
        }),
    },
  };

  it("derives Catalog Tools with search and details", () => {
    const searchTool = createToolFromAgentMethod(mockProductSearchAgent, "searchWithPrices", {
      toolName: "search_products",
    });
    const detailsTool = createToolFromAgentMethod(mockProductSearchAgent, "getByIdsWithPrices", {
      toolName: "get_product_details",
      extraParameters: { productId: Schema.String },
      mapInput: (args: any) => ({ ids: args.productId, currency: args.currency }),
    });

    assert.strictEqual(searchTool.name, "search_products");
    assert.strictEqual(detailsTool.name, "get_product_details");
  });

  it("derives Cart Tools with explicit userId parameter for public/MCP use", () => {
    const getCartTool = createToolFromAgentMethod(mockCartAgent, "get", {
      toolName: "get_cart",
      extraParameters: { userId: Schema.String },
      resolveId: (_ctx, args: any) => ({ id: args.userId }),
    });
    const addToCartTool = createToolFromAgentMethod(mockCartAgent, "addItem", {
      toolName: "add_to_cart",
      extraParameters: { userId: Schema.String },
      resolveId: (_ctx, args: any) => ({ id: args.userId }),
    });

    assert.strictEqual(getCartTool.name, "get_cart");
    assert.strictEqual(addToCartTool.name, "add_to_cart");
  });

  it("derives Customer Order Tools (history and details)", () => {
    const historyTool = createToolFromAgentMethod(mockOrderSearchAgent, "getOrdersByUserId", {
      toolName: "get_order_history",
    });
    const detailsTool = createToolFromAgentMethod(mockOrderAgent, "get", {
      toolName: "get_order_details",
      extraParameters: { orderId: Schema.String },
      resolveId: (_ctx, args: any) => ({ id: args.orderId }),
    });

    assert.strictEqual(historyTool.name, "get_order_history");
    assert.strictEqual(detailsTool.name, "get_order_details");
  });

  it("derives Manager Order Tools (global search, ship, cancel)", () => {
    const searchOrdersTool = createToolFromAgentMethod(mockOrderSearchAgent, "searchOrders", {
      toolName: "search_orders",
    });
    const shipTool = createToolFromAgentMethod(mockOrderAgent, "shipOrder", {
      toolName: "ship_order",
      extraParameters: { orderId: Schema.String },
      resolveId: (_ctx, args: any) => ({ id: args.orderId }),
    });
    const cancelTool = createToolFromAgentMethod(mockOrderAgent, "cancelOrder", {
      toolName: "cancel_order",
      extraParameters: { orderId: Schema.String },
      resolveId: (_ctx, args: any) => ({ id: args.orderId }),
    });

    assert.strictEqual(searchOrdersTool.name, "search_orders");
    assert.strictEqual(shipTool.name, "ship_order");
    assert.strictEqual(cancelTool.name, "cancel_order");
  });

  it("derives Inventory Tools (check_inventory)", () => {
    const checkInvTool = createToolFromAgentMethod(mockInventoryAgent, "getAvailableQuantity", {
      toolName: "check_inventory",
      extraParameters: { productId: Schema.String },
      resolveId: (_ctx, args: any) => ({ id: args.productId }),
    });

    assert.strictEqual(checkInvTool.name, "check_inventory");
  });

  it("converts categorized tools into Pi Agent tools for Manager and Assistant", () => {
    const tools = [
      createToolFromAgentMethod(mockProductSearchAgent, "searchWithPrices", {
        toolName: "search_products",
      }),
      createToolFromAgentMethod(mockInventoryAgent, "getAvailableQuantity", {
        toolName: "check_inventory",
        extraParameters: { productId: Schema.String },
        resolveId: (_ctx, args: any) => ({ id: args.productId }),
      }),
      createToolFromAgentMethod(mockOrderAgent, "shipOrder", {
        toolName: "ship_order",
        extraParameters: { orderId: Schema.String },
        resolveId: (_ctx, args: any) => ({ id: args.orderId }),
      }),
    ];

    const piTools = createPiAgentTools(tools, "manager-context", undefined, "[StoreToolsTest]");
    assert.strictEqual(piTools.length, 3);
    assert.strictEqual(piTools[0]?.name, "search_products");
    assert.strictEqual(piTools[1]?.name, "check_inventory");
    assert.strictEqual(piTools[2]?.name, "ship_order");
  });
});
