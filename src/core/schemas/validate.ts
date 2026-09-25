/**
 * Minimal JSON Schema subset validator for AgentDoctor v2 report schemas.
 * Supports: type, required, properties, items, enum, integer/string/boolean/object/array/null unions.
 * Not a full draft-2020 implementation — sufficient for shipped schemas without new deps.
 */
export function validateAgainstSchema(
  schema: Record<string, unknown>,
  value: unknown,
  path = "$",
): string[] {
  const errors: string[] = [];
  const type = schema.type;

  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (!types.some((t) => matchesType(t, value))) {
      errors.push(`${path}: expected type ${types.join("|")}`);
      return errors;
    }
  }

  if (value === null || value === undefined) {
    return errors;
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: value not in enum`);
  }

  if (typeof value === "object" && !Array.isArray(value) && schema.properties) {
    const obj = value as Record<string, unknown>;
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in obj)) errors.push(`${path}.${key}: required`);
    }
    for (const [key, childSchema] of Object.entries(props)) {
      if (key in obj) {
        errors.push(...validateAgainstSchema(childSchema, obj[key], `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    for (let i = 0; i < value.length; i += 1) {
      errors.push(
        ...validateAgainstSchema(
          schema.items as Record<string, unknown>,
          value[i],
          `${path}[${i}]`,
        ),
      );
    }
  }

  return errors;
}

function matchesType(type: unknown, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
