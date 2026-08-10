import { parseMessagePath } from '../messages/message-path.mjs';
import { fail } from '../utils/errors.mjs';

const allowedBlockOperations = new Set(['duplicate', 'remove', 'reorder']);
const forbiddenIdValues = new Set(['__proto__', 'constructor', 'prototype']);
const maxBlockIdLength = 128;
const maxBlockEdits = 500;

const isSafeBlockId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxBlockIdLength &&
  /^[A-Za-z0-9_-]+$/u.test(value) &&
  !forbiddenIdValues.has(value);

const getCollectionConfig = (config, collection, label) => {
  const collectionConfig = config.collections?.[collection];

  if (!collectionConfig || typeof collectionConfig !== 'object') {
    fail(`${label}: collection "${collection}" is not configured.`);
  }

  return collectionConfig;
};

const assertNotStableIdEdit = (key, config, label) => {
  const editPath = parseMessagePath(key, label);

  Object.entries(config.collections ?? {}).forEach(
    ([collection, collectionConfig]) => {
      const collectionPath = parseMessagePath(collection, label);
      const matchesCollection = collectionPath.every(
        (part, index) => editPath[index] === part
      );
      const itemIndex = editPath[collectionPath.length];
      const field = editPath[collectionPath.length + 1];

      if (
        matchesCollection &&
        typeof itemIndex === 'number' &&
        field === collectionConfig.idField &&
        editPath.length === collectionPath.length + 2
      ) {
        fail(
          `${label}: the stable ID field for collection "${collection}" cannot be edited.`
        );
      }
    }
  );
};

const normalizeBlockOverrides = (overrides, config, idField, label) => {
  if (overrides == null) {
    return {};
  }

  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    fail(`${label}: overrides must be an object keyed by locale.`);
  }

  const normalized = {};

  Object.entries(overrides).forEach(([locale, values]) => {
    if (!config.locales.includes(locale)) {
      fail(`${label}: override locale "${locale}" is not configured.`);
    }

    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      fail(`${label}: overrides for "${locale}" must be an object.`);
    }

    normalized[locale] = {};

    Object.entries(values).forEach(([key, value]) => {
      const pathParts = parseMessagePath(key, `${label} override`);

      if (pathParts[0] === idField) {
        fail(`${label}: the stable ID field "${idField}" cannot be edited.`);
      }

      if (typeof value !== 'string') {
        fail(`${label}: override "${locale}.${key}" must be a string.`);
      }

      normalized[locale][key] = value;
    });
  });

  return normalized;
};

const collectLeafEdits = (value, locale, path, edits) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectLeafEdits(item, locale, `${path}[${index}]`, edits);
    });
    return;
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      collectLeafEdits(child, locale, path ? `${path}.${key}` : key, edits);
    });
    return;
  }

  edits.push({
    key: path,
    locale,
    value: value == null ? '' : String(value)
  });
};

const normalizeBrowserEditExport = (payload, config) => {
  if (!payload || typeof payload !== 'object') {
    fail('Browser edit export must be a JSON object.');
  }

  const edits = [];

  if (Array.isArray(payload.edits)) {
    payload.edits.forEach((edit, index) => {
      if (!edit || typeof edit !== 'object') {
        fail(`Browser edit ${index + 1}: edit must be an object.`);
      }

      if (
        typeof edit.key !== 'string' ||
        typeof edit.locale !== 'string' ||
        typeof edit.value !== 'string'
      ) {
        fail(
          `Browser edit ${index + 1}: expected string key, locale, and value.`
        );
      }

      edits.push({
        key: edit.key,
        locale: edit.locale,
        value: edit.value
      });
    });
  } else if (payload.messages && typeof payload.messages === 'object') {
    Object.entries(payload.messages).forEach(([locale, messages]) => {
      collectLeafEdits(messages, locale, '', edits);
    });
  } else if (
    !Array.isArray(payload.imageEdits) &&
    !Array.isArray(payload.blockEdits)
  ) {
    fail('Browser edit export must contain an edits array or messages object.');
  }

  if (
    edits.length === 0 &&
    !Array.isArray(payload.imageEdits) &&
    !Array.isArray(payload.blockEdits)
  ) {
    fail('Browser edit export does not contain any edits.');
  }

  edits.forEach((edit, index) => {
    if (!config.locales.includes(edit.locale)) {
      fail(
        `Browser edit ${index + 1}: locale "${edit.locale}" is not configured.`
      );
    }

    assertNotStableIdEdit(edit.key, config, `Browser edit ${index + 1}`);
  });

  return edits;
};

const normalizeBrowserImageEditExport = (payload, config) => {
  if (!payload || typeof payload !== 'object') {
    fail('Browser edit export must be a JSON object.');
  }

  if (!Array.isArray(payload.imageEdits)) {
    return [];
  }

  const imageEdits = payload.imageEdits.map((edit, index) => {
    if (!edit || typeof edit !== 'object') {
      fail(`Browser image edit ${index + 1}: edit must be an object.`);
    }

    if (
      typeof edit.key !== 'string' ||
      typeof edit.locale !== 'string' ||
      typeof edit.dataUrl !== 'string' ||
      typeof edit.fileName !== 'string'
    ) {
      fail(
        `Browser image edit ${index + 1}: expected string key, locale, dataUrl, and fileName.`
      );
    }

    return {
      dataUrl: edit.dataUrl,
      fileName: edit.fileName,
      key: edit.key,
      locale: edit.locale,
      mimeType:
        typeof edit.mimeType === 'string'
          ? edit.mimeType
          : 'application/octet-stream'
    };
  });

  imageEdits.forEach((edit, index) => {
    if (!config.locales.includes(edit.locale)) {
      fail(
        `Browser image edit ${index + 1}: locale "${edit.locale}" is not configured.`
      );
    }

    assertNotStableIdEdit(edit.key, config, `Browser image edit ${index + 1}`);
  });

  return imageEdits;
};

const normalizeBrowserBlockEditExport = (payload, config) => {
  if (!payload || typeof payload !== 'object') {
    fail('Browser edit export must be a JSON object.');
  }

  if (!Array.isArray(payload.blockEdits)) {
    return [];
  }

  if (payload.blockEdits.length > maxBlockEdits) {
    fail(
      `Browser edit export cannot contain more than ${maxBlockEdits} block edits.`
    );
  }

  return payload.blockEdits.map((edit, index) => {
    const label = `Browser block edit ${index + 1}`;

    if (!edit || typeof edit !== 'object') {
      fail(`${label}: edit must be an object.`);
    }

    if (
      typeof edit.collection !== 'string' ||
      !allowedBlockOperations.has(edit.operation)
    ) {
      fail(`${label}: expected a configured collection and valid operation.`);
    }

    parseMessagePath(edit.collection, label);

    const collectionConfig = getCollectionConfig(
      config,
      edit.collection,
      label
    );
    const configuredOperations = Array.isArray(collectionConfig.operations)
      ? collectionConfig.operations
      : [];

    if (!configuredOperations.includes(edit.operation)) {
      fail(
        `${label}: operation "${edit.operation}" is not enabled for "${edit.collection}".`
      );
    }

    const idField = collectionConfig.idField;

    if (!isSafeBlockId(idField)) {
      fail(`${label}: collection idField must be a safe property name.`);
    }

    if (edit.operation === 'remove') {
      if (!isSafeBlockId(edit.itemId)) {
        fail(`${label}: itemId must be a safe stable ID.`);
      }

      return {
        collection: edit.collection,
        itemId: edit.itemId,
        operation: edit.operation
      };
    }

    if (edit.operation === 'reorder') {
      if (
        !Array.isArray(edit.itemIds) ||
        edit.itemIds.length === 0 ||
        edit.itemIds.some((itemId) => !isSafeBlockId(itemId))
      ) {
        fail(`${label}: itemIds must contain safe stable IDs.`);
      }

      if (new Set(edit.itemIds).size !== edit.itemIds.length) {
        fail(`${label}: itemIds cannot contain duplicate IDs.`);
      }

      return {
        collection: edit.collection,
        itemIds: [...edit.itemIds],
        operation: edit.operation
      };
    }

    if (!isSafeBlockId(edit.sourceId) || !isSafeBlockId(edit.newId)) {
      fail(`${label}: sourceId and newId must be safe stable IDs.`);
    }

    if (edit.sourceId === edit.newId) {
      fail(`${label}: newId must differ from sourceId.`);
    }

    if (edit.afterId != null && !isSafeBlockId(edit.afterId)) {
      fail(`${label}: afterId must be a safe stable ID.`);
    }

    return {
      afterId: edit.afterId ?? edit.sourceId,
      collection: edit.collection,
      newId: edit.newId,
      operation: edit.operation,
      overrides: normalizeBlockOverrides(
        edit.overrides,
        config,
        idField,
        label
      ),
      sourceId: edit.sourceId
    };
  });
};

export {
  normalizeBrowserBlockEditExport,
  normalizeBrowserEditExport,
  normalizeBrowserImageEditExport
};
