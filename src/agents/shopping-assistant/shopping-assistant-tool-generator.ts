/* eslint-disable @typescript-eslint/no-explicit-any */
import { Effect, Result, Schema } from "effect";
import { formatUnknownError, safeJsonStringify } from "../../common/index.js";
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
  readonly mode?: string;
  readonly methods: TMethods;
  readonly client: {
    readonly get?: (id: TId) => Effect.Effect<any, any, any>;
    readonly newPhantom?: (id?: any) => Effect.Effect<any, any, any>;
    readonly [key: string]: any;
  };
}

export type InferMethodInput<TMethod> = TMethod extends {
  readonly input: infer I extends Record<string, Schema.Schema<any>>;
}
  ? Schema.Schema.Type<Schema.Struct<I>>
  : Record<string, unknown>;

export type InferMethodSuccess<TMethod> = TMethod extends {
  readonly success: infer S extends Schema.Schema<any>;
}
  ? Schema.Schema.Type<S>
  : unknown;

export type InferMethodError<TMethod> = TMethod extends {
  readonly error: infer E extends Schema.Schema<any>;
}
  ? Schema.Schema.Type<E>
  : unknown;

export interface MethodToolOptions<
  TSuccess = unknown,
  TError = unknown,
  TArgs = unknown,
  TIdInput = any,
> {
  /** Optional override for tool name (defaults to snake_case of methodName, e.g. "update_billing_address") */
  readonly toolName?: string;

  /** Optional override for tool description (defaults to method's promptHint ?? description) */
  readonly description?: string;

  /** Function to resolve target agent ID from ToolContext and decoded tool arguments */
  readonly resolveId?: (ctx: ToolContext, args: TArgs) => TIdInput;

  /** Optional mapping from tool arguments to agent method input (e.g. { productId } -> { ids: productId }) */
  readonly mapInput?: (args: TArgs) => any;

  /** Extra parameters to expose on the tool beyond method input (e.g. orderId for agent-level ID) */
  readonly extraParameters?: Record<string, Schema.Schema<any>>;

  /** Type-safe custom summary formatter for the chat UI on Result (success or failure) */
  readonly formatSummary?: (result: Result.Result<TSuccess, TError>, args: TArgs) => string;
}

/** Convert camelCase method names to snake_case tool names (e.g. updateBillingAddress -> update_billing_address) */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "");
}

function extractFailureMessage(failure: unknown): string {
  return formatUnknownError(failure);
}

/**
 * Creates an executable AssistantToolDefinition directly from a Golem Agent's MethodSpec.
 * Automatically derives:
 * - parameters: Schema.Struct({ ...methodSpec.input, ...options.extraParameters })
 * - description: methodSpec.promptHint ?? methodSpec.description
 * - execution: Typed Golem RPC call piped through Effect.result (returning Result<Success, Error>)
 * - client resolution: supports both durable agents (client.get) and ephemeral agents (client.newPhantom)
 */
export function createToolFromAgentMethod<
  TAgent extends AgentWithMethods,
  TMethodName extends keyof TAgent["methods"] & string,
  TExtraParams extends Record<string, Schema.Schema<any>> = Record<string, never>,
>(
  agent: TAgent,
  methodName: TMethodName,
  options?: MethodToolOptions<
    InferMethodSuccess<TAgent["methods"][TMethodName]>,
    InferMethodError<TAgent["methods"][TMethodName]>,
    InferMethodInput<TAgent["methods"][TMethodName]> &
      Schema.Schema.Type<Schema.Struct<TExtraParams>>,
    any
  > & { readonly extraParameters?: TExtraParams },
): AssistantToolDefinition {
  const methodSpec = agent.methods[methodName];
  if (!methodSpec) {
    throw new Error(`Method '${methodName}' not found on agent '${agent.name}'`);
  }

  const name = options?.toolName ?? camelToSnake(methodName);
  const description =
    options?.description ??
    methodSpec.promptHint ??
    methodSpec.description ??
    `Execute ${methodName} on ${agent.name}`;

  // Derive parameters schema dynamically from methodSpec.input + options.extraParameters
  const inputFields = {
    ...(methodSpec.input ?? {}),
    ...(options?.extraParameters ?? {}),
  };
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

  const resolveClient = (ctx: ToolContext, args: any) =>
    Effect.gen(function* () {
      // 1. If an explicit resolveId is specified, always use client.get(id)
      if (options?.resolveId) {
        const id = options.resolveId(ctx, args);
        if (typeof agent.client.get === "function") {
          return yield* (agent.client.get(id) as Effect.Effect<any, never, any>).pipe(Effect.orDie);
        }
      }

      // 2. If the agent is ephemeral, instantiate via newPhantom
      if (agent.mode === "ephemeral" && typeof agent.client.newPhantom === "function") {
        return yield* (agent.client.newPhantom({}) as Effect.Effect<any, never, any>).pipe(
          Effect.orDie,
        );
      }

      // 3. For durable agents without explicit resolveId, use client.get()
      if (typeof agent.client.get === "function") {
        const id = options?.resolveId ? options.resolveId(ctx, args) : undefined;
        return yield* (agent.client.get(id) as Effect.Effect<any, never, any>).pipe(Effect.orDie);
      }

      // 4. Fallback to newPhantom
      if (typeof agent.client.newPhantom === "function") {
        return yield* (agent.client.newPhantom({}) as Effect.Effect<any, never, any>).pipe(
          Effect.orDie,
        );
      }

      return yield* Effect.die(
        new Error(`Agent '${agent.name}' client has neither 'get' nor 'newPhantom' methods`),
      );
    });

  return {
    name,
    description,
    parameters: parameters as any,
    summarize: (result: unknown) => {
      if (Result.isResult(result)) {
        if (options?.formatSummary) {
          return options.formatSummary(result as any, {} as any);
        }
        if (Result.isSuccess(result)) {
          return defaultSummary(result.success);
        }
        return `Failed: ${extractFailureMessage(result.failure)}`;
      }
      return defaultSummary(result);
    },
    execute: (args: unknown, ctx: ToolContext): Effect.Effect<any, never, any> =>
      Effect.gen(function* () {
        const client = yield* resolveClient(ctx, args);
        const methodFn = client[methodName] as (input: any) => Effect.Effect<any, any, any>;
        const methodArgs = options?.mapInput ? options.mapInput(args as any) : args;
        const res: Result.Result<any, any> = yield* methodFn(methodArgs ?? {}).pipe(
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

        const client = yield* resolveClient(ctx, decoded);
        const methodFn = client[methodName] as (input: any) => Effect.Effect<any, any, any>;
        const methodArgs = options?.mapInput ? options.mapInput(decoded as any) : decoded;

        const result: Result.Result<any, any> = yield* methodFn(methodArgs).pipe(
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
        if (options?.formatSummary) {
          summary = options.formatSummary(result as any, decoded as any);
        } else if (Result.isSuccess(result)) {
          summary = defaultSummary(result.success);
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
    readonly resolveId?: (ctx: ToolContext, args: any) => any;
    readonly methods: {
      [K in keyof TAgent["methods"]]?: MethodToolOptions<any, any, any, any>;
    };
  },
): AssistantToolDefinition[] {
  return Object.entries(config.methods).map(([methodName, methodOpts]) =>
    createToolFromAgentMethod(agent, methodName as any, {
      ...methodOpts,
      resolveId: methodOpts?.resolveId ?? config.resolveId,
    }),
  );
}
