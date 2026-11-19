import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error chat-common.js is a plain browser JS module without emitted .d.ts
import * as chatCommon from "../web/assets/chat-common.js";

const { parseStreamEvents, getToolName, createCompletedToolCard, updateCompletedToolCard } =
  chatCommon;

test("parseStreamEvents normalizes Golem WIT variant array batches", () => {
  const sseData = JSON.stringify([
    {
      tool_start: {
        content: "Executing search_products...",
        toolCall: {
          id: "call_123",
          toolName: "search_products",
          arguments: '{"query":"iphone"}',
          result: "",
        },
      },
    },
  ]);

  const events = parseStreamEvents(sseData);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.tag, "tool_start");
  assert.equal(events[0]?.payload?.toolCall?.toolName, "search_products");
  assert.equal(events[0]?.payload?.toolCall?.id, "call_123");
});

test("parseStreamEvents normalizes text_delta, tool_result, and done events", () => {
  const sseData = JSON.stringify([
    { text_delta: { content: "Here is what I found" } },
    {
      tool_result: {
        content: "Found 1 products",
        toolCall: {
          id: "call_123",
          toolName: "search_products",
          arguments: "{}",
          result: '{"summary":"Found 1 item"}',
        },
      },
    },
    { done: { content: "" } },
  ]);

  const events = parseStreamEvents(sseData);
  assert.equal(events.length, 3);
  assert.equal(events[0]?.tag, "text_delta");
  assert.equal(events[0]?.payload?.content, "Here is what I found");
  assert.equal(events[1]?.tag, "tool_result");
  assert.equal(events[1]?.payload?.toolCall?.toolName, "search_products");
  assert.equal(events[2]?.tag, "done");
});

test("parseStreamEvents handles tagged format and kebab-case keys", () => {
  const taggedJson = JSON.stringify({ _tag: "text_delta", content: "hello" });
  const taggedEvents = parseStreamEvents(taggedJson);
  assert.equal(taggedEvents.length, 1);
  assert.equal(taggedEvents[0]?.tag, "text_delta");
  assert.equal(taggedEvents[0]?.payload?.content, "hello");

  const kebabJson = JSON.stringify([{ "tool-start": { content: "starting" } }]);
  const kebabEvents = parseStreamEvents(kebabJson);
  assert.equal(kebabEvents.length, 1);
  assert.equal(kebabEvents[0]?.tag, "tool_start");
  assert.equal(kebabEvents[0]?.payload?.content, "starting");
});

test("parseStreamEvents handles empty or malformed input safely", () => {
  assert.deepEqual(parseStreamEvents(""), []);
  assert.deepEqual(parseStreamEvents("invalid-json"), []);
  assert.deepEqual(parseStreamEvents(null as unknown as string), []);
});

test("parseStreamEvents normalizes PascalCase variant keys and string chunks", () => {
  const pascalData = JSON.stringify([
    { TextDelta: { content: "Found products" } },
    { ToolStart: { tool_call: { tool_name: "search_products" } } },
    { Done: { content: "" } },
  ]);
  const events = parseStreamEvents(pascalData);
  assert.equal(events.length, 3);
  assert.equal(events[0]?.tag, "text_delta");
  assert.equal(events[1]?.tag, "tool_start");
  assert.equal(events[2]?.tag, "done");

  const strDone = parseStreamEvents(JSON.stringify("done"));
  assert.equal(strDone.length, 1);
  assert.equal(strDone[0]?.tag, "done");
});

test("getToolName normalizes tool names from camelCase or snake_case", () => {
  assert.equal(getToolName({ toolName: "search_products" }), "search_products");
  assert.equal(getToolName({ tool_name: "add_to_cart" }), "add_to_cart");
  assert.equal(getToolName({}), "tool");
  assert.equal(getToolName(null), "tool");
});

test("tool cards format with bullet divider and array count", () => {
  const card1 = createCompletedToolCard({
    toolName: "search_products",
    result: JSON.stringify([{ id: "p1" }, { id: "p2" }]),
  });
  assert.ok(card1.innerHTML.includes("search_products"));
  assert.ok(card1.innerHTML.includes("tool-summary-divider"));
  assert.ok(card1.innerHTML.includes("2 items"));

  const dummyCard = { className: "", innerHTML: "" };
  updateCompletedToolCard(dummyCard, {
    tool_name: "checkout",
    result: '{"summary":"Order #123 placed"}',
  });
  assert.ok(dummyCard.innerHTML.includes("checkout"));
  assert.ok(dummyCard.innerHTML.includes("tool-summary-divider"));
  assert.ok(dummyCard.innerHTML.includes("Order #123 placed"));
});
