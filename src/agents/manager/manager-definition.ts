import { Schema } from "effect";
import {
  defineAgent,
  defineConfig,
  Http,
  method,
  Snapshot,
  WitTypes,
} from "@golemcloud/effect-golem";
import { ChatChunk, ChatMessage, ChatResponse, LlmConfigSchema } from "../../ai/index.js";

export class ManagerAgentConfig extends defineConfig("ManagerAgent.Config", {
  llm: LlmConfigSchema,
}) {}

export const ManagerAgentState = Schema.Struct({
  managerId: Schema.String,
  messages: Schema.Array(ChatMessage),
});
export type ManagerAgentState = typeof ManagerAgentState.Type;

export const ManagerAgentDefinition = defineAgent({
  name: "ManagerAgent",
  mode: "durable",
  id: { id: Schema.String },
  config: ManagerAgentConfig,
  snapshotting: Snapshot.define({
    schema: ManagerAgentState,
    policy: Snapshot.policy.everyN(5),
  }),
  http: Http.mount("/v1/manager/{id}"),
  methods: {
    chat: method({
      input: { message: Schema.String },
      success: ChatResponse,
      http: [Http.post("/chat")],
      description: "Chat synchronously with the store manager assistant",
    }),
    chatStream: method({
      input: { message: Schema.String },
      success: WitTypes.AgentStream(ChatChunk),
      http: [Http.post("/chat-stream")],
      description: "Stream conversational manager responses and tool activity",
    }),
    getHistory: method({
      input: {},
      success: Schema.Array(ChatMessage),
      readOnly: true,
      http: [Http.get("/history")],
      description: "Get conversation history with store manager",
    }),
    clearHistory: method({
      input: {},
      success: Schema.Void,
      http: [Http.post("/clear-history")],
      description: "Clear conversation history with store manager",
    }),
  },
});
