import { defaultLocales } from '../shared/constants.js';
import { parseMessagePath, setValueAtPath } from '../shared/message-path.js';
import {
  assertSafeImageEdit,
  getSafeEditUrl,
  isSupportedLocale
} from '../shared/security.js';

const countLocaleEdits = (project, locale) =>
  Object.keys(project?.edits?.[locale] ?? {}).length +
  Object.keys(project?.imageEdits?.[locale] ?? {}).length;

const countProjectEdits = (project) =>
  Object.values(project?.edits ?? {}).reduce(
    (total, localeEdits) => total + Object.keys(localeEdits).length,
    0
  ) +
  Object.values(project?.imageEdits ?? {}).reduce(
    (total, localeEdits) => total + Object.keys(localeEdits).length,
    0
  );

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

  if (Array.isArray(payload.imageEdits)) {
    return [];
  }

  throw new Error('Edit file must contain an edits array or messages object.');
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
      origin,
      title:
        payload?.project && typeof payload.project.title === 'string'
          ? payload.project.title
          : origin,
      updatedAt: new Date().toISOString()
    };
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

  project.updatedAt = new Date().toISOString();

  return {
    count: edits.length + imageEdits.length,
    project
  };
};

const buildExport = (project, locale) => {
  const locales = locale
    ? [locale]
    : Array.from(
        new Set([
          ...Object.keys(project.edits ?? {}),
          ...Object.keys(project.imageEdits ?? {})
        ])
      ).filter((currentLocale) => countLocaleEdits(project, currentLocale) > 0);
  const messages = {};
  const edits = [];
  const imageEdits = [];

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
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      origin: project.origin,
      title: project.title
    },
    locales,
    messages,
    edits,
    imageEdits
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
