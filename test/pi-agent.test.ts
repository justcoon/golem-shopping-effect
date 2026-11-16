import test from "node:test";
import assert from "node:assert/strict";
import { Schema, Effect, Context } from "effect";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import {
  createPiAgentTools,
  type AssistantToolLike,
} from "../src/agents/shopping-assistant/shopping-assistant-pi-tools.js";
import { buildInitialAgentMessages } from "../src/ai/agent-loop.js";
import type { ChatMessage } from "../src/ai/ai-schema.js";

const MockSearchArgs = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query" }),
});

const mockSearchTool: AssistantToolLike<typeof MockSearchArgs.Type> = {
  name: "search_products",
  description: "Search products in catalog",
  parameters: MockSearchArgs,
  run: (args: typeof MockSearchArgs.Type, ctx) =>
    Effect.succeed({
      summary: `Found 2 products for user ${ctx.userId}`,
      resultString: JSON.stringify([{ id: "p1", name: args.query }]),
    }),
};

test("createPiAgentTools creates valid AgentTool array from tool definitions", async () => {
  const tools = createPiAgentTools([mockSearchTool], "user-123");
  assert.equal(tools.length, 1);

  const searchTool = tools[0]!;
  assert.equal(searchTool.name, "search_products");
  assert.equal(searchTool.label, "Search Products");
  assert.equal(searchTool.description, "Search products in catalog");
  assert.ok(searchTool.parameters);

  // Execute the tool and verify output format expected by Pi Agent
  const result = await searchTool.execute("call-1", { query: "headphones" });
  assert.deepEqual(result.content, [{ type: "text", text: '[{"id":"p1","name":"headphones"}]' }]);
  assert.equal(result.details.summary, "Found 2 products for user user-123");
  assert.equal(result.isError, undefined);
});

test("Pi Agent executes turn with mock model, tool calls, and event stream", async () => {
  const dummyModel: Model<"openai-completions"> = {
    id: "test-model",
    name: "Test Model",
    api: "openai-completions",
    provider: "test-provider",
    baseUrl: "https://example.com",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10000,
    maxTokens: 1000,
    type: "chat",
  };

  const tools = createPiAgentTools([mockSearchTool], "user-456");

  let streamCallCount = 0;
  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a shopping assistant.",
      model: dummyModel,
      tools,
      messages: [],
    },
    streamFn: () => {
      streamCallCount++;
      const stream = createAssistantMessageEventStream();

      setTimeout(() => {
        if (streamCallCount === 1) {
          // First call: model decides to call tool search_products
          const toolCallMsg = {
            role: "assistant" as const,
            content: [
              {
                type: "toolCall" as const,
                id: "call-xyz",
                name: "search_products",
                arguments: { query: "wireless earbuds" },
              },
            ],
            api: "openai-completions" as const,
            provider: "test-provider",
            model: "test-model",
            usage: {
              input: 15,
              output: 10,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 25,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "toolUse" as const,
            timestamp: Date.now(),
          };

          stream.push({
            type: "start",
            partial: toolCallMsg,
          });
          stream.push({
            type: "toolcall_start",
            contentIndex: 0,
            partial: toolCallMsg,
          });
          stream.push({
            type: "toolcall_end",
            contentIndex: 0,
            toolCall: {
              type: "toolCall",
              id: "call-xyz",
              name: "search_products",
              arguments: { query: "wireless earbuds" },
            },
            partial: toolCallMsg,
          });
          stream.end(toolCallMsg);
        } else {
          // Second call: model sees tool result and replies to user
          const finalMsg = {
            role: "assistant" as const,
            content: [{ type: "text" as const, text: "I found wireless earbuds for you!" }],
            api: "openai-completions" as const,
            provider: "test-provider",
            model: "test-model",
            usage: {
              input: 25,
              output: 10,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 35,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop" as const,
            timestamp: Date.now(),
          };

          stream.push({
            type: "start",
            partial: finalMsg,
          });
          stream.push({
            type: "text_start",
            contentIndex: 0,
            partial: finalMsg,
          });
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "I found wireless earbuds for you!",
            partial: finalMsg,
          });
          stream.push({
            type: "text_end",
            contentIndex: 0,
            content: "I found wireless earbuds for you!",
            partial: finalMsg,
          });
          stream.end(finalMsg);
        }
      }, 10);

      return stream;
    },
  });

  const events: string[] = [];
  agent.subscribe((event) => {
    events.push(event.type);
  });

  await agent.prompt("Search earbuds");

  assert.ok(events.includes("tool_execution_start"), "Should have emitted tool_execution_start");
  assert.ok(events.includes("tool_execution_end"), "Should have emitted tool_execution_end");
  assert.ok(events.includes("message_update"), "Should have emitted message_update");

  // Verify the agent completed both turns (tool call and final answer)
  assert.equal(streamCallCount, 2);
  const lastMsg = agent.state.messages[agent.state.messages.length - 1];
  assert.equal(lastMsg?.role, "assistant");
  assert.deepEqual(lastMsg?.content, [{ type: "text", text: "I found wireless earbuds for you!" }]);
});

test("createPiAgentTools propagates ambient Context to tool execution", async () => {
  interface DummyServiceShape {
    readonly value: string;
  }
  class DummyService extends Context.Service<DummyService, DummyServiceShape>()("DummyService") {}

  const serviceRequiringTool: AssistantToolLike<{ item: string }> = {
    name: "service_tool",
    description: "Uses a context service",
    parameters: Schema.Struct({ item: Schema.String }),
    run: (args, ctx) =>
      Effect.gen(function* () {
        const service = yield* DummyService;
        return {
          summary: `Service handled ${args.item} for ${ctx.userId}`,
          resultString: JSON.stringify({ item: args.item, serviceValue: service.value }),
        };
      }),
  };

  const context = Context.empty().pipe(
    Context.add(DummyService, DummyService.of({ value: "active-service" })),
  );

  const tools = createPiAgentTools([serviceRequiringTool], "user-ctx-1", context);
  const tool = tools[0]!;
  const result = await tool.execute("call-service-1", { item: "cart-data" });

  assert.equal(result.isError, undefined);
  assert.equal(result.details.summary, "Service handled cart-data for user-ctx-1");
  assert.deepEqual(JSON.parse(result.details.resultString), {
    item: "cart-data",
    serviceValue: "active-service",
  });
});

test("buildInitialAgentMessages reconstructs plain user and assistant messages", () => {
  const dummyModel = { api: "google-generative-ai", provider: "google", id: "gemini-2.0-flash" };
  const history: ChatMessage[] = [
    { role: "user", content: "hello", timestamp: "2026-11-16T12:00:00Z", type: "ok" },
    {
      role: "assistant",
      content: "Hi! How can I help you?",
      timestamp: "2026-11-16T12:00:01Z",
      type: "ok",
    },
  ];

  const messages = buildInitialAgentMessages(history, dummyModel);
  assert.equal(messages.length, 2);
  assert.equal(messages[0]!.role, "user");
  assert.deepEqual(messages[0]!.content, [{ type: "text", text: "hello" }]);
  assert.equal(messages[1]!.role, "assistant");
  assert.deepEqual(messages[1]!.content, [{ type: "text", text: "Hi! How can I help you?" }]);
});

test("buildInitialAgentMessages reconstructs tool calls and tool results across turns", () => {
  const dummyModel = { api: "google-generative-ai", provider: "google", id: "gemini-2.0-flash" };
  const history: ChatMessage[] = [
    {
      role: "user",
      content: "i want to buy airpods",
      timestamp: "2026-11-16T12:00:00Z",
      type: "ok",
    },
    {
      role: "assistant",
      content: "I found Apple AirPods Pro (2nd Gen) for $249.99.",
      timestamp: "2026-11-16T12:00:02Z",
      type: "ok",
      toolCalls: [
        {
          id: "call-search-123",
          toolName: "search_products",
          arguments: JSON.stringify({ query: "airpods" }),
          result: JSON.stringify([
            { productId: "ap003", name: "Apple AirPods Pro", price: 249.99 },
          ]),
        },
      ],
    },
  ];

  const messages = buildInitialAgentMessages(history, dummyModel);
  // Expect: 1 (user) + 1 (assistant toolCall) + 1 (toolResult) + 1 (assistant final text) = 4 messages
  assert.equal(messages.length, 4);

  // Message 0: User request
  assert.equal(messages[0]!.role, "user");
  assert.deepEqual(messages[0]!.content, [{ type: "text", text: "i want to buy airpods" }]);

  // Message 1: Assistant tool call
  const toolCallMsg = messages[1]!;
  assert.equal(toolCallMsg.role, "assistant");
  assert.equal(toolCallMsg.stopReason, "toolUse");
  assert.deepEqual(toolCallMsg.content, [
    {
      type: "toolCall",
      id: "call-search-123",
      name: "search_products",
      arguments: { query: "airpods" },
    },
  ]);

  // Message 2: Tool result with search output containing ap003
  const toolResultMsg = messages[2]!;
  assert.equal(toolResultMsg.role, "toolResult");
  assert.equal(toolResultMsg.toolCallId, "call-search-123");
  assert.equal(toolResultMsg.toolName, "search_products");
  assert.deepEqual(toolResultMsg.content, [
    {
      type: "text",
      text: JSON.stringify([{ productId: "ap003", name: "Apple AirPods Pro", price: 249.99 }]),
    },
  ]);

  // Message 3: Final Assistant reply text
  const replyMsg = messages[3]!;
  assert.equal(replyMsg.role, "assistant");
  assert.equal(replyMsg.stopReason, "stop");
  assert.deepEqual(replyMsg.content, [
    { type: "text", text: "I found Apple AirPods Pro (2nd Gen) for $249.99." },
  ]);
});
