import { parseSearchQuery, textMatches, valueMatches } from "../../common/index.js";
import { Order } from "../order/index.js";

export class OrderQueryMatcher {
  private terms: readonly string[];
  private fieldFilters: ReadonlyMap<string, string>;

  constructor(query: string) {
    const { terms, fieldFilters } = parseSearchQuery(query);
    this.terms = terms;
    this.fieldFilters = fieldFilters;
  }

  public matches(order: Order): boolean {
    // 1. Check field filters (e.g. status:new, userid:user-123, orderid:uuid)
    for (const [field, value] of this.fieldFilters.entries()) {
      let matches = false;

      switch (field) {
        case "orderid":
        case "id":
          matches = valueMatches(order.orderId, value);
          break;
        case "userid":
          matches = valueMatches(order.userId, value);
          break;
        case "status":
        case "orderstatus":
          matches = valueMatches(order.orderStatus, value);
          break;
        case "email":
          matches = order.email ? textMatches(order.email, value) : false;
          break;
        case "productid":
          matches = order.items.some((item) => valueMatches(item.productId, value));
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

      if (textMatches(order.orderId, term)) return true;
      if (textMatches(order.userId, term)) return true;
      if (textMatches(order.orderStatus, term)) return true;
      if (order.email && textMatches(order.email, term)) return true;
      if (order.shippingAddress?.name && textMatches(order.shippingAddress.name, term)) return true;
      if (order.billingAddress?.name && textMatches(order.billingAddress.name, term)) return true;

      // Check item product names or brands
      return order.items.some(
        (item) =>
          textMatches(item.productName, term) ||
          textMatches(item.productBrand, term) ||
          textMatches(item.productId, term),
      );
    });
  }
}
