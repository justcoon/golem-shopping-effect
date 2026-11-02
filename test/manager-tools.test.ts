import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { createPiAgentTools, createToolFromAgentMethod } from "../src/ai/index.js";

describe("Manager Tools & AI Tool Generation", () => {
  const mockOrderAgent = {
    name: "OrderAgent",
    methods: {
      shipOrder: {
        description: "Ship an order",
        input: {},
        success: Schema.Void,
        error: Schema.Never,
      },
      cancelOrder: {
        description: "Cancel an order",
        input: {},
        success: Schema.Void,
        error: Schema.Never,
      },
    },
    client: {
      get: (_id: { id: string }) =>
        Effect.succeed({
          shipOrder: () => Effect.void,
          cancelOrder: () => Effect.void,
        }),
    },
  };

  it("derives order lifecycle management tools with extra parameters", () => {
    const shipTool = createToolFromAgentMethod(mockOrderAgent, "shipOrder", {
      toolName: "ship_order",
      description: "Ship an existing new order",
      extraParameters: { orderId: Schema.String },
      resolveId: (_ctx, args) => ({ id: args.orderId }),
    });

    assert.strictEqual(shipTool.name, "ship_order");
    assert.strictEqual(shipTool.description, "Ship an existing new order");

    const cancelTool = createToolFromAgentMethod(mockOrderAgent, "cancelOrder", {
      toolName: "cancel_order",
      description: "Cancel an existing new order",
      extraParameters: { orderId: Schema.String },
      resolveId: (_ctx, args) => ({ id: args.orderId }),
    });

    assert.strictEqual(cancelTool.name, "cancel_order");
    assert.strictEqual(cancelTool.description, "Cancel an existing new order");
  });

  it("converts manager tools into Pi Agent tools with logger namespace", () => {
    const shipTool = createToolFromAgentMethod(mockOrderAgent, "shipOrder", {
      toolName: "ship_order",
      extraParameters: { orderId: Schema.String },
      resolveId: (_ctx, args) => ({ id: args.orderId }),
    });

    const piTools = createPiAgentTools(
      [shipTool],
      { managerId: "mgr-007" },
      undefined,
      "[ManagerAgent]",
    );

    assert.strictEqual(piTools.length, 1);
    const [tool] = piTools;
    assert.ok(tool);
    assert.strictEqual(tool.name, "ship_order");
    assert.strictEqual(tool.label, "Ship Order");
    assert.strictEqual(typeof tool.execute, "function");
  });
});
