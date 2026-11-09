import { Context, Effect, Schema } from "effect";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { safeJsonStringify, schemaToJsonSchema } from "../common/index.js";
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

export interface ToolClientLike {
  readonly [methodName: string]:
    ((input: unknown, ...args: unknown[]) => Effect.Effect<unknown, unknown, unknown>) | unknown;
}

export interface ToolDefinitionLike {
  readonly name?: string;
  readonly model: {
    readonly name?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly children?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly body?: any;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly client?: (options?: any) => any;
}

export type ToolDefinitionInput = ToolDefinitionLike | { readonly definition: ToolDefinitionLike };

export interface GolemToolAdapterOptions {
  readonly bind?: Record<string, unknown | ((ctx: ToolContext) => unknown)>;
  readonly loggerNamespace?: string;
  readonly client?: ToolClientLike;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly clientOptions?: any;
}

/**
 * Derives Pi Agent tools (`AgentTool`) directly from a Golem ToolDefinition (`Tool.toolDefinition`).
 * Dynamically converts command schemas, binds context arguments (e.g. userId), and invokes commands via the Golem Tool client.
 */
export function golemToolToPiAgentTools(
  tool: ToolDefinitionInput,
  toolContext: ToolContext | string,
  context?: Context.Context<never>,
  options: GolemToolAdapterOptions = {},
): AgentTool<TSchema>[] {
  const definition: ToolDefinitionLike =
    "definition" in tool && tool.definition ? tool.definition : (tool as ToolDefinitionLike);
  const model = definition.model;
  if (!model?.children) {
    return [];
  }

  const client: ToolClientLike | undefined =
    options.client ??
    (typeof definition.client === "function"
      ? definition.client(options.clientOptions)
      : undefined);
  const ctx: ToolContext = typeof toolContext === "string" ? { userId: toolContext } : toolContext;
  const contextId = ctx.userId ?? ctx.managerId ?? "system";
  const loggerNamespace = options.loggerNamespace ?? `[GolemTool:${model.name ?? "tool"}]`;
  const bind = options.bind ?? {};

  const piTools: AgentTool<TSchema>[] = [];

  for (const [cmdName, cmd] of Object.entries(model.children)) {
    const toolName = cmdName.replace(/-/g, "_");
    const label = toolName
      .split("_")
      .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    const description = typeof cmd.doc === "string" ? cmd.doc : (cmd.body?.description ?? "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawFields: Record<string, Schema.Schema<any>> = cmd.body?.fields ?? {};

    // Filter out bound parameters from LLM schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeFields: Record<string, Schema.Schema<any>> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args: any[] = cmd.body?.args ?? [];
    for (const [k, fieldSchema] of Object.entries(rawFields)) {
      const isBound =
        k in bind ||
        k.replace(/-/g, "_") in bind ||
        k.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()) in bind;
      if (!isBound) {
        const paramName = k.replace(/-/g, "_");
        const argDef = args.find((a) => a.name === k);
        const isRequired = argDef?.options?.required === true || argDef?.kind === "positional";
        activeFields[paramName] = isRequired ? fieldSchema : Schema.optional(fieldSchema);
      }
    }

    const structSchema = Schema.Struct(activeFields);
    const jsonSchema = schemaToJsonSchema(structSchema) as TSchema;
    const camelMethodName = cmdName.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    const clientMethod =
      typeof client?.[camelMethodName] === "function"
        ? (client[camelMethodName] as (input: unknown) => Effect.Effect<unknown, unknown, unknown>)
        : typeof client?.[cmdName] === "function"
          ? (client[cmdName] as (input: unknown) => Effect.Effect<unknown, unknown, unknown>)
          : undefined;

    piTools.push({
      name: toolName,
      label,
      description,
      parameters: jsonSchema,
      execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult> => {
        try {
          const rawParams =
            params && typeof params === "object" ? (params as Record<string, unknown>) : {};
          const clientInput: Record<string, unknown> = {};

          for (const [k] of Object.entries(rawFields)) {
            const snakeKey = k.replace(/-/g, "_");
            const camelKey = k.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

            let val: unknown;
            if (k in bind || snakeKey in bind || camelKey in bind) {
              const boundVal = bind[k] ?? bind[snakeKey] ?? bind[camelKey];
              val = typeof boundVal === "function" ? boundVal(ctx) : boundVal;
            } else {
              val = rawParams[camelKey] ?? rawParams[snakeKey] ?? rawParams[k];
            }

            if (val !== undefined) {
              clientInput[camelKey] = val;
              clientInput[snakeKey] = val;
              clientInput[k] = val;
            }
          }

          const pipeline = Effect.gen(function* () {
            yield* Effect.logInfo(
              `${loggerNamespace} Invoking command '${cmdName}' via tool client (tool: '${toolName}', callId: ${toolCallId}) for context '${contextId}' with input: ${JSON.stringify(clientInput)}`,
            );

            if (!clientMethod) {
              throw new Error(
                `No tool client method found for command '${cmdName}' (expected method '${camelMethodName}')`,
              );
            }

            const res = yield* clientMethod(clientInput);
            const resultString = safeJsonStringify(res);

            yield* Effect.logInfo(
              `${loggerNamespace} Command '${cmdName}' completed (result length: ${resultString.length})`,
            );

            return { res, resultString };
          });

          const effectToRun = pipeline.pipe(
            Effect.provide(context ?? Context.empty()),
          ) as Effect.Effect<{ res: unknown; resultString: string }, unknown, never>;

          const { resultString } = await Effect.runPromise(effectToRun);

          return {
            content: [{ type: "text", text: resultString }],
            details: {
              summary: `${label} completed successfully.`,
              resultString,
            },
          };
        } catch (err: unknown) {
          const errorMessage = formatUnknownError(err);
          const errorJson = JSON.stringify({ error: errorMessage });

          const warnEffect = Effect.logWarning(
            `${loggerNamespace} Command '${cmdName}' (callId: ${toolCallId}) failed: ${errorMessage}`,
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
    });
  }

  return piTools;
}
