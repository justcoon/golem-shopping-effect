import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Result, Schema } from "effect";
import {
  camelToSnake,
  createToolFromAgentMethod,
  createToolsFromAgent,
} from "../src/agents/shopping-assistant/shopping-assistant-tool-generator.js";

describe("Tool Generator (shopping-assistant-tool-generator)", () => {
  it("converts camelCase method names to snake_case tool names", () => {
    assert.strictEqual(camelToSnake("updateBillingAddress"), "update_billing_address");
    assert.strictEqual(camelToSnake("clear"), "clear");
    assert.strictEqual(camelToSnake("applySavedContactInfo"), "apply_saved_contact_info");
    assert.strictEqual(camelToSnake("updateItemQuantity"), "update_item_quantity");
  });

  it("derives tool definition from agent method specification", () => {
    const mockAgent = {
      name: "CartAgent",
      methods: {
        updateEmail: {
          description: "Update email address",
          promptHint:
            "Update customer contact email address for order notifications and receipt delivery.",
          input: {
            email: Schema.String.annotate({ description: "Customer email address" }),
          },
          success: Schema.Void,
          error: Schema.Never,
        },
      },
      client: {
        get: (_id: { id: string }) =>
          Effect.succeed({
            updateEmail: () => Effect.void,
          }),
      },
    };

    const tool = createToolFromAgentMethod(mockAgent, "updateEmail", {
      resolveId: (ctx) => ({ id: ctx.userId }),
    });

    assert.strictEqual(tool.name, "update_email");
    assert.strictEqual(
      tool.description,
      "Update customer contact email address for order notifications and receipt delivery.",
    );
    assert.ok(tool.parameters);
  });

  it("supports custom toolName and custom description", () => {
    const mockAgent = {
      name: "CartAgent",
      methods: {
        clear: {
          description: "Clear cart",
          promptHint: "Empty the cart",
          input: {},
          success: Schema.Void,
          error: Schema.Never,
        },
      },
      client: {
        get: (_id: { id: string }) =>
          Effect.succeed({
            clear: () => Effect.void,
          }),
      },
    };

    const tool = createToolFromAgentMethod(mockAgent, "clear", {
      toolName: "empty_cart",
      description: "Custom description for emptying cart",
      resolveId: (ctx) => ({ id: ctx.userId }),
    });

    assert.strictEqual(tool.name, "empty_cart");
    assert.strictEqual(tool.description, "Custom description for emptying cart");
  });

  it("executes successfully and receives Result.Success in formatSummary", async () => {
    const mockAgent = {
      name: "MockAgent",
      methods: {
        updateCity: {
          description: "Update city in profile",
          promptHint: "Update user city",
          input: {
            city: Schema.String,
          },
          success: Schema.Struct({
            city: Schema.String,
            updated: Schema.Boolean,
          }),
          error: Schema.Never,
        },
      },
      client: {
        get: (_id: { id: string }) =>
          Effect.succeed({
            updateCity: ({ city }: { city: string }) =>
              Effect.succeed({
                city,
                updated: true,
              }),
          }),
      },
    };

    const tool = createToolFromAgentMethod(mockAgent, "updateCity", {
      resolveId: (ctx) => ({ id: ctx.userId }),
      formatSummary: (result, args) =>
        Result.isSuccess(result)
          ? `City set to ${result.success.city} for user input ${args.city}`
          : "Update failed",
    });

    const output = await Effect.runPromise(
      tool.run({ city: "Prague" }, { userId: "user-42" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.strictEqual(output.summary, "City set to Prague for user input Prague");
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Success");
    assert.deepStrictEqual(parsed.value, { city: "Prague", updated: true });
  });

  it("captures typed method failure as Result.Failure and formats summary", async () => {
    const mockAgent = {
      name: "MockAgent",
      methods: {
        checkout: {
          description: "Checkout",
          input: {},
          success: Schema.Struct({ id: Schema.String }),
          error: Schema.Struct({ _tag: Schema.Literal("CartEmpty"), message: Schema.String }),
        },
      },
      client: {
        get: (_id: { id: string }) =>
          Effect.succeed({
            checkout: () =>
              Effect.fail({
                _tag: "CartEmpty",
                message: "Cannot checkout an empty cart.",
              }),
          }),
      },
    };

    const tool = createToolFromAgentMethod(mockAgent, "checkout", {
      resolveId: (ctx) => ({ id: ctx.userId }),
      formatSummary: (result) =>
        Result.isSuccess(result)
          ? `Checked out: ${result.success.id}`
          : `Custom error: ${result.failure.message}`,
    });

    const output = await Effect.runPromise(
      tool.run({}, { userId: "user-42" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.strictEqual(output.summary, "Custom error: Cannot checkout an empty cart.");
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Failure");
    assert.strictEqual(parsed.failure.message, "Cannot checkout an empty cart.");
  });

  it("supports ephemeral agent clients via newPhantom", async () => {
    let newPhantomCalled = false;
    const ephemeralAgent = {
      name: "EphemeralSearchAgent",
      methods: {
        search: {
          description: "Search items",
          input: { query: Schema.String },
          success: Schema.Array(Schema.String),
          error: Schema.Never,
        },
      },
      client: {
        newPhantom: () => {
          newPhantomCalled = true;
          return Effect.succeed({
            search: ({ query }: { query: string }) =>
              Effect.succeed([`match-1-for-${query}`, `match-2-for-${query}`]),
          });
        },
      },
    };

    const tool = createToolFromAgentMethod(ephemeralAgent, "search", {
      toolName: "search_items",
      formatSummary: (result, args) =>
        Result.isSuccess(result)
          ? `Found ${result.success.length} results for '${args.query}'`
          : "Search failed",
    });

    const output = await Effect.runPromise(
      tool.run({ query: "wireless" }, { userId: "user-100" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.strictEqual(newPhantomCalled, true);
    assert.strictEqual(output.summary, "Found 2 results for 'wireless'");
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Success");
    assert.deepStrictEqual(parsed.value, ["match-1-for-wireless", "match-2-for-wireless"]);
  });

  it("supports extraParameters, argument-derived ID resolution, and mapInput", async () => {
    let resolvedId: string | undefined;
    const keyedOrderAgent = {
      name: "OrderAgent",
      methods: {
        get: {
          description: "Get order by instance id",
          input: {},
          success: Schema.Struct({ orderId: Schema.String, status: Schema.String }),
          error: Schema.Never,
        },
      },
      client: {
        get: (id: { id: string }) => {
          resolvedId = id.id;
          return Effect.succeed({
            get: () => Effect.succeed({ orderId: id.id, status: "SHIPPED" }),
          });
        },
      },
    };

    const tool = createToolFromAgentMethod(keyedOrderAgent, "get", {
      toolName: "get_order_details",
      extraParameters: {
        orderId: Schema.String.annotate({ description: "Target order ID" }),
      },
      resolveId: (_ctx, args) => ({ id: args.orderId }),
      formatSummary: (result) =>
        Result.isSuccess(result)
          ? `Order ${result.success.orderId} is ${result.success.status}`
          : "Not found",
    });

    const output = await Effect.runPromise(
      tool.run({ orderId: "ord-999" }, { userId: "user-100" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.strictEqual(resolvedId, "ord-999");
    assert.strictEqual(output.summary, "Order ord-999 is SHIPPED");
  });

  it("handles input validation errors gracefully with Result.Failure", async () => {
    const mockAgent = {
      name: "MockAgent",
      methods: {
        setCount: {
          description: "Set count",
          input: {
            count: Schema.Number,
          },
          success: Schema.Void,
          error: Schema.Never,
        },
      },
      client: {
        get: (_id: { id: string }) =>
          Effect.succeed({
            setCount: () => Effect.void,
          }),
      },
    };

    const tool = createToolFromAgentMethod(mockAgent, "setCount", {
      resolveId: (ctx) => ({ id: ctx.userId }),
    });

    // Pass invalid type (string instead of number)
    const output = await Effect.runPromise(
      tool.run({ count: "not-a-number" }, { userId: "user-42" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.ok(output.summary.startsWith("Failed: Invalid arguments for tool 'set_count':"));
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Failure");
    assert.strictEqual(parsed.failure._tag, "ValidationFailed");
  });

  it("batch creates multiple tools using createToolsFromAgent", () => {
    const mockAgent = {
      name: "CartAgent",
      methods: {
        clear: {
          description: "Clear cart",
          input: {},
          success: Schema.Void,
          error: Schema.Never,
        },
        updateEmail: {
          description: "Update email",
          input: { email: Schema.String },
          success: Schema.Void,
          error: Schema.Never,
        },
      },
      client: {
        get: (_id: { id: string }) => Effect.succeed({}),
      },
    };

    const tools = createToolsFromAgent(mockAgent, {
      resolveId: (ctx) => ({ id: ctx.userId }),
      methods: {
        clear: { toolName: "empty_cart" },
        updateEmail: {},
      },
    });

    assert.strictEqual(tools.length, 2);
    assert.strictEqual(tools[0]!.name, "empty_cart");
    assert.strictEqual(tools[1]!.name, "update_email");
  });

  it("prioritizes client.get(id) over client.newPhantom when resolveId is provided", async () => {
    let getCalledWithId: unknown = undefined;
    let newPhantomCalled = false;

    // Like real Golem agent definitions, both get and newPhantom exist on client
    const durableAgentWithBoth = {
      name: "CartAgent",
      mode: "durable",
      methods: {
        get: {
          description: "Get cart",
          input: {},
          success: Schema.Struct({ items: Schema.Array(Schema.String), total: Schema.Number }),
          error: Schema.Never,
        },
      },
      client: {
        get: (id: { id: string }) => {
          getCalledWithId = id;
          return Effect.succeed({
            get: () => Effect.succeed({ items: ["prod-1"], total: 99 }),
          });
        },
        newPhantom: () => {
          newPhantomCalled = true;
          return Effect.fail(new Error("newPhantom should not be called for durable agent!"));
        },
      },
    };

    const tool = createToolFromAgentMethod(durableAgentWithBoth, "get", {
      toolName: "get_cart",
      resolveId: ({ userId }) => ({ id: userId }),
      formatSummary: (result) =>
        Result.isSuccess(result)
          ? `Cart has ${result.success.items.length} items (total: $${result.success.total})`
          : "Failed",
    });

    const output = await Effect.runPromise(
      tool.run({}, { userId: "u001" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.strictEqual(newPhantomCalled, false, "newPhantom should not be called");
    assert.deepStrictEqual(getCalledWithId, { id: "u001" });
    assert.strictEqual(output.summary, "Cart has 1 items (total: $99)");
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Success");
    assert.deepStrictEqual(parsed.value, { items: ["prod-1"], total: 99 });
  });

  it("populates missing optional method input arguments with undefined to avoid Golem encode SchemaError", async () => {
    let capturedMethodArgs: any;
    const searchAgent = {
      name: "ProductSearchAgent",
      mode: "ephemeral",
      methods: {
        searchWithPrices: {
          description: "Search products with prices",
          input: {
            query: Schema.String,
            currency: Schema.optional(Schema.String),
          },
          success: Schema.Array(Schema.String),
          error: Schema.Never,
        },
      },
      client: {
        newPhantom: () =>
          Effect.succeed({
            searchWithPrices: (args: any) => {
              capturedMethodArgs = args;
              return Effect.succeed(["item-1"]);
            },
          }),
      },
    };

    const tool = createToolFromAgentMethod(searchAgent, "searchWithPrices", {
      toolName: "search_products",
    });

    // Caller passes only { query: "PlayStation 5" }, omitting optional currency
    const output = await Effect.runPromise(
      tool.run({ query: "PlayStation 5" }, { userId: "u001" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.ok(capturedMethodArgs, "method should be called");
    assert.strictEqual(capturedMethodArgs.query, "PlayStation 5");
    assert.strictEqual(
      "currency" in capturedMethodArgs,
      true,
      "currency key should exist in arguments",
    );
    assert.strictEqual(capturedMethodArgs.currency, undefined);
    assert.strictEqual(output.summary, "Completed search_products");
  });

  it("passes empty record {} to client.get when resolveId is omitted for durable singleton agents", async () => {
    let getCalledWithId: unknown = "not-called";

    const singletonAgent = {
      name: "OrderSearchAgent",
      mode: "durable",
      methods: {
        getRecentOrders: {
          description: "Get recent orders",
          input: {
            limit: Schema.optional(Schema.Number),
          },
          success: Schema.Array(Schema.String),
          error: Schema.Never,
        },
      },
      client: {
        get: (id: unknown) => {
          getCalledWithId = id;
          return Effect.succeed({
            getRecentOrders: (_args: unknown) => Effect.succeed(["order-1", "order-2"]),
          });
        },
      },
    };

    const tool = createToolFromAgentMethod(singletonAgent, "getRecentOrders", {
      toolName: "list_recent_orders",
    });

    const output = await Effect.runPromise(
      tool.run({ limit: 5 }, { userId: "admin" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.deepStrictEqual(getCalledWithId, {});
    assert.strictEqual(output.summary, "Completed list_recent_orders");
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Success");
    assert.deepStrictEqual(parsed.value, ["order-1", "order-2"]);
  });
});
