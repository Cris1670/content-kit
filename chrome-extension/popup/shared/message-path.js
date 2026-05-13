import {
  forbiddenPathParts,
  maxArrayIndex,
  maxContentKeyLength
} from './constants.js';

const parseMessagePath = (pathValue) => {
  if (
    typeof pathValue !== 'string' ||
    pathValue.length === 0 ||
    pathValue.length > maxContentKeyLength
  ) {
    throw new Error(`Invalid content key: ${pathValue}`);
  }

  const parts = [];

  pathValue.split('.').forEach((segment) => {
    const match = segment.match(/^([A-Za-z0-9_-]+)((?:\[[0-9]+\])*)$/);

    if (!match) {
      throw new Error(`Invalid content key: ${pathValue}`);
    }

    if (forbiddenPathParts.has(match[1])) {
      throw new Error(`Forbidden content key segment: ${match[1]}`);
    }

    parts.push(match[1]);

    Array.from(match[2].matchAll(/\[([0-9]+)\]/g)).forEach((indexMatch) => {
      const index = Number(indexMatch[1]);

      if (!Number.isSafeInteger(index) || index > maxArrayIndex) {
        throw new Error(
          `Array index is too large in content key: ${pathValue}`
        );
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

export { parseMessagePath, setValueAtPath };
