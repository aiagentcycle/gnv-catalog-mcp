// Fout met een vaste code. De code gaat naar de client; de melding is kort en bevat nooit interne details.
export class CatalogError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "CatalogError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}
