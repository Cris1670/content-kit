import { fail } from '../utils/errors.mjs';

const forbiddenPathParts = new Set(['__proto__', 'constructor', 'prototype']);
const maxArrayIndex = 5000;
const maxPathValueLength = 512;

const parseMessagePath = (pathValue, label) => {
  if (
    typeof pathValue !== 'string' ||
    pathValue.length === 0 ||
    pathValue.length > maxPathValueLength
  ) {
    fail(`${label}: invalid content key "${pathValue}".`);
  }

  const parts = [];
  const segments = pathValue.split('.');

  segments.forEach((segment) => {
    const match = segment.match(/^([A-Za-z0-9_-]+)((?:\[[0-9]+\])*)$/);

    if (!match) {
      fail(`${label}: invalid path segment "${segment}" in "${pathValue}".`);
    }

    if (forbiddenPathParts.has(match[1])) {
      fail(`${label}: forbidden path segment "${match[1]}" in "${pathValue}".`);
    }

    parts.push(match[1]);

    Array.from(match[2].matchAll(/\[([0-9]+)\]/g)).forEach((indexMatch) => {
      const index = Number(indexMatch[1]);

      if (!Number.isSafeInteger(index) || index > maxArrayIndex) {
        fail(`${label}: array index is too large in "${pathValue}".`);
      }

      parts.push(index);
    });
  });

  return parts;
};

const setValueAtPath = (root, pathParts, value) => {
  let cursor = root;

  pathParts.forEach((part, index) => {
    const isLast = index === pathParts.length - 1;
    const nextPart = pathParts[index + 1];

    if (isLast) {
      cursor[part] = value;
      return;
    }

    if (cursor[part] == null) {
      cursor[part] = typeof nextPart === 'number' ? [] : {};
    }

    cursor = cursor[part];
  });
};

const assertNoSparseArrays = (value, path = '') => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) {
        fail(`Sparse array detected at ${path}[${index}].`);
      }

      assertNoSparseArrays(value[index], `${path}[${index}]`);
    }

    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      assertNoSparseArrays(child, path ? `${path}.${key}` : key);
    });
  }
};

export { assertNoSparseArrays, parseMessagePath, setValueAtPath };
