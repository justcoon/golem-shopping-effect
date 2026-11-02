import { Order } from "../order/index.js";

export class OrderQueryMatcher {
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
    return text.toLowerCase() === query.toLowerCase();
  }

  public matches(order: Order): boolean {
    // 1. Check field filters (e.g. status:new, userid:user-123, orderid:uuid)
    for (const [field, value] of this.fieldFilters.entries()) {
      let matches = false;

      switch (field) {
        case "orderid":
        case "id":
          matches = this.valueMatches(order.orderId, value);
          break;
        case "userid":
          matches = this.valueMatches(order.userId, value);
          break;
        case "status":
        case "orderstatus":
          matches = this.valueMatches(order.orderStatus, value);
          break;
        case "email":
          matches = order.email ? this.textMatches(order.email, value) : false;
          break;
        case "productid":
          matches = order.items.some((item) => this.valueMatches(item.productId, value));
          break;
        default:
          matches = true;
          break;
      }

      if (!matches) {
        return false;
      }
    }

    // 2. Check general free-text terms
    if (this.terms.length === 0) {
      return true;
    }

    return this.terms.every((term) => {
      if (term === "*") return true;

      if (this.textMatches(order.orderId, term)) return true;
      if (this.textMatches(order.userId, term)) return true;
      if (this.textMatches(order.orderStatus, term)) return true;
      if (order.email && this.textMatches(order.email, term)) return true;
      if (order.shippingAddress?.name && this.textMatches(order.shippingAddress.name, term))
        return true;
      if (order.billingAddress?.name && this.textMatches(order.billingAddress.name, term))
        return true;

      // Check item product names or brands
      return order.items.some(
        (item) =>
          this.textMatches(item.productName, term) ||
          this.textMatches(item.productBrand, term) ||
          this.textMatches(item.productId, term),
      );
    });
  }
}
