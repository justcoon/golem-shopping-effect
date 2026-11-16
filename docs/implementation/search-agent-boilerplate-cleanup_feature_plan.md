# Feature Plan: 3.3 Search Agent & Query Matcher Boilerplate Cleanup

## Motivation & Context
Currently, [`OrderSearchAgent`](../../src/agents/order-search/order-search-agent.ts) and [`ProductSearchAgent`](../../src/agents/product-search/product-search-agent.ts) share substantial duplicate logic:
1. **Query parsing and matching duplication**:
   [`OrderQueryMatcher`](../../src/agents/order-search/order-query-matcher.ts) and [`ProductQueryMatcher`](../../src/agents/product-search/product-query-matcher.ts) both implement identical tokenization (handling quotes `"..."` and whitespace), field filter extraction (`field:value`), wildcard `*` matching, and case-insensitive string comparison helpers (`textMatches`, `valueMatches`).
2. **Agent discovery boilerplate**:
   Both agents duplicate the multi-step Golem SDK discovery sequence: resolving component ID with fallback to `Agents.getSelfMetadata`, streaming `Agents.getAgents` with `starts-with` filter, extracting IDs from `AgentName("id")`, and deduplicating IDs in a `Set`.

This plan extracts the common query parsing/matching into a reusable utility and unifies agent ID discovery, while preserving 100% API and behavioral compatibility for all existing tests and agent endpoints.

---

## Proposed Changes

### 1. `src/common/query-matcher.ts`
Create a centralized query parsing and matching utility:
- `ParsedSearchQuery`: `{ terms: readonly string[], fieldFilters: ReadonlyMap<string, string> }`
- `parseSearchQuery(query: string): ParsedSearchQuery`
  - Tokenizes string respecting quoted phrases (`"..."`) and spaces.
  - Extracts `key:value` pairs into lowercased map entries.
  - Stores non-field tokens in `terms`.
- `textMatches(text: string, query: string): boolean`: Case-insensitive substring match with `*` wildcard support.
- `valueMatches(text: string, query: string, caseSensitive?: boolean): boolean`: Equality check with `*` wildcard support.

### 2. Simplify `OrderQueryMatcher` & `ProductQueryMatcher`
- [`src/agents/order-search/order-query-matcher.ts`](../../src/agents/order-search/order-query-matcher.ts):
  - Delegate query parsing and string matching to `parseSearchQuery`, `textMatches`, and `valueMatches`.
  - Retain order-specific field filter switch and free-text term matching.
- [`src/agents/product-search/product-query-matcher.ts`](../../src/agents/product-search/product-query-matcher.ts):
  - Delegate query parsing and string matching to `parseSearchQuery`, `textMatches`, and `valueMatches`.
  - Retain product-specific field filter switch and free-text term matching.
- Both preserve `new Matcher(query).matches(entity)` API without breaking changes.

### 3. `src/common/agent-discovery.ts`
Create a helper for discovering Golem agent IDs:
```typescript
export interface DiscoverAgentIdsOptions {
  readonly agentPrefix: string;
  readonly componentName?: string;
}

export function discoverAgentIds(
  options: DiscoverAgentIdsOptions
): Effect.Effect<readonly string[]>
```
- Resolves component ID via `Agents.resolveComponentId` with fallback to `Agents.getSelfMetadata`.
- Streams agents matching `${agentPrefix}(`.
- Extracts agent IDs using regex `/^${agentPrefix}\("([^"]+)"\)$/`.
- Collects and returns deduplicated string IDs.

### 4. Update Search Agents
- [`src/agents/order-search/order-search-agent.ts`](../../src/agents/order-search/order-search-agent.ts):
  - Replace `getAllOrderAgentIds` with `discoverAgentIds({ agentPrefix: "OrderAgent" })`.
- [`src/agents/product-search/product-search-agent.ts`](../../src/agents/product-search/product-search-agent.ts):
  - Replace component resolution and metadata stream in `searchProductsByQuery` with `discoverAgentIds({ agentPrefix: "ProductAgent" })`.

---

## Verification Plan

### Automated Tests
1. `npm run format` & `npm run lint`
2. `npx tsc --noEmit`
3. `npm test` (all 70 unit tests must pass, especially `order-query-matcher.test.ts` and `product-query-matcher.test.ts`)
4. `/Users/coon/opt/golem/bin/golem build --yes` (WASM build check)
