import { CatalogError } from "./errors.js";

// Elke uitgaande request moet naar een host op de allowlist (alleen de shop-origin).
export function assertEgress(target, allowHosts) {
  let host;
  try {
    host = new URL(target).hostname;
  } catch {
    throw new CatalogError("bad_host", "egress-doel is geen absolute URL", 400);
  }
  if (!allowHosts.includes(host)) {
    throw new CatalogError("egress_denied", "egress buiten de allowlist", 403);
  }
  return host;
}
