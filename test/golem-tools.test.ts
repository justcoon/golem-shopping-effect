import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import {
  createPiAgentTools,
  createToolFromAgentMethod,
  golemToolToPiAgentTools,
  type GolemToolDefinition,
} from "../src/ai/index.js";
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

  it("derives Pi Agent tools directly from Golem Tool definitions with tool client and parameter binding", async () => {
    let clientCalledWith: Record<string, unknown> | undefined;

    const mockToolClient = {
      getCart: (input: { userId: string }) => {
        clientCalledWith = input;
        return Effect.succeed({ userId: input.userId, items: [] });
      },
      addToCart: (input: { userId: string; productId: string; quantity: number }) => {
        clientCalledWith = input;
        return Effect.succeed({
          userId: input.userId,
          added: input.productId,
          qty: input.quantity,
        });
      },
    };

    const mockToolDefinition = {
      name: "cart-tools",
      model: {
        name: "cart-tools",
        children: {
          "get-cart": {
            name: "get-cart",
            doc: "Get cart",
            body: {
              fields: { "user-id": Schema.String },
              args: [{ name: "user-id", kind: "option", options: { required: true } }],
            },
          },
          "add-to-cart": {
            name: "add-to-cart",
            doc: "Add to cart",
            body: {
              fields: {
                "user-id": Schema.String,
                "product-id": Schema.String,
                quantity: Schema.Number,
              },
              args: [
                { name: "user-id", kind: "option", options: { required: true } },
                { name: "product-id", kind: "option", options: { required: true } },
                { name: "quantity", kind: "option", options: {} },
              ],
            },
          },
        },
      },
      client: () => mockToolClient,
    };

    const piTools = golemToolToPiAgentTools(mockToolDefinition as any, "user-456", undefined, {
      bind: { "user-id": "user-456" },
    });

    assert.strictEqual(piTools.length, 2);
    assert.strictEqual(piTools[0]?.name, "get_cart");
    assert.strictEqual(piTools[1]?.name, "add_to_cart");

    // In get_cart, "user-id" is bound, so parameters properties should not have user_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const getCartParams = piTools[0]?.parameters as any;
    assert.strictEqual(getCartParams.properties?.user_id, undefined);

    // In add_to_cart, parameters should have product_id and quantity, but not user_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addParams = piTools[1]?.parameters as any;
    assert.strictEqual(addParams.properties?.user_id, undefined);
    assert.notStrictEqual(addParams.properties?.product_id, undefined);

    // Test execution invokes tool client with camelCase parameters
    const res = await piTools[1]?.execute("call-1", { product_id: "prod-1", quantity: 2 });
    assert.strictEqual(res?.isError, undefined);
    assert.deepStrictEqual(clientCalledWith, {
      userId: "user-456",
      "user-id": "user-456",
      user_id: "user-456",
      productId: "prod-1",
      "product-id": "prod-1",
      product_id: "prod-1",
      quantity: 2,
    });
    const firstContent = res?.content[0];
    assert.strictEqual(firstContent?.type, "text");
    const data = JSON.parse(firstContent && "text" in firstContent ? firstContent.text : "{}");
    assert.strictEqual(data.userId, "user-456");
    assert.strictEqual(data.added, "prod-1");
    assert.strictEqual(data.qty, 2);
  });

  it("supports passing ToolDefinition directly or overriding client in options", async () => {
    const mockDefinition = {
      name: "custom-tools",
      model: {
        name: "custom-tools",
        children: {
          "do-task": {
            name: "do-task",
            doc: "Do task",
            body: {
              fields: { "task-name": Schema.String },
              args: [{ name: "task-name", kind: "option", options: { required: true } }],
            },
          },
        },
      },
      client: () => ({
        doTask: (input: { taskName: string }) =>
          Effect.succeed({ clientRun: "fromDefinition", task: input.taskName }),
      }),
    };

    // When called with definition directly
    const defaultTools = golemToolToPiAgentTools(
      mockDefinition as unknown as GolemToolDefinition,
      "user-1",
    );
    const defaultRes = await defaultTools[0]?.execute("c1", { task_name: "backup" });
    const defaultData = JSON.parse(
      defaultRes?.content[0] && "text" in defaultRes.content[0] ? defaultRes.content[0].text : "{}",
    );
    assert.strictEqual(defaultData.clientRun, "fromDefinition");
    assert.strictEqual(defaultData.task, "backup");

    // When client is passed via options, it overrides definition.client
    const customClient = {
      doTask: (input: { taskName: string }) =>
        Effect.succeed({ clientRun: "fromOptions", task: input.taskName }),
    };

    const overrideTools = golemToolToPiAgentTools(
      mockDefinition as unknown as GolemToolDefinition,
      "user-1",
      undefined,
      {
        client: customClient,
      },
    );
    const overrideRes = await overrideTools[0]?.execute("c2", { task_name: "cleanup" });
    const overrideData = JSON.parse(
      overrideRes?.content[0] && "text" in overrideRes.content[0]
        ? overrideRes.content[0].text
        : "{}",
    );
    assert.strictEqual(overrideData.clientRun, "fromOptions");
    assert.strictEqual(overrideData.task, "cleanup");
  });

  it("falls back to local handlers when tool client runtime is unavailable in guest world", async () => {
    const guestDefinition = {
      name: "guest-tools",
      model: {
        name: "guest-tools",
        children: {
          "run-action": {
            name: "run-action",
            doc: "Run guest action",
            body: {
              fields: { "action-name": Schema.String },
              args: [{ name: "action-name", kind: "option", options: { required: true } }],
            },
          },
        },
      },
      client: () => {
        throw new Error("tool client runtime is unavailable in this guest world");
      },
      handlers: {
        runAction: (input: { actionName: string }) =>
          Effect.succeed({ executedLocally: true, action: input.actionName }),
      },
    };

    const tools = golemToolToPiAgentTools(
      guestDefinition as unknown as GolemToolDefinition,
      "guest-user",
    );
    assert.strictEqual(tools.length, 1);

    const res = await tools[0]?.execute("c3", { action_name: "index-sync" });
    assert.strictEqual(res?.isError, undefined);
    const data = JSON.parse(
      res?.content[0] && "text" in res.content[0] ? res.content[0].text : "{}",
    );
    assert.strictEqual(data.executedLocally, true);
    assert.strictEqual(data.action, "index-sync");
  });

  it("uses direct handlers when useImpl is true even if client is configured", async () => {
    const dualDefinition = {
      name: "dual-tools",
      model: {
        name: "dual-tools",
        children: {
          "run-test": {
            name: "run-test",
            doc: "Run test action",
            body: {
              fields: { "test-name": Schema.String },
              args: [{ name: "test-name", kind: "option", options: { required: true } }],
            },
          },
        },
      },
      client: () => ({
        runTest: (input: { testName: string }) =>
          Effect.succeed({ mode: "client", name: input.testName }),
      }),
      handlers: {
        runTest: (input: { testName: string }) =>
          Effect.succeed({ mode: "impl", name: input.testName }),
      },
    };

    // With useImpl: true, handlers are used instead of client
    const implTools = golemToolToPiAgentTools(
      dualDefinition as unknown as GolemToolDefinition,
      "user-impl",
      undefined,
      { useImpl: true },
    );
    const res = await implTools[0]?.execute("c4", { test_name: "streaming-test" });
    const data = JSON.parse(
      res?.content[0] && "text" in res.content[0] ? res.content[0].text : "{}",
    );
    assert.strictEqual(data.mode, "impl");
    assert.strictEqual(data.name, "streaming-test");

    // Without useImpl (default), client is used
    const clientTools = golemToolToPiAgentTools(
      dualDefinition as unknown as GolemToolDefinition,
      "user-client",
    );
    const res2 = await clientTools[0]?.execute("c5", { test_name: "streaming-test" });
    const data2 = JSON.parse(
      res2?.content[0] && "text" in res2.content[0] ? res2.content[0].text : "{}",
    );
    assert.strictEqual(data2.mode, "client");
    assert.strictEqual(data2.name, "streaming-test");
  });
});
