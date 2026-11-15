import { Context, Effect, Schema } from "effect";
import type { Tool } from "@golemcloud/effect-golem";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { safeJsonStringify, schemaToJsonSchema } from "../common/index.js";
import { formatUnknownError } from "./error-formatter.js";
import type { ToolContext, ToolExecutionOutput } from "./tool-generator.js";

export type { ToolContext, ToolExecutionOutput };

// Casing helper utilities
const toSnakeCase = (s: string): string => s.replace(/-/g, "_");
const toCamelCase = (s: string): string => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const toHumanLabel = (snakeName: string): string =>
  snakeName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AssistantToolLike<TArgs = any> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Schema.Schema<TArgs>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly run: (args: any, ctx: ToolContext) => Effect.Effect<ToolExecutionOutput, any, any>;
}

interface ExecuteToolEffectOptions {
  readonly toolName: string;
  readonly callId: string;
  readonly contextId: string;
  readonly loggerNamespace: string;
  readonly argsStr: string;
  readonly ambientContext?: Context.Context<never>;
}

/**
 * Shared runtime bridge that executes an Effect tool within a fiber,
 * captures logging, formats JSON responses, and returns an AgentToolResult.
 */
async function executeToolEffect(
  runEffect: Effect.Effect<
    { readonly resultString: string; readonly summary?: string },
    unknown,
    unknown
  >,
  options: ExecuteToolEffectOptions,
): Promise<AgentToolResult> {
  const { toolName, callId, contextId, loggerNamespace, argsStr, ambientContext } = options;
  const ctx = ambientContext ?? Context.empty();

  try {
    const pipeline = Effect.gen(function* () {
      yield* Effect.logInfo(
        `${loggerNamespace} Invoking tool '${toolName}' (callId: ${callId}) for context '${contextId}' with args: ${argsStr}`,
      );

      const output = yield* runEffect;

      yield* Effect.logInfo(
        `${loggerNamespace} Tool '${toolName}' completed (result length: ${output.resultString.length})`,
      );

      return output;
    });

    const effectToRun = pipeline.pipe(Effect.provide(ctx)) as Effect.Effect<
      { readonly resultString: string; readonly summary?: string },
      unknown,
      never
    >;
    const output = await Effect.runPromise(effectToRun);

    return {
      content: [{ type: "text", text: output.resultString }],
      details: {
        summary: output.summary ?? `${toolName} completed.`,
        resultString: output.resultString,
      },
    };
  } catch (err: unknown) {
    const errorMessage = formatUnknownError(err);
    const errorJson = JSON.stringify({ error: errorMessage });

    const warnEffect = Effect.logWarning(
      `${loggerNamespace} Tool '${toolName}' (callId: ${callId}) failed: ${errorMessage}`,
    ).pipe(Effect.provide(ctx)) as Effect.Effect<void, unknown, never>;
    await Effect.runPromise(warnEffect).catch(() => {});

    return {
      content: [{ type: "text", text: errorJson }],
      details: {
        summary: `Error: ${errorMessage}`,
        resultString: errorJson,
      },
      isError: true,
    };
  }
}

/**
 * Converts an Effect-based domain tool definition into a Pi Agent `AgentTool`.
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
    label: toHumanLabel(toolDef.name),
    description: toolDef.description,
    parameters: jsonSchema,
    execute: (toolCallId: string, params: unknown): Promise<AgentToolResult> =>
      executeToolEffect(toolDef.run(params, ctx), {
        toolName: toolDef.name,
        callId: toolCallId,
        contextId,
        loggerNamespace,
        argsStr: JSON.stringify(params ?? {}),
        ambientContext: context,
      }),
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

export interface GolemToolAdapterOptions {
  readonly bind?: Record<string, unknown | ((ctx: ToolContext) => unknown)>;
  readonly loggerNamespace?: string;
  readonly client?: ToolClientLike;
  /**
   * If true, invokes the tool's direct implementation (handlers) in-process
   * rather than dispatching via Golem's host client RPC. Useful for streaming or local execution.
   */
  readonly useImpl?: boolean;
}

function resolveBoundValue(
  bind: Record<string, unknown | ((ctx: ToolContext) => unknown)>,
  paramKey: string,
  ctx: ToolContext,
): unknown | undefined {
  const getter = bind[paramKey] ?? bind[toSnakeCase(paramKey)] ?? bind[toCamelCase(paramKey)];
  if (getter === undefined) return undefined;
  return typeof getter === "function" ? (getter as (c: ToolContext) => unknown)(ctx) : getter;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GolemToolDefinition = Tool.ToolDefinition<string, any>;

/**
 * Derives Pi Agent tools (`AgentTool`) directly from a Golem ToolDefinition (`Tool.toolDefinition`).
 * Dynamically converts command schemas, binds context arguments (e.g. userId), and invokes commands via the Golem Tool client.
 */
export function golemToolToPiAgentTools(
  tool: GolemToolDefinition,
  toolContext: ToolContext | string,
  context?: Context.Context<never>,
  options: GolemToolAdapterOptions = {},
): AgentTool<TSchema>[] {
  const model = tool.model;
  if (!model?.children) {
    return [];
  }

  const toolWithClient = tool as {
    client?: () => ToolClientLike;
    handlers?: ToolClientLike;
  };

  let client: ToolClientLike | undefined = options.client;

  if (options.useImpl) {
    client = client ?? toolWithClient.handlers;
  } else {
    if (!client && typeof toolWithClient.client === "function") {
      try {
        client = toolWithClient.client();
      } catch {
        // fallback to handlers if client construction fails
      }
    }
    if (!client) {
      client = toolWithClient.handlers;
    }
  }
  const ctx: ToolContext = typeof toolContext === "string" ? { userId: toolContext } : toolContext;
  const contextId = ctx.userId ?? ctx.managerId ?? "system";
  const loggerNamespace = options.loggerNamespace ?? `[GolemTool:${model.name ?? "tool"}]`;
  const bind = options.bind ?? {};

  return Object.entries(model.children).map(([cmdName, cmdRaw]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cmd = cmdRaw as any;
    const toolName = toSnakeCase(cmdName);
    const label = toHumanLabel(toolName);
    const description = typeof cmd.doc === "string" ? cmd.doc : (cmd.body?.description ?? "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawFields: Record<string, Schema.Schema<any>> = cmd.body?.fields ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args: any[] = cmd.body?.args ?? [];

    // Filter out bound parameters from LLM schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeFields: Record<string, Schema.Schema<any>> = {};
    for (const [k, fieldSchema] of Object.entries(rawFields)) {
      if (resolveBoundValue(bind, k, ctx) === undefined) {
        const isRequired = args.find((a) => a.name === k)?.options?.required === true;
        activeFields[toSnakeCase(k)] = isRequired ? fieldSchema : Schema.optional(fieldSchema);
      }
    }

    const camelMethodName = toCamelCase(cmdName);
    const clientMethod =
      typeof client?.[camelMethodName] === "function"
        ? (client[camelMethodName] as (input: unknown) => Effect.Effect<unknown, unknown, unknown>)
        : typeof client?.[cmdName] === "function"
          ? (client[cmdName] as (input: unknown) => Effect.Effect<unknown, unknown, unknown>)
          : undefined;

    return {
      name: toolName,
      label,
      description,
      parameters: schemaToJsonSchema(Schema.Struct(activeFields)) as TSchema,
      execute: (toolCallId: string, params: unknown): Promise<AgentToolResult> => {
        const rawParams =
          params && typeof params === "object" ? (params as Record<string, unknown>) : {};
        const clientInput: Record<string, unknown> = {};

        for (const k of Object.keys(rawFields)) {
          const snakeKey = toSnakeCase(k);
          const camelKey = toCamelCase(k);
          const bound = resolveBoundValue(bind, k, ctx);
          const val =
            bound !== undefined
              ? bound
              : (rawParams[snakeKey] ?? rawParams[camelKey] ?? rawParams[k]);

          if (val !== undefined) {
            clientInput[camelKey] = val;
            clientInput[snakeKey] = val;
            clientInput[k] = val;
          }
        }

        const runEffect = Effect.gen(function* () {
          if (!clientMethod) {
            throw new Error(
              `No tool client method found for command '${cmdName}' (expected method '${camelMethodName}')`,
            );
          }

          const res = yield* clientMethod(clientInput);
          const resultString = safeJsonStringify(res);

          return {
            resultString,
            summary: `${label} completed successfully.`,
          };
        });

        return executeToolEffect(runEffect, {
          toolName,
          callId: toolCallId,
          contextId,
          loggerNamespace,
          argsStr: JSON.stringify(clientInput),
          ambientContext: context,
        });
      },
    };
  });
}
