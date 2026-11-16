export interface ParsedSearchQuery {
  readonly terms: readonly string[];
  readonly fieldFilters: ReadonlyMap<string, string>;
}

export function tokenizeSearchQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (const char of query) {
    if (char === " " && !inQuotes) {
      if (current.trim()) {
        tokens.push(current.trim());
        current = "";
      }
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    tokens.push(current.trim());
  }

  return tokens;
}

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const terms: string[] = [];
  const fieldFilters = new Map<string, string>();
  const tokens = tokenizeSearchQuery(query);

  for (const part of tokens) {
    const fieldMatch = part.match(/^([a-zA-Z]+):(.*)$/);
    if (fieldMatch) {
      const field = fieldMatch[1];
      const value = fieldMatch[2];
      if (field && value) {
        fieldFilters.set(field.toLowerCase(), value);
      }
    } else {
      terms.push(part);
    }
  }

  return { terms, fieldFilters };
}

export function textMatches(text: string, query: string): boolean {
  if (query === "*") return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

export function valueMatches(text: string, query: string, caseSensitive = false): boolean {
  if (query === "*") return true;
  return caseSensitive ? text === query : text.toLowerCase() === query.toLowerCase();
}
