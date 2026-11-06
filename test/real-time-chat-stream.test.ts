import test from "node:test";
import assert from "node:assert/strict";
import { Effect, Stream } from "effect";
import {
  executeAgentChatTurnStream,
  type ChatChunk,
  type ChatTurnResult,
} from "../src/ai/index.js";

test("executeAgentChatTurnStream handles missing API key with live error chunks and onTurnComplete", async () => {
  let completedResult: ChatTurnResult | undefined;

  const stream = executeAgentChatTurnStream({
    systemPrompt: "You are a test assistant.",
    tools: [],
    apiKey: "",
    model: "gemini-2.5-flash",
    history: [],
    userMessage: "Hello",
    missingApiKeyMessage: "Custom missing API key message",
    onTurnComplete: (result) =>
      Effect.sync(() => {
        completedResult = result;
      }),
  });

  const chunks = await Effect.runPromise(Stream.runCollect(stream));
  const chunkList: ChatChunk[] = Array.from(chunks);

  assert.equal(chunkList.length, 3);
  assert.equal(chunkList[0]?._tag, "text_delta");
  assert.equal(chunkList[0]?.content, "Custom missing API key message");
  assert.equal(chunkList[1]?._tag, "error");
  assert.equal(chunkList[1]?.content, "Custom missing API key message");
  assert.equal(chunkList[2]?._tag, "done");

  assert.ok(completedResult, "onTurnComplete should be invoked");
  assert.equal(completedResult?.reply, "Custom missing API key message");
  assert.equal(completedResult?.type, "error");
});

test("executeAgentChatTurnStream handles downstream stream pull and completes cleanly", async () => {
  let completionCalled = false;

  const stream = executeAgentChatTurnStream({
    systemPrompt: "You are a test assistant.",
    tools: [],
    apiKey: "",
    model: "gemini-2.5-flash",
    history: [],
    userMessage: "Test stream",
    onTurnComplete: () =>
      Effect.sync(() => {
        completionCalled = true;
      }),
  });

  // Pull individual chunks using Stream.take(2)
  const partial = await Effect.runPromise(stream.pipe(Stream.take(2), Stream.runCollect));
  assert.equal(Array.from(partial).length, 2);
  assert.equal(Array.from(partial)[0]?._tag, "text_delta");
  assert.equal(Array.from(partial)[1]?._tag, "error");
  assert.equal(completionCalled, true);
});
