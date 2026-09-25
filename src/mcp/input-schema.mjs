// Validates tool arguments against the subset of JSON Schema the tool
// definitions use, so the advertised schema and the enforced one cannot drift.

class ToolInputError extends Error {}

const typeOf = (value) => {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return 'integer';
  }

  return typeof value;
};

const matchesType = (expected, value) => {
  const actual = typeOf(value);
  return expected === actual || (expected === 'number' && actual === 'integer');
};

const checkValue = (schema, value, path) => {
  if (!matchesType(schema.type, value)) {
    throw new ToolInputError(`${path} must be of type ${schema.type}.`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    throw new ToolInputError(
      `${path} must be one of: ${schema.enum.join(', ')}.`
    );
  }

  if (schema.type === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      throw new ToolInputError(`${path} is too short.`);
    }

    if (schema.maxLength != null && value.length > schema.maxLength) {
      throw new ToolInputError(
        `${path} must be at most ${schema.maxLength} characters.`
      );
    }

    if (schema.pattern != null) {
      // eslint-disable-next-line security/detect-non-literal-regexp
      if (!new RegExp(schema.pattern, 'u').test(value)) {
        throw new ToolInputError(`${path} has an invalid format.`);
      }
    }
  }

  if (schema.type === 'integer' || schema.type === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      throw new ToolInputError(`${path} must be at least ${schema.minimum}.`);
    }

    if (schema.maximum != null && value > schema.maximum) {
      throw new ToolInputError(`${path} must be at most ${schema.maximum}.`);
    }
  }

  if (schema.type === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) {
      throw new ToolInputError(
        `${path} needs at least ${schema.minItems} items.`
      );
    }

    if (schema.maxItems != null && value.length > schema.maxItems) {
      throw new ToolInputError(
        `${path} allows at most ${schema.maxItems} items.`
      );
    }

    value.forEach((item, index) =>
      checkValue(schema.items, item, `${path}[${index}]`)
    );
  }

  if (schema.type === 'object') {
    const properties = schema.properties ?? {};

    (schema.required ?? []).forEach((name) => {
      if (!Object.hasOwn(value, name)) {
        throw new ToolInputError(`${path}.${name} is required.`);
      }
    });

    Object.entries(value).forEach(([name, child]) => {
      if (!Object.hasOwn(properties, name)) {
        throw new ToolInputError(`${path}.${name} is not a known argument.`);
      }

      checkValue(properties[name], child, `${path}.${name}`);
    });
  }
};

const validateToolInput = (schema, value) => {
  checkValue(schema, value ?? {}, 'arguments');
  return value ?? {};
};

export { ToolInputError, validateToolInput };
