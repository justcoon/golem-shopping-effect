import { Context, Effect, type Schema } from "effect";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { formatUnknownError, schemaToJsonSchema } from "../../common/index.js";

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
  readonly run: (args: any, ctx: ToolContext) => Effect.Effect<ToolExecutionOutput, any, any>;
}

/**
 * Converts an Effect-based domain tool definition into a Pi Agent `AgentTool`.
 * Tool execution runs inside an Effect fiber via `Effect.runPromise` with the provided `userId`
 * and ambient Golem context (including RpcClient).
 */
export function toPiAgentTool(
  toolDef: AssistantToolLike,
  userId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema> {
  const jsonSchema = schemaToJsonSchema(toolDef.parameters) as TSchema;

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
            `[ShoppingAssistant] Invoking tool '${toolDef.name}' (callId: ${toolCallId}) for user '${userId}' with args: ${argsStr}`,
          );

          const output = (yield* toolDef.run(params, { userId })) as ToolExecutionOutput;

          yield* Effect.logInfo(
            `[ShoppingAssistant] Tool '${toolDef.name}' completed (result length: ${output.resultString.length})`,
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
          `[ShoppingAssistant] Tool '${toolDef.name}' (callId: ${toolCallId}) failed: ${errorMessage}`,
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
 * Creates Pi Agent tools for the given tool collection and user ID.
 */
export function createPiAgentTools(
  tools: readonly AssistantToolLike[],
  userId: string,
  context?: Context.Context<never>,
): AgentTool<TSchema>[] {
  return tools.map((t) => toPiAgentTool(t, userId, context));
}
