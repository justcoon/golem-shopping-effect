import { Context, Effect, type Schema } from "effect";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { schemaToJsonSchema } from "../common/index.js";
import { formatUnknownError } from "./error-formatter.js";
import type { ToolContext, ToolExecutionOutput } from "./tool-generator.js";

export type { ToolContext, ToolExecutionOutput };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AssistantToolLike<TArgs = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema.Schema<TArgs>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly run: (args: any, ctx: ToolContext) => Effect.Effect<ToolExecutionOutput, any, any>;
}

/**
 * Converts an Effect-based domain tool definition into a Pi Agent `AgentTool`.
 * Tool execution runs inside an Effect fiber via `Effect.runPromise` with the provided `toolContext`
 * and ambient Golem context (including RpcClient).
 */
export function toPiAgentTool(
  toolDef: AssistantToolLike,
  toolContext: ToolContext | string,
  context?: Context.Context<never>,
  loggerNamespace = "[AI]",
): AgentTool<TSchema> {
  const jsonSchema = schemaToJsonSchema(toolDef.parameters) as TSchema;
  const ctx: ToolContext = typeof toolContext === "string" ? { userId: toolContext } : toolContext;
  const contextId = ctx.userId ?? ctx.managerId ?? "system";

  return {
    name: toolDef.name,
    label: toolDef.name
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    description: toolDef.description,
    parameters: jsonSchema,
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult> => {
      const argsStr = JSON.stringify(params ?? {});
      try {
        const pipeline = Effect.gen(function* () {
          yield* Effect.logInfo(
            `${loggerNamespace} Invoking tool '${toolDef.name}' (callId: ${toolCallId}) for context '${contextId}' with args: ${argsStr}`,
          );

          const output = (yield* toolDef.run(params, ctx)) as ToolExecutionOutput;

          yield* Effect.logInfo(
            `${loggerNamespace} Tool '${toolDef.name}' completed (result length: ${output.resultString.length})`,
          );

          return output;
        });

        const effectToRun = pipeline.pipe(
          Effect.provide(context ?? Context.empty()),
        ) as Effect.Effect<ToolExecutionOutput, unknown, never>;
        const output = await Effect.runPromise(effectToRun);

        return {
          content: [{ type: "text", text: output.resultString }],
          details: {
            summary: output.summary,
            resultString: output.resultString,
          },
        };
      } catch (err: unknown) {
        const errorMessage = formatUnknownError(err);
        const errorJson = JSON.stringify({ error: errorMessage });

        const warnEffect = Effect.logWarning(
          `${loggerNamespace} Tool '${toolDef.name}' (callId: ${toolCallId}) failed: ${errorMessage}`,
        );
        const effectToRun = warnEffect.pipe(
          Effect.provide(context ?? Context.empty()),
        ) as Effect.Effect<void, unknown, never>;
        await Effect.runPromise(effectToRun).catch(() => {});

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
 * Creates Pi Agent tools for the given tool collection and context.
 */
export function createPiAgentTools(
  tools: readonly AssistantToolLike[],
  toolContext: ToolContext | string,
  context?: Context.Context<never>,
  loggerNamespace = "[AI]",
): AgentTool<TSchema>[] {
  return tools.map((t) => toPiAgentTool(t, toolContext, context, loggerNamespace));
}
