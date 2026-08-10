import { defaultLocales } from '../shared/constants.js';
import { parseMessagePath, setValueAtPath } from '../shared/message-path.js';
import {
  assertSafeImageEdit,
  getSafeEditUrl,
  isSupportedLocale
} from '../shared/security.js';

const countLocaleEdits = (project, locale) =>
  Object.keys(project?.edits?.[locale] ?? {}).length +
  Object.keys(project?.imageEdits?.[locale] ?? {}).length +
  Object.keys(project?.blockEdits ?? {}).length;

const countProjectEdits = (project) =>
  Object.values(project?.edits ?? {}).reduce(
    (total, localeEdits) => total + Object.keys(localeEdits).length,
    0
  ) +
  Object.values(project?.imageEdits ?? {}).reduce(
    (total, localeEdits) => total + Object.keys(localeEdits).length,
    0
  ) +
  Object.keys(project?.blockEdits ?? {}).length;

const allowedBlockOperations = new Set(['duplicate', 'remove', 'reorder']);
const forbiddenBlockIds = new Set(['__proto__', 'constructor', 'prototype']);

const isSafeBlockId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9_-]+$/u.test(value) &&
  !forbiddenBlockIds.has(value);

const getBlockEditStorageKey = (edit) =>
  edit.operation === 'reorder'
    ? `reorder:${edit.collection}`
    : edit.operation === 'remove'
      ? `remove:${edit.collection}:${edit.itemId}`
      : `duplicate:${edit.collection}:${edit.newId}`;

const getAllowedLocales = (state) =>
  new Set(
    state?.contentConfig?.locales?.filter(isSupportedLocale) ?? defaultLocales
  );

const assertSafeLocale = (state, locale, label) => {
  if (!isSupportedLocale(locale) || !getAllowedLocales(state).has(locale)) {
    throw new Error(`${label}: unsupported locale "${locale}".`);
  }
};

const getEditEntries = (project, locale) => {
  const entries = [];

  Object.entries(project?.edits ?? {}).forEach(([entryLocale, localeEdits]) => {
    if (entryLocale !== locale) {
      return;
    }

    Object.values(localeEdits).forEach((edit) => {
      entries.push({
        edited: true,
        key: edit.key,
        locale: entryLocale,
        updatedAt: edit.updatedAt,
        url: edit.url,
        value: edit.value
      });
    });
  });

  Object.entries(project?.imageEdits ?? {}).forEach(
    ([entryLocale, localeEdits]) => {
      if (entryLocale !== locale) {
        return;
      }

      Object.values(localeEdits).forEach((edit) => {
        entries.push({
          edited: true,
          fileName: edit.fileName,
          key: edit.key,
          kind: 'image',
          locale: entryLocale,
          updatedAt: edit.updatedAt,
          url: edit.url,
          value: edit.fileName || 'Image replacement'
        });
      });
    }
  );

  Object.values(project?.blockEdits ?? {}).forEach((edit) => {
    const itemId =
      edit.operation === 'reorder'
        ? 'order'
        : edit.operation === 'remove'
          ? edit.itemId
          : edit.newId;

    entries.push({
      edited: true,
      key: `${edit.collection}.${edit.operation}_${itemId}`,
      kind: 'block',
      locale,
      updatedAt: edit.updatedAt,
      url: edit.url,
      value:
        edit.operation === 'reorder'
          ? `Reorder ${edit.itemIds.length} blocks`
          : edit.operation === 'remove'
            ? `Remove block ${edit.itemId}`
            : `Duplicate block ${edit.sourceId}`
    });
  });

  return entries.sort((left, right) => {
    if (left.locale !== right.locale) {
      return left.locale.localeCompare(right.locale);
    }

    return left.key.localeCompare(right.key);
  });
};

const getVisibleTreeEntries = (project, state, showUnedited) => {
  const locale = state?.locale ?? '';
  const dirtyKeys = new Set(state?.dirtyKeys ?? []);
  const editedEntries = getEditEntries(project, locale);
  const normalizedEditedEntries = editedEntries.map((entry) => ({
    ...entry,
    dirty: dirtyKeys.has(entry.key)
  }));

  if (!showUnedited) {
    return normalizedEditedEntries;
  }

  const editedKeys = new Set(normalizedEditedEntries.map((edit) => edit.key));
  const uneditedTextEntries = (state?.editableFields ?? [])
    .filter(
      (field) =>
        field.key && field.locale === locale && !editedKeys.has(field.key)
    )
    .map((field) => ({
      edited: false,
      dirty: dirtyKeys.has(field.key),
      key: field.key,
      locale,
      updatedAt: '',
      url: field.url,
      value: field.value
    }));
  const uneditedImageEntries = (state?.editableImages ?? [])
    .filter(
      (field) =>
        field.key && field.locale === locale && !editedKeys.has(field.key)
    )
    .map((field) => ({
      edited: false,
      dirty: false,
      key: field.key,
      kind: 'image',
      locale,
      updatedAt: '',
      url: field.url,
      value: 'Image'
    }));

  return [
    ...normalizedEditedEntries,
    ...uneditedTextEntries,
    ...uneditedImageEntries
  ].sort((left, right) => left.key.localeCompare(right.key));
};

const getProjectLocales = (project, state) => {
  const localeSet = getAllowedLocales(state);

  (project?.locales ?? []).forEach((locale) => {
    if (isSupportedLocale(locale)) {
      localeSet.add(locale);
    }
  });

  Object.keys(project?.edits ?? {}).forEach((locale) => {
    if (isSupportedLocale(locale)) {
      localeSet.add(locale);
    }
  });
  Object.keys(project?.imageEdits ?? {}).forEach((locale) => {
    if (isSupportedLocale(locale)) {
      localeSet.add(locale);
    }
  });

  return Array.from(localeSet);
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

const normalizeEditPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Edit file must be a JSON object.');
  }

  if (Array.isArray(payload.edits)) {
    return payload.edits.map((edit, index) => {
      if (
        !edit ||
        typeof edit !== 'object' ||
        typeof edit.key !== 'string' ||
        typeof edit.locale !== 'string' ||
        typeof edit.value !== 'string'
      ) {
        throw new Error(`Edit ${index + 1} must have key, locale, and value.`);
      }

      return edit;
    });
  }

  if (payload.messages && typeof payload.messages === 'object') {
    const edits = [];

    Object.entries(payload.messages).forEach(([locale, messages]) => {
      collectLeafEdits(messages, locale, '', edits);
    });

    return edits;
  }

  if (Array.isArray(payload.imageEdits) || Array.isArray(payload.blockEdits)) {
    return [];
  }

  throw new Error('Edit file must contain an edits array or messages object.');
};

const normalizeBlockEditPayload = (payload, state) => {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.blockEdits)
  ) {
    return [];
  }

  if (payload.blockEdits.length > 500) {
    throw new Error('Edit file cannot contain more than 500 block edits.');
  }

  return payload.blockEdits.map((edit, index) => {
    const label = `Block edit ${index + 1}`;

    if (
      !edit ||
      typeof edit !== 'object' ||
      typeof edit.collection !== 'string' ||
      !allowedBlockOperations.has(edit.operation)
    ) {
      throw new Error(`${label} must have a collection and valid operation.`);
    }

    parseMessagePath(edit.collection);

    const collectionConfig =
      state?.contentConfig?.collections?.[edit.collection];

    if (!collectionConfig || typeof collectionConfig !== 'object') {
      throw new Error(
        `${label}: collection "${edit.collection}" is not configured.`
      );
    }

    if (!collectionConfig.operations?.includes(edit.operation)) {
      throw new Error(
        `${label}: operation "${edit.operation}" is not enabled for "${edit.collection}".`
      );
    }

    if (edit.operation === 'remove') {
      if (!isSafeBlockId(edit.itemId)) {
        throw new Error(`${label}: itemId must be a safe stable ID.`);
      }

      return {
        collection: edit.collection,
        itemId: edit.itemId,
        operation: edit.operation,
        updatedAt:
          typeof edit.updatedAt === 'string'
            ? edit.updatedAt
            : new Date().toISOString(),
        url: getSafeEditUrl(edit.url, state?.origin)
      };
    }

    if (edit.operation === 'reorder') {
      if (
        !Array.isArray(edit.itemIds) ||
        edit.itemIds.length === 0 ||
        edit.itemIds.some((itemId) => !isSafeBlockId(itemId))
      ) {
        throw new Error(`${label}: itemIds must contain safe stable IDs.`);
      }

      if (new Set(edit.itemIds).size !== edit.itemIds.length) {
        throw new Error(`${label}: itemIds cannot contain duplicate IDs.`);
      }

      return {
        collection: edit.collection,
        itemIds: [...edit.itemIds],
        operation: edit.operation,
        updatedAt:
          typeof edit.updatedAt === 'string'
            ? edit.updatedAt
            : new Date().toISOString(),
        url: getSafeEditUrl(edit.url, state?.origin)
      };
    }

    if (!isSafeBlockId(edit.sourceId) || !isSafeBlockId(edit.newId)) {
      throw new Error(`${label}: sourceId and newId must be safe stable IDs.`);
    }

    if (edit.sourceId === edit.newId) {
      throw new Error(`${label}: newId must differ from sourceId.`);
    }

    if (edit.afterId != null && !isSafeBlockId(edit.afterId)) {
      throw new Error(`${label}: afterId must be a safe stable ID.`);
    }

    const overrides = {};

    Object.entries(edit.overrides ?? {}).forEach(([locale, values]) => {
      assertSafeLocale(state, locale, `${label} override`);

      if (!values || typeof values !== 'object' || Array.isArray(values)) {
        throw new Error(
          `${label}: overrides for "${locale}" must be an object.`
        );
      }

      overrides[locale] = {};

      Object.entries(values).forEach(([key, value]) => {
        const pathParts = parseMessagePath(key);

        if (pathParts[0] === collectionConfig.idField) {
          throw new Error(`${label}: the stable ID field cannot be edited.`);
        }

        if (typeof value !== 'string') {
          throw new Error(
            `${label}: override "${locale}.${key}" must be text.`
          );
        }

        overrides[locale][key] = value;
      });
    });

    return {
      afterId: edit.afterId ?? edit.sourceId,
      collection: edit.collection,
      newId: edit.newId,
      operation: edit.operation,
      overrides,
      sourceId: edit.sourceId,
      updatedAt:
        typeof edit.updatedAt === 'string'
          ? edit.updatedAt
          : new Date().toISOString(),
      url: getSafeEditUrl(edit.url, state?.origin)
    };
  });
};

const normalizeImageEditPayload = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (!Array.isArray(payload.imageEdits)) {
    return [];
  }

  return payload.imageEdits.map((edit, index) => {
    if (
      !edit ||
      typeof edit !== 'object' ||
      typeof edit.key !== 'string' ||
      typeof edit.locale !== 'string' ||
      typeof edit.dataUrl !== 'string' ||
      typeof edit.fileName !== 'string'
    ) {
      throw new Error(
        `Image edit ${index + 1} must have key, locale, dataUrl, and fileName.`
      );
    }

    return {
      ...edit,
      ...assertSafeImageEdit(edit, index)
    };
  });
};

const ensureProject = (store, payload, activeProjectId, payloadOrigin) => {
  const origin = activeProjectId ?? payloadOrigin;

  if (!origin) {
    throw new Error('Open the testing website before loading edits.');
  }

  if (
    !store.projects[origin] ||
    typeof store.projects[origin] !== 'object' ||
    Array.isArray(store.projects[origin])
  ) {
    store.projects[origin] = {
      edits: {},
      locales: Array.isArray(payload?.locales) ? payload.locales : [],
      origin,
      title:
        payload?.project && typeof payload.project.title === 'string'
          ? payload.project.title
          : origin,
      updatedAt: new Date().toISOString()
    };
  }

  if (Array.isArray(payload?.locales)) {
    store.projects[origin].locales = Array.from(
      new Set([
        ...(store.projects[origin].locales ?? []),
        ...payload.locales.filter(isSupportedLocale)
      ])
    );
  }

  return store.projects[origin];
};

const mergeEditPayload = ({
  activeProjectId,
  payload,
  payloadOrigin,
  state,
  store
}) => {
  const edits = normalizeEditPayload(payload);
  const imageEdits = normalizeImageEditPayload(payload);
  const blockEdits = normalizeBlockEditPayload(payload, state);
  const project = ensureProject(store, payload, activeProjectId, payloadOrigin);

  if (!project.edits || typeof project.edits !== 'object') {
    project.edits = {};
  }

  edits.forEach((edit, index) => {
    assertSafeLocale(state, edit.locale, `Edit ${index + 1}`);
    parseMessagePath(edit.key);

    if (
      !project.edits[edit.locale] ||
      typeof project.edits[edit.locale] !== 'object' ||
      Array.isArray(project.edits[edit.locale])
    ) {
      project.edits[edit.locale] = {};
    }

    project.edits[edit.locale][edit.key] = {
      key: edit.key,
      locale: edit.locale,
      updatedAt:
        typeof edit.updatedAt === 'string'
          ? edit.updatedAt
          : new Date().toISOString(),
      url: getSafeEditUrl(edit.url, project.origin),
      value: edit.value
    };
  });

  imageEdits.forEach((edit, index) => {
    assertSafeLocale(state, edit.locale, `Image edit ${index + 1}`);
    parseMessagePath(edit.key);

    if (
      !project.imageEdits ||
      typeof project.imageEdits !== 'object' ||
      Array.isArray(project.imageEdits)
    ) {
      project.imageEdits = {};
    }

    if (
      !project.imageEdits[edit.locale] ||
      typeof project.imageEdits[edit.locale] !== 'object' ||
      Array.isArray(project.imageEdits[edit.locale])
    ) {
      project.imageEdits[edit.locale] = {};
    }

    project.imageEdits[edit.locale][edit.key] = {
      dataUrl: edit.dataUrl,
      fileName: edit.fileName,
      key: edit.key,
      locale: edit.locale,
      mimeType: edit.mimeType,
      previewUrl: edit.previewUrl,
      updatedAt:
        typeof edit.updatedAt === 'string'
          ? edit.updatedAt
          : new Date().toISOString(),
      url: getSafeEditUrl(edit.url, project.origin)
    };
  });

  if (
    !project.blockEdits ||
    typeof project.blockEdits !== 'object' ||
    Array.isArray(project.blockEdits)
  ) {
    project.blockEdits = {};
  }

  blockEdits.forEach((edit) => {
    const storageKey = getBlockEditStorageKey(edit);
    const existing = project.blockEdits[storageKey];

    if (edit.operation !== 'duplicate') {
      project.blockEdits[storageKey] = {
        ...existing,
        ...edit
      };
      return;
    }

    const overrides = { ...(existing?.overrides ?? {}) };

    Object.entries(edit.overrides ?? {}).forEach(([locale, values]) => {
      overrides[locale] = {
        ...(overrides[locale] ?? {}),
        ...values
      };
    });

    project.blockEdits[storageKey] = {
      ...existing,
      ...edit,
      overrides
    };
  });

  project.updatedAt = new Date().toISOString();

  return {
    count: edits.length + imageEdits.length + blockEdits.length,
    project
  };
};

const buildExport = (project, locale) => {
  const locales = locale
    ? [locale]
    : Array.from(
        new Set([
          ...(project.locales ?? []),
          ...Object.keys(project.edits ?? {}),
          ...Object.keys(project.imageEdits ?? {})
        ])
      ).filter((currentLocale) => countLocaleEdits(project, currentLocale) > 0);
  const messages = {};
  const edits = [];
  const imageEdits = [];
  const blockEdits = Object.values(project.blockEdits ?? {}).map((edit) =>
    edit.operation === 'duplicate'
      ? {
          ...edit,
          overrides: locale
            ? edit.overrides?.[locale]
              ? { [locale]: edit.overrides[locale] }
              : {}
            : (edit.overrides ?? {})
        }
      : { ...edit }
  );

  locales.forEach((currentLocale) => {
    messages[currentLocale] = {};

    Object.values(project.edits?.[currentLocale] ?? {}).forEach((edit) => {
      setValueAtPath(
        messages[currentLocale],
        parseMessagePath(edit.key),
        edit.value
      );
      edits.push({
        key: edit.key,
        locale: currentLocale,
        updatedAt: edit.updatedAt,
        url: edit.url,
        value: edit.value
      });
    });

    Object.values(project.imageEdits?.[currentLocale] ?? {}).forEach((edit) => {
      imageEdits.push({
        dataUrl: edit.dataUrl,
        fileName: edit.fileName,
        key: edit.key,
        locale: currentLocale,
        mimeType: edit.mimeType,
        previewUrl: edit.previewUrl,
        updatedAt: edit.updatedAt,
        url: edit.url
      });
    });
  });

  return {
    format: 'content-kit-browser-edits',
    version: 2,
    exportedAt: new Date().toISOString(),
    project: {
      origin: project.origin,
      title: project.title
    },
    locales,
    messages,
    edits,
    imageEdits,
    blockEdits
  };
};

const getFilePrefix = (project) => {
  try {
    return new URL(project.origin).hostname.replace(/[^A-Za-z0-9_-]+/g, '-');
  } catch {
    return 'site';
  }
};

const getSuggestedFilename = (project, suffix = 'all') =>
  `content-kit-edits-${getFilePrefix(project)}-${suffix}.json`;

export {
  buildExport,
  countLocaleEdits,
  countProjectEdits,
  getProjectLocales,
  getSuggestedFilename,
  getVisibleTreeEntries,
  mergeEditPayload
};
