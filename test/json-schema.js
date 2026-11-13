// Small JSON Schema validator for the subset the outputSchemas use: type (also as an array, for
// nullable fields), properties, required, items, enum and additionalProperties. Any other keyword
// throws, so a schema cannot quietly grow beyond what these tests check. Contains no tests itself.

const KNOWN = new Set(["type", "properties", "required", "items", "enum", "additionalProperties", "description"]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  return actual === type || (type === "number" && actual === "integer");
}

// Returns a list of errors; an empty list means the value is valid.
export function validate(schema, value, at = "$") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`${at}: schema is not an object`);
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) throw new Error(`${at}: unsupported keyword ${key}`);
  }
  const errors = [];
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      return [`${at}: expected ${types.join(" or ")}, got ${typeOf(value)}`];
    }
  }
  if (schema.enum !== undefined && !schema.enum.some((option) => option === value)) {
    errors.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (typeOf(value) === "object") {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${at}: missing required ${key}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) errors.push(...validate(properties[key], child, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validate(schema.additionalProperties, child, `${at}.${key}`));
      }
    }
  }
  if (typeOf(value) === "array" && schema.items !== undefined) {
    value.forEach((item, index) => errors.push(...validate(schema.items, item, `${at}[${index}]`)));
  }
  return errors;
}
