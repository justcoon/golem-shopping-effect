import { parseSearchQuery, textMatches, valueMatches } from "../../common/index.js";
import { Product } from "../product/product-schema.js";

export class ProductQueryMatcher {
  private terms: readonly string[];
  private fieldFilters: ReadonlyMap<string, string>;

  constructor(query: string) {
    const { terms, fieldFilters } = parseSearchQuery(query);
    this.terms = terms;
    this.fieldFilters = fieldFilters;
  }

  public matches(product: Product): boolean {
    for (const [field, value] of this.fieldFilters.entries()) {
      let matches = false;

      switch (field) {
        case "productid":
          matches = valueMatches(product.productId, value, true);
          break;
        case "name":
          matches = textMatches(product.name, value);
          break;
        case "brand":
          matches = textMatches(product.brand, value);
          break;
        case "description":
          matches = textMatches(product.description, value);
          break;
        case "tag":
        case "tags":
          matches = product.tags?.some((tag) => textMatches(tag, value)) ?? false;
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
