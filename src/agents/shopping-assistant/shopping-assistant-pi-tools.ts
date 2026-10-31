import { Effect, type Schema } from "effect";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { schemaToJsonSchema } from "./shopping-assistant-tool-specs.js";

export interface ToolContext {
  readonly userId: string;
}

export interface ToolExecutionOutput {
  readonly summary: string;
  readonly resultString: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AssistantToolLike<TArgs = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema.Schema<TArgs>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly run: (args: any, ctx: ToolContext) => Effect.Effect<ToolExecutionOutput, never, any>;
}

/**
 * Converts an Effect-based domain tool definition into a Pi Agent `AgentTool`.
 * Tool execution runs inside an Effect fiber via `Effect.runPromise` with the provided `userId`.
 */
export function toPiAgentTool(toolDef: AssistantToolLike, userId: string): AgentTool<TSchema> {
  const jsonSchema = schemaToJsonSchema(toolDef.parameters) as TSchema;

  return {
    name: toolDef.name,
    label: toolDef.name
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    description: toolDef.description,
    parameters: jsonSchema,
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult> => {
      try {
        const output = await Effect.runPromise(
          toolDef.run(params, { userId }) as Effect.Effect<ToolExecutionOutput>,
        );
        return {
          content: [{ type: "text", text: output.resultString }],
          details: {
            summary: output.summary,
            resultString: output.resultString,
          },
        };
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorJson = JSON.stringify({ error: errorMessage });
        return {
          content: [{ type: "text", text: errorJson }],
          details: {
            summary: `Error: ${errorMessage}`,
            resultString: errorJson,
          },
          isError: true,
        };
      }
    },
  };
}

/**
 * Creates Pi Agent tools for the given tool collection and user ID.
 */
export function createPiAgentTools(
  tools: readonly AssistantToolLike[],
  userId: string,
): AgentTool<TSchema>[] {
  return tools.map((t) => toPiAgentTool(t, userId));
}
