import { Effect, Stream } from "effect";
import { Agents } from "@golemcloud/effect-golem";

export interface DiscoverAgentIdsOptions {
  readonly agentPrefix: string;
  readonly componentName?: string;
}

type AgentDiscoveryRequirements =
  ReturnType<typeof Agents.getAgents> extends Stream.Stream<unknown, unknown, infer R> ? R : never;

export function streamAgentIds(
  options: DiscoverAgentIdsOptions,
): Stream.Stream<string, never, AgentDiscoveryRequirements> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const componentName = options.componentName ?? "golem-shopping-effect:effect-main";
      const componentId = yield* Agents.resolveComponentId(componentName).pipe(
        Effect.catch(() =>
          Agents.getSelfMetadata.pipe(
            Effect.map((meta) => meta.agentId.componentId),
            Effect.catch(() => Effect.succeed(undefined)),
          ),
        ),
      );

      if (!componentId) {
        yield* Effect.logWarning(
          `AgentDiscovery: ComponentId could not be resolved for ${options.agentPrefix}`,
        );
        return Stream.empty;
      }

      const regex = new RegExp(`^${options.agentPrefix}\\("([^"]+)"\\)$`);
      const filter = Agents.Filter.name("starts-with", `${options.agentPrefix}(`);
      const agentMetadataStream = Agents.getAgents({
        componentId,
        filter,
        precise: true,
      });

      const processedIds = new Set<string>();

      return agentMetadataStream.pipe(
        Stream.map((meta) => {
          const rawName = meta.agentId.agentId;
          const match = rawName.match(regex);
          return match ? match[1] : undefined;
        }),
        Stream.filter((id): id is string => {
          if (id && !processedIds.has(id)) {
            processedIds.add(id);
            return true;
          }
          return false;
        }),
        Stream.catchCause((cause) =>
          Stream.unwrap(
            Effect.logWarning(`Failed to stream ${options.agentPrefix} agents: ${cause}`).pipe(
              Effect.as(Stream.empty),
            ),
          ),
        ),
      );
    }),
  ).pipe(Stream.orDie);
}

export function discoverAgentIds(
  options: DiscoverAgentIdsOptions,
): Effect.Effect<string[], never, AgentDiscoveryRequirements> {
  return Stream.runCollect(streamAgentIds(options));
}
