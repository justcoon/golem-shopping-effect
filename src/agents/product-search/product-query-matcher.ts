import { Product } from "../product/product-schema.js";

export class ProductQueryMatcher {
  private terms: string[];
  private fieldFilters: Map<string, string>;

  constructor(query: string) {
    const { terms, fieldFilters } = this.parseQuery(query);
    this.terms = terms;
    this.fieldFilters = fieldFilters;
  }

  private parseQuery(query: string): {
    terms: string[];
    fieldFilters: Map<string, string>;
  } {
    const terms: string[] = [];
    const fieldFilters = new Map<string, string>();
    const tokens = this.tokenize(query);

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

  private tokenize(query: string): string[] {
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

  private textMatches(text: string, query: string): boolean {
    if (query === "*") return true;
    return text.toLowerCase().includes(query.toLowerCase());
  }

  private valueMatches(text: string, query: string): boolean {
    if (query === "*") return true;
    return text === query;
  }

  public matches(product: Product): boolean {
    for (const [field, value] of this.fieldFilters.entries()) {
      let matches = false;

      switch (field) {
        case "productid":
          matches = this.valueMatches(product.productId, value);
          break;
        case "name":
          matches = this.textMatches(product.name, value);
          break;
        case "brand":
          matches = this.textMatches(product.brand, value);
          break;
        case "description":
          matches = this.textMatches(product.description, value);
          break;
        case "tag":
        case "tags":
          matches = product.tags?.some((tag) => this.textMatches(tag, value)) ?? false;
          break;
        default:
          return false;
      }

      if (!matches) {
        return false;
      }
    }

    if (this.terms.length === 0) {
      return true;
    }

    return this.terms.every((term) => {
      if (term === "*") return true;
      const searchText = [product.name, product.brand, product.description, ...(product.tags || [])]
        .join(" ")
        .toLowerCase();

      return searchText.includes(term.toLowerCase());
    });
  }
}
