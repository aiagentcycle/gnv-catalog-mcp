import { CatalogError } from "./errors.js";

// Euro's (string of getal) naar hele centen, zonder floating-point-afronding.
export function eurosToCents(value) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new CatalogError("bad_amount", "bedrag is geen getal", 502);
  }
  const text = amount.toFixed(2);
  const negative = text.startsWith("-");
  const [whole, frac] = text.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac);
  return negative ? -cents : cents;
}
