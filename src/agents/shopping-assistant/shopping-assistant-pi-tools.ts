import { Context } from "effect";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import {
  createPiAgentTools as baseCreatePiAgentTools,
  toPiAgentTool as baseToPiAgentTool,
  type AssistantToolLike,
} from "../../ai/pi-tools.js";

export * from "../../ai/pi-tools.js";

export function toPiAgentTool(
  toolDef: AssistantToolLike,
  userId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema> {
  return baseToPiAgentTool(toolDef, { userId }, context, "[ShoppingAssistant]");
}

export function createPiAgentTools(
  tools: readonly AssistantToolLike[],
  userId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema>[] {
  return baseCreatePiAgentTools(tools, { userId }, context, "[ShoppingAssistant]");
}
