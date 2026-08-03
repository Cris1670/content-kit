import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertNoSparseArrays,
  parseMessagePath,
  setValueAtPath
} from '../messages/message-path.mjs';
import { fail } from '../utils/errors.mjs';
import { readJsonFile, toUtf8Json } from '../utils/json.mjs';

const getValueAtPath = (root, pathParts) => {
  let cursor = root;

  for (const part of pathParts) {
    if (cursor == null || typeof cursor !== 'object') {
      return undefined;
    }

    cursor = cursor[part];
  }

  return cursor;
};

const getCollectionLimits = (collectionConfig) => ({
  maxItems:
    Number.isSafeInteger(collectionConfig.maxItems) &&
    collectionConfig.maxItems > 0
      ? collectionConfig.maxItems
      : 100,
  minItems:
    Number.isSafeInteger(collectionConfig.minItems) &&
    collectionConfig.minItems >= 0
      ? collectionConfig.minItems
      : 0
});

const getCollection = (catalog, collection, locale) => {
  const value = getValueAtPath(
    catalog,
    parseMessagePath(collection, `Block collection for ${locale}`)
  );

  if (!Array.isArray(value)) {
    fail(
      `Block collection "${collection}" must be an array in ${locale}.json.`
    );
  }

  return value;
};

const findItemIndex = (items, idField, itemId, label) => {
  const matchingIndexes = [];

  items.forEach((item, index) => {
    if (item && typeof item === 'object' && item[idField] === itemId) {
      matchingIndexes.push(index);
    }
  });

  if (matchingIndexes.length > 1) {
    fail(`${label}: stable ID "${itemId}" is duplicated.`);
  }

  return matchingIndexes[0] ?? -1;
};

const applyDuplicate = (edit, config, catalogs) => {
  const collectionConfig = config.collections[edit.collection];
  const { idField } = collectionConfig;

  catalogs.forEach(({ catalog, locale }) => {
    const label = `Duplicate block "${edit.newId}" in ${locale}.json`;
    const items = getCollection(catalog, edit.collection, locale);
    let targetIndex = findItemIndex(items, idField, edit.newId, label);

    if (targetIndex < 0) {
      const sourceIndex = findItemIndex(items, idField, edit.sourceId, label);

      if (sourceIndex < 0) {
        fail(`${label}: source ID "${edit.sourceId}" was not found.`);
      }

      const afterIndex = findItemIndex(items, idField, edit.afterId, label);

      if (afterIndex < 0) {
        fail(`${label}: insertion ID "${edit.afterId}" was not found.`);
      }

      const duplicate = structuredClone(items[sourceIndex]);

      duplicate[idField] = edit.newId;
      items.splice(afterIndex + 1, 0, duplicate);
      targetIndex = afterIndex + 1;
    }

    const target = items[targetIndex];

    Object.entries(edit.overrides[locale] ?? {}).forEach(([key, value]) => {
      setValueAtPath(target, parseMessagePath(key, `${label} override`), value);
    });
  });
};

const applyRemove = (edit, config, catalogs) => {
  const collectionConfig = config.collections[edit.collection];
  const { idField } = collectionConfig;

  catalogs.forEach(({ catalog, locale }) => {
    const label = `Remove block "${edit.itemId}" from ${locale}.json`;
    const items = getCollection(catalog, edit.collection, locale);
    const itemIndex = findItemIndex(items, idField, edit.itemId, label);

    if (itemIndex < 0) {
      return;
    }

    items.splice(itemIndex, 1);
  });
};

const applyReorder = (edit, config, catalogs) => {
  const collectionConfig = config.collections[edit.collection];
  const { idField } = collectionConfig;

  catalogs.forEach(({ catalog, locale }) => {
    const label = `Reorder blocks in "${edit.collection}" for ${locale}.json`;
    const items = getCollection(catalog, edit.collection, locale);
    const itemsById = new Map(
      items.map((item, index) => {
        const itemId = item?.[idField];

        if (typeof itemId !== 'string') {
          fail(`${label}: item ${index + 1} does not have a stable ID.`);
        }

        return [itemId, item];
      })
    );

    if (
      edit.itemIds.length !== items.length ||
      edit.itemIds.some((itemId) => !itemsById.has(itemId))
    ) {
      fail(`${label}: itemIds must exactly match the final collection IDs.`);
    }

    items.splice(
      0,
      items.length,
      ...edit.itemIds.map((itemId) => itemsById.get(itemId))
    );
  });
};

const assertCollectionIntegrity = (collection, config, catalogs) => {
  const collectionConfig = config.collections[collection];
  const { idField } = collectionConfig;
  const { maxItems, minItems } = getCollectionLimits(collectionConfig);
  let referenceIds = null;

  catalogs.forEach(({ catalog, locale }) => {
    const items = getCollection(catalog, collection, locale);
    const ids = items.map((item, index) => {
      const itemId = item?.[idField];

      if (
        !item ||
        typeof item !== 'object' ||
        typeof itemId !== 'string' ||
        !/^[A-Za-z0-9_-]+$/u.test(itemId) ||
        itemId === '__proto__' ||
        itemId === 'constructor' ||
        itemId === 'prototype'
      ) {
        fail(
          `Block collection "${collection}" item ${index + 1} in ${locale}.json must have a safe string "${idField}".`
        );
      }

      return itemId;
    });

    if (new Set(ids).size !== ids.length) {
      fail(
        `Block collection "${collection}" has duplicate IDs in ${locale}.json.`
      );
    }

    if (items.length < minItems || items.length > maxItems) {
      fail(
        `Block collection "${collection}" in ${locale}.json must contain between ${minItems} and ${maxItems} items.`
      );
    }

    if (
      referenceIds &&
      (referenceIds.length !== ids.length ||
        referenceIds.some((itemId, index) => itemId !== ids[index]))
    ) {
      fail(
        `Block collection "${collection}" must use the same IDs in the same order for every locale.`
      );
    }

    referenceIds = ids;
  });
};

const applyBlockEdits = (blockEdits, config, paths, options = {}) => {
  if (blockEdits.length === 0) {
    return;
  }

  const catalogs = config.locales.map((locale) => {
    const messagePath = join(paths.messagesDir, `${locale}.json`);

    if (!existsSync(messagePath)) {
      fail(
        `Message catalog required for block edits was not found: ${messagePath}`
      );
    }

    return {
      catalog: readJsonFile(messagePath),
      locale,
      messagePath
    };
  });
  const editedCollections = Array.from(
    new Set(blockEdits.map((edit) => edit.collection))
  );

  editedCollections.forEach((collection) => {
    assertCollectionIntegrity(collection, config, catalogs);
  });

  blockEdits
    .filter((edit) => edit.operation === 'duplicate')
    .forEach((edit) => {
      applyDuplicate(edit, config, catalogs);
    });
  blockEdits
    .filter((edit) => edit.operation === 'remove')
    .forEach((edit) => {
      applyRemove(edit, config, catalogs);
    });
  blockEdits
    .filter((edit) => edit.operation === 'reorder')
    .forEach((edit) => {
      applyReorder(edit, config, catalogs);
    });

  editedCollections.forEach((collection) => {
    assertCollectionIntegrity(collection, config, catalogs);
  });

  catalogs.forEach(({ catalog, messagePath }) => {
    assertNoSparseArrays(catalog);

    if (options.write !== false) {
      writeFileSync(messagePath, toUtf8Json(catalog), 'utf-8');
    }
  });
};

export { applyBlockEdits };
