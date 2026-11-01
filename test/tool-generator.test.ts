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

  it("executes successfully and returns Result.Success with formatted summary", async () => {
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
      formatSummary: (res: { city: string }) => `City set to ${res.city}`,
    });

    const output = await Effect.runPromise(
      tool.run({ city: "Prague" }, { userId: "user-42" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.strictEqual(output.summary, "City set to Prague");
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Success");
    assert.deepStrictEqual(parsed.value, { city: "Prague", updated: true });
  });

  it("captures typed method failure as Result.Failure", async () => {
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
    });

    const output = await Effect.runPromise(
      tool.run({}, { userId: "user-42" }) as Effect.Effect<
        { summary: string; resultString: string },
        never,
        never
      >,
    );

    assert.strictEqual(output.summary, "Failed: Cannot checkout an empty cart.");
    const parsed = JSON.parse(output.resultString);
    assert.strictEqual(parsed._tag, "Failure");
    assert.strictEqual(parsed.failure.message, "Cannot checkout an empty cart.");
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
});
