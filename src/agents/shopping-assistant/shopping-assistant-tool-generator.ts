/* eslint-disable @typescript-eslint/no-explicit-any */
import { Effect, Result, Schema } from "effect";
import { safeJsonStringify } from "../../common/index.js";
import type {
  AssistantToolDefinition,
  ToolContext,
  ToolExecutionOutput,
} from "./shopping-assistant-tools.js";

export interface AgentWithMethods<
  TMethods extends Record<string, any> = Record<string, any>,
  TId = any,
> {
  readonly name: string;
  readonly methods: TMethods;
  readonly client: {
    readonly get: (id: TId) => Effect.Effect<any, any, any>;
    readonly [key: string]: any;
  };
}

export interface MethodToolOptions<_TMethodName extends string = string, TIdInput = any> {
  /** Optional override for tool name (defaults to snake_case of methodName, e.g. "update_billing_address") */
  readonly toolName?: string;

  /** Optional override for tool description (defaults to method's promptHint ?? description) */
  readonly description?: string;

  /** Function to resolve target agent ID from ToolContext */
  readonly resolveId: (ctx: ToolContext) => TIdInput;

  /** Optional custom summary formatter for the chat UI on success */
  readonly formatSummary?: (resultValue: any, args: any) => string;
}

/** Convert camelCase method names to snake_case tool names (e.g. updateBillingAddress -> update_billing_address) */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "");
}

function extractFailureMessage(failure: unknown): string {
  if (typeof failure === "object" && failure !== null) {
    if ("message" in failure && typeof (failure as { message: unknown }).message === "string") {
      return (failure as { message: string }).message;
    }
    if ("_tag" in failure && typeof (failure as { _tag: unknown })._tag === "string") {
      return (failure as { _tag: string })._tag;
    }
  }
  return String(failure);
}

/**
 * Creates an executable AssistantToolDefinition directly from a Golem Agent's MethodSpec.
 * Automatically derives:
 * - parameters: Schema.Struct(methodSpec.input)
 * - description: methodSpec.promptHint ?? methodSpec.description
 * - execution: Typed Golem RPC call piped through Effect.result (returning Result<Success, Error>)
 */
export function createToolFromAgentMethod<
  TAgent extends AgentWithMethods,
  TMethodName extends keyof TAgent["methods"] & string,
>(
  agent: TAgent,
  methodName: TMethodName,
  options: MethodToolOptions<TMethodName, any>,
): AssistantToolDefinition {
  const methodSpec = agent.methods[methodName];
  if (!methodSpec) {
    throw new Error(`Method '${methodName}' not found on agent '${agent.name}'`);
  }

  const name = options.toolName ?? camelToSnake(methodName);
  const description =
    options.description ??
    methodSpec.promptHint ??
    methodSpec.description ??
    `Execute ${methodName} on ${agent.name}`;

  // Derive parameters schema dynamically from methodSpec.input
  // If input map has fields, create Schema.Struct(methodSpec.input), otherwise empty Struct
  const inputFields = methodSpec.input ?? {};
  const parameters = Schema.Struct(inputFields);

  const defaultSummary = (val: unknown): string => {
    if (val && typeof val === "object") {
      if ("message" in val && typeof (val as { message: unknown }).message === "string") {
        return (val as { message: string }).message;
      }
      if ("total" in val && "items" in val) {
        return `Updated cart: ${(val as { items: unknown[] }).items.length} items, total $${(val as { total: number }).total}`;
      }
    }
    return `Completed ${name}`;
  };

  return {
    name,
    description,
    parameters: parameters as any,
    summarize: (result: unknown) => {
      if (Result.isResult(result)) {
        if (Result.isSuccess(result)) {
          return options.formatSummary
            ? options.formatSummary(result.success, {})
            : defaultSummary(result.success);
        }
        return `Failed: ${extractFailureMessage(result.failure)}`;
      }
      return defaultSummary(result);
    },
    execute: (args: unknown, ctx: ToolContext): Effect.Effect<any, never, any> =>
      Effect.gen(function* () {
        const id = options.resolveId(ctx);
        const client = yield* (agent.client.get(id) as Effect.Effect<any, never, any>).pipe(
          Effect.orDie,
        );
        const methodFn = client[methodName] as (input: any) => Effect.Effect<any, any, any>;
        const res: Result.Result<any, any> = yield* methodFn(args ?? {}).pipe(
          Effect.result,
          Effect.catchDefect((defect) =>
            Effect.succeed(
              Result.fail({
                _tag: "Defect",
                message: defect instanceof Error ? defect.message : String(defect),
              }),
            ),
          ),
          Effect.orDie,
        );
        return res;
      }),
    run: (rawArgs: unknown, ctx: ToolContext): Effect.Effect<ToolExecutionOutput, never, any> =>
      Effect.gen(function* () {
        // Validate / decode input arguments using the derived parameters Schema
        const decoded = yield* Schema.decodeUnknownEffect(parameters)(rawArgs ?? {}).pipe(
          Effect.catch((err) => {
            const msg = `Invalid arguments for tool '${name}': ${
              err instanceof Error ? err.message : String(err)
            }`;
            return Effect.logWarning(`[ShoppingAssistant] ${msg}`).pipe(Effect.as(new Error(msg)));
          }),
          Effect.orDie,
        );

        if (decoded instanceof Error) {
          const failure = Result.fail({
            _tag: "ValidationFailed",
            message: decoded.message,
          });
          return {
            summary: `Failed: ${decoded.message}`,
            resultString: safeJsonStringify(failure),
          };
        }

        const id = options.resolveId(ctx);
        const client = yield* (agent.client.get(id) as Effect.Effect<any, never, any>).pipe(
          Effect.orDie,
        );
        const methodFn = client[methodName] as (input: any) => Effect.Effect<any, any, any>;

        const result: Result.Result<any, any> = yield* methodFn(decoded).pipe(
          Effect.result,
          Effect.catchDefect((defect) =>
            Effect.succeed(
              Result.fail({
                _tag: "Defect",
                message: defect instanceof Error ? defect.message : String(defect),
              }),
            ),
          ),
          Effect.orDie,
        );

        let summary: string;
        if (Result.isSuccess(result)) {
          summary = options.formatSummary
            ? options.formatSummary(result.success, decoded)
            : defaultSummary(result.success);
        } else {
          summary = `Failed: ${extractFailureMessage(result.failure)}`;
        }

        return {
          summary,
          resultString: safeJsonStringify(result),
        };
      }),
  };
}

/**
 * Batch creates multiple AssistantToolDefinitions from a Golem AgentSpec.
 */
export function createToolsFromAgent<TAgent extends AgentWithMethods>(
  agent: TAgent,
  config: {
    readonly resolveId: (ctx: ToolContext) => any;
    readonly methods: {
      [K in keyof TAgent["methods"]]?: {
        readonly toolName?: string;
        readonly description?: string;
        readonly formatSummary?: (resultValue: any, args: any) => string;
      };
    };
  },
): AssistantToolDefinition[] {
  return Object.entries(config.methods).map(([methodName, methodOpts]) =>
    createToolFromAgentMethod(agent, methodName as any, {
      ...methodOpts,
      resolveId: config.resolveId,
    }),
  );
}
