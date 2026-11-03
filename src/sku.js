import { CatalogError } from "./errors.js";

const SKU = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;

export function assertSku(sku) {
  if (typeof sku !== "string" || !SKU.test(sku) || sku.includes("..")) {
    throw new CatalogError("bad_sku", "sku is ongeldig", 400);
  }
  return sku;
}
