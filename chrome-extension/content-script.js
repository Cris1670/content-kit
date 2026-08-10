const editSelector = '[data-ck-edit]';
const imageSelector = '[data-ck-image]';
const selectSelector = '[data-ck-select][data-ck-select-value]';
const selectOptionSelector = '[data-ck-option]';
const blockSelector = '[data-ck-block][data-ck-block-id][data-ck-block-prefix]';
const blockControlSelector = '[data-ck-block-controls]';
const collectionSelector = '[data-ck-collection][data-ck-collection-total]';
const maxConfigLocales = 20;
const maxConfigCollections = 50;
const maxConfigSelections = 50;
const maxLocalePathPatternLength = 160;
const maxArrayIndex = 5000;
const maxContentKeyLength = 512;
const maxImageBytes = 5 * 1024 * 1024;
const maxSelectOptions = 32;
const selectOptionsPerPage = 6;
const pendingScrollStorageKey = 'contentKitPendingScroll';
const storageKey = 'contentKitBrowserEdits';
const experimentalFeaturesStorageKey = 'contentKitExperimentalFeatures';
const allowedImageExtensions = new Set(['gif', 'jpg', 'jpeg', 'png', 'webp']);
const allowedImageTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const forbiddenPathParts = new Set(['__proto__', 'constructor', 'prototype']);
const dragActivationDistance = 6;
const reorderDuration = 180;
const reorderEasing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const blockControlsGap = 8;
const blockControlsViewportPadding = 8;
const blockControlsPlacements = new Set([
  'auto',
  'top-start',
  'top-end',
  'bottom-start',
  'bottom-end',
  'left',
  'right'
]);
const automaticBlockControlsPlacements = [
  'top-end',
  'bottom-end',
  'right',
  'left',
  'top-start',
  'bottom-start'
];
const defaultContentConfig = {
  baseLocale: 'en',
  collections: {},
  selections: {},
  localePathPattern: '^/(?<locale>[A-Za-z]{2}(?:-[A-Za-z]{2})?)(?<rest>/.*)?$',
  locales: ['en', 'de', 'fr', 'it']
};

const state = {
  contentConfig: defaultContentConfig,
  dirtyKeys: [],
  editModeEnabled: false,
  editableCount: 0,
  editableFields: [],
  editableImages: [],
  editableBlocks: [],
  editCount: 0,
  experimentalFeatures: {
    ordering: false
  },
  extensionEnabled: false,
  locale: '',
  origin: '',
  pageEditable: false
};

const boundElements = new WeakSet();
const blockAnimations = new WeakMap();
const blockControlSessions = new WeakMap();
const configuredIconMarkupCache = new Map();
const dirtyKeys = new Set();
const visibleBlockControls = new Set();

let activeBlockControls = null;
let activeDrag = null;
let activeSelectPicker = null;
let blockControlsPositionFrame = 0;
let blockControlsResizeObserver = null;
let observer = null;
let refreshPendingAfterDrag = false;
let refreshTimer = 0;
let suppressBlockObserver = false;

const isSupportedLocale = (locale) =>
  /^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(locale);

const isSafeBlockId = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  /^[A-Za-z0-9_-]+$/u.test(value) &&
  !forbiddenPathParts.has(value);

const isSafeContentKey = (key) => {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > maxContentKeyLength
  ) {
    return false;
  }

  return key.split('.').every((segment) => {
    const match = segment.match(/^([A-Za-z0-9_-]+)((?:\[[0-9]+\])*)$/);

    if (!match || forbiddenPathParts.has(match[1])) {
      return false;
    }

    return Array.from(match[2].matchAll(/\[([0-9]+)\]/g)).every(
      (indexMatch) => {
        const index = Number(indexMatch[1]);

        return Number.isSafeInteger(index) && index <= maxArrayIndex;
      }
    );
  });
};

const getSafeLocalePathPattern = (pattern) => {
  if (
    typeof pattern !== 'string' ||
    pattern.length === 0 ||
    pattern.length > maxLocalePathPatternLength ||
    !pattern.includes('?<locale>')
  ) {
    return defaultContentConfig.localePathPattern;
  }

  try {
    new RegExp(pattern);
    return pattern;
  } catch {
    return defaultContentConfig.localePathPattern;
  }
};

const getSafeCollections = (collections) => {
  if (
    !collections ||
    typeof collections !== 'object' ||
    Array.isArray(collections)
  ) {
    return {};
  }

  const safeCollections = {};

  Object.entries(collections)
    .slice(0, maxConfigCollections)
    .forEach(([collection, value]) => {
      if (
        !isSafeContentKey(collection) ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !isSafeBlockId(value.idField)
      ) {
        return;
      }

      const operations = Array.isArray(value.operations)
        ? value.operations.filter(
            (operation) =>
              operation === 'duplicate' ||
              operation === 'remove' ||
              operation === 'reorder'
          )
        : [];
      const minItems =
        Number.isSafeInteger(value.minItems) && value.minItems >= 0
          ? value.minItems
          : 0;
      const maxItems =
        Number.isSafeInteger(value.maxItems) && value.maxItems > 0
          ? Math.min(value.maxItems, 500)
          : 100;

      safeCollections[collection] = {
        idField: value.idField,
        maxItems: Math.max(maxItems, minItems),
        minItems,
        operations: Array.from(new Set(operations))
      };
    });

  return safeCollections;
};

const getSafeSelections = (selections) => {
  if (
    !selections ||
    typeof selections !== 'object' ||
    Array.isArray(selections)
  ) {
    return {};
  }

  const safeSelections = {};

  Object.entries(selections)
    .slice(0, maxConfigSelections)
    .forEach(([selectionId, value]) => {
      if (
        !isSafeBlockId(selectionId) ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !Array.isArray(value.options)
      ) {
        return;
      }

      const seenValues = new Set();
      const options = value.options
        .slice(0, maxSelectOptions)
        .map((option) => {
          if (!option || typeof option !== 'object' || Array.isArray(option)) {
            return null;
          }

          const valueIsSafe = isSafeBlockId(option.value);
          const label =
            typeof option.label === 'string'
              ? option.label.trim().slice(0, 80)
              : '';
          const icon =
            typeof option.icon === 'string'
              ? option.icon.trim().slice(0, 512)
              : '';

          if (!valueIsSafe || !label || seenValues.has(option.value)) {
            return null;
          }

          seenValues.add(option.value);
          return { icon, label, value: option.value };
        })
        .filter(Boolean);

      if (options.length === 0) {
        return;
      }

      safeSelections[selectionId] = {
        options,
        scope: value.scope === 'all' ? 'all' : 'locale'
      };
    });

  return safeSelections;
};

const readContentConfig = () => {
  const configElement = document.getElementById('content-kit-config');

  if (!configElement?.textContent) {
    return defaultContentConfig;
  }

  try {
    const config = JSON.parse(configElement.textContent);

    if (
      !config ||
      !Array.isArray(config.locales) ||
      typeof config.baseLocale !== 'string' ||
      typeof config.localePathPattern !== 'string'
    ) {
      return defaultContentConfig;
    }

    const locales = config.locales
      .filter(
        (locale) => typeof locale === 'string' && isSupportedLocale(locale)
      )
      .slice(0, maxConfigLocales);
    const safeLocales =
      locales.length > 0 ? locales : defaultContentConfig.locales;
    const baseLocale = isSupportedLocale(config.baseLocale)
      ? config.baseLocale
      : defaultContentConfig.baseLocale;

    return {
      baseLocale: safeLocales.includes(baseLocale)
        ? baseLocale
        : safeLocales[0],
      collections: getSafeCollections(config.collections),
      selections: getSafeSelections(config.selections),
      localePathPattern: getSafeLocalePathPattern(config.localePathPattern),
      locales: safeLocales
    };
  } catch {
    return defaultContentConfig;
  }
};

const getLocale = () => {
  try {
    const localeMatch = window.location.pathname.match(
      new RegExp(state.contentConfig.localePathPattern)
    );
    const configLocale = localeMatch?.groups?.locale;

    if (configLocale) {
      return configLocale;
    }
  } catch {
    // Fall through to the generic locale detection below.
  }

  const pathLocale = window.location.pathname.split('/').filter(Boolean)[0];

  if (/^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(pathLocale)) {
    return pathLocale;
  }

  const htmlLocale = document.documentElement.lang;

  if (htmlLocale && isSupportedLocale(htmlLocale)) {
    return htmlLocale;
  }

  return 'en';
};

const getLocaleUrl = (locale) => {
  const url = new URL(window.location.href);

  try {
    const localePattern = new RegExp(state.contentConfig.localePathPattern);
    const localeMatch = url.pathname.match(localePattern);
    const currentLocale = localeMatch?.groups?.locale;

    if (localeMatch && currentLocale) {
      const matchedPath = localeMatch[0];
      const localeOffset = matchedPath.indexOf(currentLocale);

      if (localeOffset >= 0) {
        const start = localeMatch.index + localeOffset;
        const end = start + currentLocale.length;

        url.pathname =
          url.pathname.slice(0, start) + locale + url.pathname.slice(end);

        return url.href;
      }
    }
  } catch {
    // Fall through to the generic locale prefix below.
  }

  const currentPath = url.pathname.startsWith('/')
    ? url.pathname
    : `/${url.pathname}`;

  url.pathname = `/${locale}${currentPath}`;

  return url.href;
};

const switchLocale = (locale) => {
  if (!state.contentConfig.locales.includes(locale)) {
    return state;
  }

  const nextUrl = getLocaleUrl(locale);

  state.locale = locale;

  if (nextUrl !== window.location.href) {
    window.location.assign(nextUrl);
  }

  return state;
};

const getComparableUrl = (url) => {
  try {
    const parsedUrl = new URL(url);

    return `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return '';
  }
};

const isCurrentPageTarget = (url) => {
  if (!url) {
    return true;
  }

  return getComparableUrl(url) === getComparableUrl(window.location.href);
};

const getEditableElement = (key) =>
  isSafeContentKey(key)
    ? (Array.from(
        document.querySelectorAll(
          `${editSelector}, ${imageSelector}, ${selectSelector}`
        )
      ).find(
        (element) =>
          element.getAttribute('data-ck-edit') === key ||
          element.getAttribute('data-ck-image') === key ||
          element.getAttribute('data-ck-select') === key
      ) ?? null)
    : null;

const scrollToEditKey = (key) => {
  const element = getEditableElement(key);

  if (!element) {
    return false;
  }

  document.querySelectorAll('[data-ck-target]').forEach((target) => {
    delete target.dataset.ckTarget;
  });

  element.dataset.ckTarget = 'true';
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest'
  });

  if (state.editModeEnabled && element.getAttribute('contenteditable')) {
    element.focus({ preventScroll: true });
  } else if (state.editModeEnabled && element.matches(selectSelector)) {
    element.focus({ preventScroll: true });
  }

  window.setTimeout(() => {
    delete element.dataset.ckTarget;
  }, 2200);

  return true;
};

const consumePendingScroll = async () => {
  const result = await chrome.storage.local.get({
    [pendingScrollStorageKey]: null
  });
  const pending = result[pendingScrollStorageKey];

  if (
    !pending ||
    pending.origin !== getProjectId() ||
    typeof pending.key !== 'string' ||
    !isSafeContentKey(pending.key) ||
    !isCurrentPageTarget(pending.url)
  ) {
    return;
  }

  if (scrollToEditKey(pending.key)) {
    await chrome.storage.local.remove(pendingScrollStorageKey);
  }
};

const getProjectId = () => window.location.origin;

const getProjectTitle = () =>
  document.title || window.location.hostname || getProjectId();

const getEmptyStore = () => ({
  version: 1,
  projects: {}
});

const getStore = async () => {
  const result = await chrome.storage.local.get({
    [storageKey]: getEmptyStore()
  });
  const store = result[storageKey];

  if (
    !store ||
    typeof store !== 'object' ||
    !store.projects ||
    typeof store.projects !== 'object' ||
    Array.isArray(store.projects)
  ) {
    return getEmptyStore();
  }

  return store;
};

const saveStore = async (store) => {
  await chrome.storage.local.set({ [storageKey]: store });
};

const ensureProject = (store) => {
  const origin = getProjectId();

  if (!store.projects[origin] || typeof store.projects[origin] !== 'object') {
    store.projects[origin] = {
      edits: {},
      origin,
      title: getProjectTitle(),
      updatedAt: new Date().toISOString()
    };
  }

  if (
    !store.projects[origin].edits ||
    typeof store.projects[origin].edits !== 'object' ||
    Array.isArray(store.projects[origin].edits)
  ) {
    store.projects[origin].edits = {};
  }

  if (
    !store.projects[origin].blockEdits ||
    typeof store.projects[origin].blockEdits !== 'object' ||
    Array.isArray(store.projects[origin].blockEdits)
  ) {
    store.projects[origin].blockEdits = {};
  }

  store.projects[origin].title = getProjectTitle();
  store.projects[origin].updatedAt = new Date().toISOString();
  store.projects[origin].locales = state.contentConfig.locales;

  return store.projects[origin];
};

const getLocaleEdits = async () => {
  const store = await getStore();
  const project = store.projects[getProjectId()];
  const locale = getLocale();

  return project?.edits?.[locale] ?? {};
};

const getLocaleImageEdits = async () => {
  const store = await getStore();
  const project = store.projects[getProjectId()];
  const locale = getLocale();

  return project?.imageEdits?.[locale] ?? {};
};

const getBlockEdits = async () => {
  const store = await getStore();
  const project = store.projects[getProjectId()];

  return project?.blockEdits ?? {};
};

const getBlockEditStorageKey = (edit) =>
  edit.operation === 'reorder'
    ? `reorder:${edit.collection}`
    : edit.operation === 'remove'
      ? `remove:${edit.collection}:${edit.itemId}`
      : `duplicate:${edit.collection}:${edit.newId}`;

const storeBlockEdit = async (edit) => {
  const store = await getStore();
  const project = ensureProject(store);
  const blockStorageKey = getBlockEditStorageKey(edit);

  project.blockEdits[blockStorageKey] = {
    ...project.blockEdits[blockStorageKey],
    ...edit,
    updatedAt: new Date().toISOString(),
    url: window.location.href
  };

  await saveStore(store);

  return Object.keys(project.blockEdits).length;
};

const deleteBlockEdit = async (edit) => {
  const store = await getStore();
  const project = ensureProject(store);

  delete project.blockEdits[getBlockEditStorageKey(edit)];
  await saveStore(store);

  return Object.keys(project.blockEdits).length;
};

const storeBlockOverride = async (
  block,
  field,
  value,
  locales = [getLocale()]
) => {
  const collection = block.getAttribute('data-ck-block');
  const newId = block.getAttribute('data-ck-added-block-id');

  if (!collection || !newId || !isSafeContentKey(field)) {
    throw new Error('Invalid duplicated block field.');
  }

  const store = await getStore();
  const project = ensureProject(store);
  const blockStorageKey = `duplicate:${collection}:${newId}`;
  const edit = project.blockEdits[blockStorageKey];

  if (!edit || edit.operation !== 'duplicate') {
    throw new Error('The duplicated block edit could not be found.');
  }

  const safeLocales = locales.filter((locale) =>
    state.contentConfig.locales.includes(locale)
  );

  if (safeLocales.length === 0) {
    throw new Error('No valid locale was found for the duplicated block.');
  }

  const overrides = { ...(edit.overrides ?? {}) };

  safeLocales.forEach((locale) => {
    overrides[locale] = {
      ...(overrides[locale] ?? {}),
      [field]: value
    };
  });

  project.blockEdits[blockStorageKey] = {
    ...edit,
    overrides,
    updatedAt: new Date().toISOString(),
    url: window.location.href
  };

  await saveStore(store);

  return Object.keys(project.blockEdits).length;
};

const getConfiguredBlock = (element) => {
  const collection = element.getAttribute('data-ck-block');
  const itemId = element.getAttribute('data-ck-block-id');
  const prefix = element.getAttribute('data-ck-block-prefix');
  const collectionConfig = state.contentConfig.collections?.[collection];

  if (
    !collectionConfig ||
    !isSafeBlockId(itemId) ||
    !prefix ||
    !isSafeContentKey(prefix) ||
    !prefix.startsWith(`${collection}[`)
  ) {
    return null;
  }

  return {
    collection,
    collectionConfig,
    itemId,
    prefix
  };
};

const getBlockById = (collection, itemId) =>
  Array.from(document.querySelectorAll(blockSelector)).find(
    (block) =>
      block.getAttribute('data-ck-block') === collection &&
      block.getAttribute('data-ck-block-id') === itemId
  ) ?? null;

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const suppressNextBlockMutationRefresh = () => {
  suppressBlockObserver = true;
  window.queueMicrotask(() => {
    suppressBlockObserver = false;
  });
};

const getCollectionContainers = (collection) =>
  Array.from(document.querySelectorAll(collectionSelector)).filter(
    (container) => container.getAttribute('data-ck-collection') === collection
  );

const getCollectionContainer = (block, collection) => {
  const container = block.closest(collectionSelector);

  if (
    !container ||
    block.parentElement !== container ||
    container.getAttribute('data-ck-collection') !== collection
  ) {
    return null;
  }

  return container;
};

const getCollectionBlocks = (container, collection, includeRemoved = false) =>
  Array.from(container.children).filter(
    (element) =>
      element.matches(blockSelector) &&
      element.getAttribute('data-ck-block') === collection &&
      (includeRemoved || element.dataset.ckRemoved !== 'true')
  );

const isCompleteCollection = (container, collection) => {
  const totalItems = Number(container.getAttribute('data-ck-collection-total'));
  const originalBlocks = getCollectionBlocks(
    container,
    collection,
    true
  ).filter((block) => !block.hasAttribute('data-ck-added-block-id'));

  return (
    Number.isSafeInteger(totalItems) &&
    totalItems >= 0 &&
    originalBlocks.length === totalItems
  );
};

const captureOriginalCollectionOrder = (container, collection) => {
  if (container.dataset.ckOriginalOrder) {
    return;
  }

  container.dataset.ckOriginalOrder = getCollectionBlocks(
    container,
    collection,
    true
  )
    .filter((block) => !block.hasAttribute('data-ck-added-block-id'))
    .map((block) => block.getAttribute('data-ck-block-id'))
    .filter(Boolean)
    .join(',');
};

const getAnnouncer = () => {
  let announcer = document.querySelector('[data-ck-announcer]');

  if (!announcer) {
    announcer = document.createElement('div');
    announcer.className = 'content-kit-announcer';
    announcer.dataset.ckAnnouncer = 'true';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('role', 'status');
    document.body.appendChild(announcer);
  }

  return announcer;
};

const announce = (message) => {
  const announcer = getAnnouncer();

  announcer.textContent = '';
  window.requestAnimationFrame(() => {
    announcer.textContent = message;
  });
};

const getSelectOptions = (element) => {
  const selectionId = element.getAttribute('data-ck-select-config');
  const configuredSelection = selectionId
    ? state.contentConfig.selections?.[selectionId]
    : null;

  if (configuredSelection) {
    return configuredSelection.options.map((option) => ({
      element: null,
      icon: option.icon,
      label: option.label,
      value: option.value
    }));
  }

  const seenValues = new Set();

  return Array.from(element.querySelectorAll(selectOptionSelector))
    .slice(0, maxSelectOptions)
    .map((option) => {
      const value = option.getAttribute('data-ck-option');
      const rawLabel = option.getAttribute('data-ck-option-label');
      const label = rawLabel?.trim().slice(0, 80) ?? '';

      if (!isSafeBlockId(value) || !label || seenValues.has(value)) {
        return null;
      }

      seenValues.add(value);

      return { element: option, icon: '', label, value };
    })
    .filter(Boolean);
};

const setSelectValue = (element, value) => {
  const options = getSelectOptions(element);
  const selectedOption = options.find((option) => option.value === value);

  if (!selectedOption) {
    return false;
  }

  options.forEach((option) => {
    option.element?.toggleAttribute('hidden', option.value !== value);
  });
  element.dataset.ckSelectValue = value;
  updateSelectIcon(element, selectedOption);

  return true;
};

const syncMatchingSelects = (key, value, sourceElement) => {
  document.querySelectorAll(selectSelector).forEach((element) => {
    if (
      element === sourceElement ||
      element.getAttribute('data-ck-select') !== key
    ) {
      return;
    }

    setSelectValue(element, value);
  });
};

const allowedSvgElements = new Set([
  'circle',
  'ellipse',
  'line',
  'path',
  'polygon',
  'polyline',
  'rect',
  'svg'
]);
const allowedSvgAttributes = new Set([
  'cx',
  'cy',
  'd',
  'fill',
  'height',
  'points',
  'r',
  'rx',
  'ry',
  'stroke',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2'
]);

const cloneSafeSvg = (source) => {
  if (!(source instanceof window.SVGElement)) {
    return null;
  }

  const tagName = source.tagName.toLowerCase();

  if (!allowedSvgElements.has(tagName)) {
    return null;
  }

  const clone = document.createElementNS('http://www.w3.org/2000/svg', tagName);

  Array.from(source.attributes).forEach((attribute) => {
    if (
      allowedSvgAttributes.has(attribute.name) &&
      attribute.value.length <= 2048
    ) {
      clone.setAttribute(attribute.name, attribute.value);
    }
  });

  Array.from(source.children).forEach((child) => {
    const childClone = cloneSafeSvg(child);

    if (childClone) {
      clone.appendChild(childClone);
    }
  });

  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('focusable', 'false');

  return clone;
};

const getSafeConfiguredIconUrl = (icon) => {
  if (typeof icon !== 'string' || icon.length === 0 || !icon.startsWith('/')) {
    return null;
  }

  try {
    const url = new URL(icon, window.location.origin);

    if (
      url.origin !== window.location.origin ||
      !url.pathname.endsWith('.svg') ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.pathname;
  } catch {
    return null;
  }
};

const createConfiguredIcon = (icon) => {
  const src = getSafeConfiguredIconUrl(icon);

  if (!src) {
    return null;
  }

  const image = document.createElement('img');

  image.alt = '';
  image.setAttribute('aria-hidden', 'true');
  image.src = src;

  return image;
};

const loadConfiguredIcon = async (icon) => {
  const src = getSafeConfiguredIconUrl(icon);

  if (!src) {
    return null;
  }

  const cached = configuredIconMarkupCache.get(src);

  if (cached) {
    return cached.then((icon) => (icon ? cloneSafeSvg(icon) : null));
  }

  const request = window
    .fetch(src, { credentials: 'same-origin' })
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }

      const markup = await response.text();

      if (markup.length > 4096) {
        return null;
      }

      const template = document.createElement('template');
      template.innerHTML = markup;

      return cloneSafeSvg(template.content.querySelector('svg'));
    })
    .catch(() => null);

  configuredIconMarkupCache.set(src, request);

  return request.then((icon) => (icon ? cloneSafeSvg(icon) : null));
};

const updateSelectIcon = (element, option) => {
  void loadConfiguredIcon(option.icon).then((nextIcon) => {
    if (
      !nextIcon ||
      !element.isConnected ||
      element.getAttribute('data-ck-select-value') !== option.value
    ) {
      return;
    }

    const currentIcon = element.querySelector('svg, img');

    if (!currentIcon) {
      return;
    }

    const className = currentIcon.getAttribute('class');

    if (className) {
      nextIcon.setAttribute('class', className);
    }

    currentIcon.replaceWith(nextIcon);
  });
};

const createSelectPickerChevron = (direction) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-width', '2');
  path.setAttribute(
    'd',
    direction === 'previous' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'
  );
  svg.appendChild(path);

  return svg;
};

const positionSelectPicker = () => {
  if (!activeSelectPicker) {
    return;
  }

  const { picker, target } = activeSelectPicker;

  if (!target.isConnected || !picker.isConnected) {
    return;
  }

  const targetRect = target.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  const gap = 8;
  const viewportPadding = 8;
  const fitsBelow =
    targetRect.bottom + gap + pickerRect.height <=
    window.innerHeight - viewportPadding;
  const top = fitsBelow
    ? targetRect.bottom + gap
    : Math.max(viewportPadding, targetRect.top - pickerRect.height - gap);
  const left = Math.min(
    Math.max(viewportPadding, targetRect.left),
    Math.max(
      viewportPadding,
      window.innerWidth - pickerRect.width - viewportPadding
    )
  );

  picker.style.left = `${Math.round(left)}px`;
  picker.style.top = `${Math.round(top)}px`;
};

const closeSelectPicker = ({ restoreFocus = false } = {}) => {
  if (!activeSelectPicker) {
    return;
  }

  const { abortController, picker, target, usesPopover } = activeSelectPicker;

  activeSelectPicker = null;
  abortController.abort();

  if (usesPopover && picker.matches(':popover-open')) {
    picker.hidePopover();
  }

  picker.remove();

  if (restoreFocus && target.isConnected) {
    target.focus({ preventScroll: true });
  }
};

const saveSelectValue = async (element, value) => {
  const key = element.getAttribute('data-ck-select');
  const previousValue = element.getAttribute('data-ck-select-value');
  const addedBlock = element.closest('[data-ck-added-block-id]');
  const blockField = element.getAttribute('data-ck-block-field');

  if (
    !key ||
    !isSafeContentKey(key) ||
    !setSelectValue(element, value) ||
    (addedBlock && (!blockField || !isSafeContentKey(blockField)))
  ) {
    element.dataset.ckError = 'true';
    element.title = 'Invalid Content Kit selection.';
    return;
  }

  syncMatchingSelects(key, value, element);
  element.dataset.ckSaving = 'true';
  delete element.dataset.ckError;

  try {
    const locales =
      element.getAttribute('data-ck-select-scope') === 'all'
        ? state.contentConfig.locales
        : [getLocale()];

    if (addedBlock && blockField) {
      await storeBlockOverride(addedBlock, blockField, value, locales);
    } else {
      state.editCount = await storeEdit(key, value, locales);
    }
    announce(`Selected ${value}.`);
  } catch (error) {
    if (previousValue) {
      setSelectValue(element, previousValue);
      syncMatchingSelects(key, previousValue, element);
    }
    element.dataset.ckError = 'true';
    element.title =
      error instanceof Error
        ? error.message
        : 'Content Kit selection save failed.';
  } finally {
    delete element.dataset.ckSaving;
  }
};

const openSelectPicker = (element) => {
  const options = getSelectOptions(element);
  const selectedValue = element.getAttribute('data-ck-select-value');

  if (options.length === 0) {
    element.dataset.ckError = 'true';
    element.title = 'No valid Content Kit selection options were found.';
    return;
  }

  closeSelectPicker();

  const abortController = new window.AbortController();
  const eventOptions = { signal: abortController.signal };
  const picker = document.createElement('div');
  const heading = document.createElement('div');
  const optionGrid = document.createElement('div');
  const pagination = document.createElement('div');
  const previousButton = document.createElement('button');
  const nextButton = document.createElement('button');
  const pageIndicator = document.createElement('span');
  const usesPopover = typeof picker.showPopover === 'function';
  const selectedIndex = options.findIndex(
    (option) => option.value === selectedValue
  );
  const pageCount = Math.ceil(options.length / selectOptionsPerPage);
  const optionButtons = [];
  let currentPage = Math.max(
    0,
    Math.floor(Math.max(0, selectedIndex) / selectOptionsPerPage)
  );

  picker.className = 'content-kit-select-picker';
  picker.dataset.ckSelectPicker = 'true';
  picker.setAttribute('aria-label', 'Choose icon');
  picker.setAttribute('role', 'dialog');
  heading.className = 'content-kit-select-picker-heading';
  heading.textContent = 'Choose icon';
  optionGrid.className = 'content-kit-select-picker-grid';
  optionGrid.setAttribute('role', 'listbox');
  pagination.className = 'content-kit-select-picker-pagination';
  pagination.setAttribute('aria-label', 'Icon pages');
  previousButton.type = 'button';
  previousButton.className = 'content-kit-select-picker-page-button';
  previousButton.setAttribute('aria-label', 'Previous icon page');
  previousButton.appendChild(createSelectPickerChevron('previous'));
  nextButton.type = 'button';
  nextButton.className = 'content-kit-select-picker-page-button';
  nextButton.setAttribute('aria-label', 'Next icon page');
  nextButton.appendChild(createSelectPickerChevron('next'));
  pageIndicator.className = 'content-kit-select-picker-page-indicator';
  pageIndicator.setAttribute('aria-live', 'polite');

  options.forEach((option) => {
    const button = document.createElement('button');
    const label = document.createElement('span');
    const icon = option.element
      ? cloneSafeSvg(
          option.element.matches('svg')
            ? option.element
            : option.element.querySelector('svg')
        )
      : createConfiguredIcon(option.icon);

    button.type = 'button';
    button.dataset.ckSelectOptionButton = option.value;
    button.setAttribute('aria-label', option.label);
    button.setAttribute(
      'aria-selected',
      option.value === selectedValue ? 'true' : 'false'
    );
    button.setAttribute('role', 'option');
    label.textContent = option.label;

    if (icon) {
      button.appendChild(icon);
    }
    button.appendChild(label);
    button.addEventListener(
      'click',
      async (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeSelectPicker({ restoreFocus: true });
        await saveSelectValue(element, option.value);
      },
      eventOptions
    );
    optionGrid.appendChild(button);
    optionButtons.push(button);
  });

  const renderPage = ({ focusFirst = false } = {}) => {
    optionButtons.forEach((button, index) => {
      button.hidden = Math.floor(index / selectOptionsPerPage) !== currentPage;
    });
    pageIndicator.textContent = `${currentPage + 1}/${pageCount}`;
    previousButton.disabled = currentPage === 0;
    nextButton.disabled = currentPage === pageCount - 1;
    optionGrid.setAttribute(
      'aria-label',
      `Icon choices, page ${currentPage + 1} of ${pageCount}`
    );

    if (focusFirst) {
      optionButtons
        .find((button) => !button.hidden)
        ?.focus({
          preventScroll: true
        });
    }
  };

  previousButton.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (currentPage > 0) {
        currentPage -= 1;
        renderPage({ focusFirst: true });
      }
    },
    eventOptions
  );
  nextButton.addEventListener(
    'click',
    (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (currentPage < pageCount - 1) {
        currentPage += 1;
        renderPage({ focusFirst: true });
      }
    },
    eventOptions
  );

  pagination.append(previousButton, pageIndicator, nextButton);
  pagination.hidden = pageCount <= 1;
  picker.append(heading, optionGrid, pagination);
  renderPage();

  if (usesPopover) {
    picker.setAttribute('popover', 'manual');
  }

  document.body.appendChild(picker);

  if (usesPopover) {
    picker.showPopover();
  }

  activeSelectPicker = {
    abortController,
    picker,
    target: element,
    usesPopover
  };
  positionSelectPicker();

  const selectedButton = picker.querySelector('[aria-selected="true"]');
  const firstButton = picker.querySelector('button');

  (selectedButton ?? firstButton)?.focus({ preventScroll: true });

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!picker.contains(event.target) && !element.contains(event.target)) {
        closeSelectPicker();
      }
    },
    { capture: true, ...eventOptions }
  );
};

window.addEventListener('resize', positionSelectPicker, { passive: true });
window.addEventListener('scroll', positionSelectPicker, {
  capture: true,
  passive: true
});

const storeCollectionOrder = async (container, collection) => {
  const itemIds = getCollectionBlocks(container, collection).map((block) =>
    block.getAttribute('data-ck-block-id')
  );

  if (
    itemIds.length === 0 ||
    itemIds.some((itemId) => !isSafeBlockId(itemId))
  ) {
    throw new Error('A complete collection order could not be read.');
  }

  return storeBlockEdit({
    collection,
    itemIds,
    operation: 'reorder'
  });
};

const syncStoredCollectionOrder = async (collection) => {
  if (!state.experimentalFeatures.ordering) {
    return;
  }

  const blockEdits = await getBlockEdits();

  if (!blockEdits[`reorder:${collection}`]) {
    return;
  }

  const container = getCollectionContainers(collection).find((candidate) =>
    isCompleteCollection(candidate, collection)
  );

  if (container) {
    await storeCollectionOrder(container, collection);
  }
};

const animateReorderedBlocks = (beforeRects, blocks) => {
  if (prefersReducedMotion()) {
    return;
  }

  blocks.forEach((block) => {
    const before = beforeRects.get(block);
    const after = block.getBoundingClientRect();
    const deltaX = before ? before.left - after.left : 0;
    const deltaY = before ? before.top - after.top : 0;

    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      return;
    }

    blockAnimations.get(block)?.cancel();
    const animation = block.animate(
      [
        { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
      ],
      {
        duration: reorderDuration,
        easing: reorderEasing
      }
    );

    blockAnimations.set(block, animation);
    animation.finished
      .catch(() => {})
      .finally(() => {
        if (blockAnimations.get(block) === animation) {
          blockAnimations.delete(block);
        }
      });
  });
};

const getInsertionIndex = (blocks, pointerX, pointerY) => {
  const entries = blocks.map((block) => ({
    block,
    rect: block.getBoundingClientRect()
  }));
  const rows = [];

  entries.forEach((entry) => {
    const row = rows.find(
      (candidate) => Math.abs(candidate.top - entry.rect.top) < 8
    );

    if (row) {
      row.entries.push(entry);
      row.bottom = Math.max(row.bottom, entry.rect.bottom);
    } else {
      rows.push({
        bottom: entry.rect.bottom,
        entries: [entry],
        top: entry.rect.top
      });
    }
  });

  let offset = 0;

  for (const row of rows) {
    if (pointerY < row.top) {
      return offset;
    }

    if (pointerY <= row.bottom) {
      if (row.entries.length === 1) {
        const [{ rect }] = row.entries;
        return offset + (pointerY < rect.top + rect.height / 2 ? 0 : 1);
      }

      const columnIndex = row.entries.findIndex(
        ({ rect }) => pointerX < rect.left + rect.width / 2
      );

      return offset + (columnIndex < 0 ? row.entries.length : columnIndex);
    }

    offset += row.entries.length;
  }

  return blocks.length;
};

const reorderForPointer = (session, pointerX, pointerY) => {
  const blocks = getCollectionBlocks(session.container, session.collection);
  const candidates = blocks.filter((block) => block !== session.block);
  const insertionIndex = getInsertionIndex(candidates, pointerX, pointerY);
  const nextOrder = [...candidates];

  nextOrder.splice(insertionIndex, 0, session.block);

  if (nextOrder.every((block, index) => block === blocks[index])) {
    return;
  }

  const beforeRects = new Map(
    candidates.map((block) => [block, block.getBoundingClientRect()])
  );
  const insertionTarget = candidates[insertionIndex] ?? null;

  suppressNextBlockMutationRefresh();
  if (insertionTarget) {
    session.container.insertBefore(session.block, insertionTarget);
  } else {
    session.container.appendChild(session.block);
  }

  session.changed = true;
  animateReorderedBlocks(beforeRects, candidates);
};

const createDragPreview = (block, rect) => {
  const preview = block.cloneNode(true);

  preview.querySelectorAll(blockControlSelector).forEach((controls) => {
    controls.remove();
  });
  [preview, ...preview.querySelectorAll('*')].forEach((element) => {
    element.removeAttribute('contenteditable');
    element.removeAttribute('data-ck-added-block-id');
    element.removeAttribute('data-ck-block');
    element.removeAttribute('data-ck-block-field');
    element.removeAttribute('data-ck-block-id');
    element.removeAttribute('data-ck-block-prefix');
    element.removeAttribute('data-ck-edit');
    element.removeAttribute('data-ck-image');
    element.removeAttribute('data-ck-removed');
    element.removeAttribute('id');
    element.setAttribute('tabindex', '-1');
  });
  preview.dataset.ckDragPreview = 'true';
  preview.setAttribute('aria-hidden', 'true');
  preview.style.height = `${rect.height}px`;
  preview.style.width = `${rect.width}px`;
  preview.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0) scale(1.015)`;

  const status = document.createElement('div');

  status.className = 'content-kit-drag-status';
  status.textContent = 'Moving - release to place';
  preview.appendChild(status);
  document.body.appendChild(preview);

  return preview;
};

const restoreDragOrder = (session) => {
  suppressNextBlockMutationRefresh();
  session.initialBlocks.forEach((block) => {
    session.container.appendChild(block);
  });
};

const cleanupBlockDrag = (session) => {
  session.preview?.remove();
  delete session.block.dataset.ckDragging;
  delete session.container.dataset.ckDragging;

  try {
    if (session.handle.hasPointerCapture(session.pointerId)) {
      session.handle.releasePointerCapture(session.pointerId);
    }
  } catch {
    // Pointer capture may already be released when the pointer leaves the tab.
  }

  if (activeDrag === session) {
    activeDrag = null;
  }
};

const activateBlockDrag = (session) => {
  if (session.activated || session.finishing || activeDrag !== session) {
    return;
  }

  captureOriginalCollectionOrder(session.container, session.collection);
  const rect = session.block.getBoundingClientRect();

  session.preview = createDragPreview(session.block, rect);
  session.activated = true;
  session.block.dataset.ckDragging = 'true';
  session.container.dataset.ckDragging = 'true';
  announce(`Picked up block ${session.itemId}.`);
};

const finishBlockDrag = async (session, cancelled) => {
  if (session.finishing || activeDrag !== session) {
    return;
  }

  session.finishing = true;
  window.cancelAnimationFrame(session.frameId);
  session.frameId = 0;

  if (!cancelled && !session.activated) {
    session.finishing = false;
    updateBlockDrag(session);
    session.finishing = true;
  }

  if (!session.activated) {
    cleanupBlockDrag(session);

    if (refreshPendingAfterDrag) {
      refreshPendingAfterDrag = false;
      scheduleRefresh();
    }
    return;
  }

  if (cancelled && session.changed) {
    restoreDragOrder(session);
  }

  const targetRect = session.block.getBoundingClientRect();
  const currentLeft = session.pointerX - session.offsetX;
  const currentTop = session.pointerY - session.offsetY;
  const savePromise =
    !cancelled && session.changed
      ? storeCollectionOrder(session.container, session.collection)
      : Promise.resolve();
  let saveFailed = false;

  try {
    if (!prefersReducedMotion()) {
      const landing = session.preview.animate(
        [
          {
            transform: `translate3d(${currentLeft}px, ${currentTop}px, 0) scale(1.015)`
          },
          {
            transform: `translate3d(${targetRect.left}px, ${targetRect.top}px, 0) scale(1)`
          }
        ],
        {
          duration: 160,
          easing: reorderEasing
        }
      );

      await Promise.all([landing.finished.catch(() => {}), savePromise]);
    } else {
      await savePromise;
    }
  } catch {
    saveFailed = true;
    if (session.changed) {
      restoreDragOrder(session);
    }
  } finally {
    cleanupBlockDrag(session);
  }

  const blocks = getCollectionBlocks(session.container, session.collection);
  const position = blocks.indexOf(session.block) + 1;

  announce(
    saveFailed
      ? 'The new block order could not be saved.'
      : cancelled
        ? 'Block movement cancelled.'
        : `Moved block ${session.itemId} to position ${position} of ${blocks.length}.`
  );
  refreshPendingAfterDrag = false;
  await refresh();
};

const cancelActiveBlockDrag = () => {
  const session = activeDrag;

  if (!session) {
    return;
  }

  window.cancelAnimationFrame(session.frameId);
  if (session.changed) {
    restoreDragOrder(session);
  }
  cleanupBlockDrag(session);
  refreshPendingAfterDrag = false;
};

const updateBlockDrag = (session) => {
  session.frameId = 0;

  if (session.finishing || activeDrag !== session) {
    return;
  }

  if (!session.activated) {
    const distance = Math.hypot(
      session.pointerX - session.startX,
      session.pointerY - session.startY
    );

    if (distance < dragActivationDistance) {
      return;
    }

    activateBlockDrag(session);
  }

  const left = session.pointerX - session.offsetX;
  const top = session.pointerY - session.offsetY;

  session.preview.style.transform = `translate3d(${left}px, ${top}px, 0) scale(1.015)`;
  reorderForPointer(session, session.pointerX, session.pointerY);
};

const startBlockDrag = (event, block, blockInfo, handle) => {
  if (
    event.button !== 0 ||
    activeDrag ||
    !state.experimentalFeatures.ordering
  ) {
    return;
  }

  const container = getCollectionContainer(block, blockInfo.collection);

  if (!container || !isCompleteCollection(container, blockInfo.collection)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const rect = block.getBoundingClientRect();
  const session = {
    activated: false,
    block,
    changed: false,
    collection: blockInfo.collection,
    container,
    finishing: false,
    frameId: 0,
    handle,
    initialBlocks: getCollectionBlocks(container, blockInfo.collection),
    itemId: blockInfo.itemId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    pointerId: event.pointerId,
    pointerX: event.clientX,
    pointerY: event.clientY,
    preview: null,
    startX: event.clientX,
    startY: event.clientY
  };

  activeDrag = session;
  try {
    handle.setPointerCapture(event.pointerId);
  } catch {
    activeDrag = null;
  }
};

const moveBlockByOffset = async (block, blockInfo, offset) => {
  if (!state.experimentalFeatures.ordering) {
    return;
  }

  const container = getCollectionContainer(block, blockInfo.collection);

  if (!container || !isCompleteCollection(container, blockInfo.collection)) {
    return;
  }

  captureOriginalCollectionOrder(container, blockInfo.collection);
  const blocks = getCollectionBlocks(container, blockInfo.collection);
  const currentIndex = blocks.indexOf(block);
  const nextIndex = currentIndex + offset;

  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= blocks.length) {
    return;
  }

  const nextOrder = [...blocks];
  const [movedBlock] = nextOrder.splice(currentIndex, 1);

  nextOrder.splice(nextIndex, 0, movedBlock);
  suppressNextBlockMutationRefresh();
  nextOrder.forEach((item) => container.appendChild(item));
  await storeCollectionOrder(container, blockInfo.collection);
  announce(
    `Moved block ${blockInfo.itemId} to position ${nextIndex + 1} of ${blocks.length}.`
  );
  await refresh();
};

const getDuplicateId = () => `ck_${crypto.randomUUID().replaceAll('-', '')}`;

const sanitizeClonedBlock = (clone, sourcePrefix, newId) => {
  clone.querySelectorAll(blockControlSelector).forEach((controls) => {
    controls.remove();
  });

  [clone, ...clone.querySelectorAll('*')].forEach((element) => {
    element.removeAttribute('id');
    element.removeAttribute('for');
    element.removeAttribute('aria-controls');
    element.removeAttribute('aria-describedby');
    element.removeAttribute('aria-labelledby');
    delete element.dataset.ckTarget;
  });

  clone.dataset.ckAddedBlockId = newId;
  clone.dataset.ckBlockId = newId;

  const editableElements = [
    ...(clone.matches(editSelector) ? [clone] : []),
    ...clone.querySelectorAll(editSelector)
  ];
  const imageElements = [
    ...(clone.matches(imageSelector) ? [clone] : []),
    ...clone.querySelectorAll(imageSelector)
  ];
  const selectElements = [
    ...(clone.matches(selectSelector) ? [clone] : []),
    ...clone.querySelectorAll(selectSelector)
  ];

  editableElements.forEach((element) => {
    const key = element.getAttribute('data-ck-edit');
    const prefix = `${sourcePrefix}.`;

    if (key?.startsWith(prefix)) {
      element.dataset.ckBlockField = key.slice(prefix.length);
    } else {
      element.removeAttribute('data-ck-edit');
    }
  });

  imageElements.forEach((element) => {
    element.removeAttribute('data-ck-image');
    element.dataset.ckBlockImageLocked = 'true';
    element.title = 'Import the duplicated block before replacing its image.';
  });

  selectElements.forEach((element) => {
    const key = element.getAttribute('data-ck-select');
    const prefix = `${sourcePrefix}.`;

    if (key?.startsWith(prefix)) {
      element.dataset.ckBlockField = key.slice(prefix.length);
    } else {
      element.removeAttribute('data-ck-select');
      element.removeAttribute('data-ck-select-value');
    }
  });

  return clone;
};

const duplicateBlock = async (blockInfo) => {
  const newId = getDuplicateId();

  await storeBlockEdit({
    afterId: blockInfo.itemId,
    collection: blockInfo.collection,
    newId,
    operation: 'duplicate',
    overrides: {},
    sourceId: blockInfo.itemId
  });
  await refresh();
  await syncStoredCollectionOrder(blockInfo.collection);
};

const toggleBlockRemoval = async (block, blockInfo) => {
  if (block.hasAttribute('data-ck-added-block-id')) {
    await deleteBlockEdit({
      collection: blockInfo.collection,
      newId: blockInfo.itemId,
      operation: 'duplicate'
    });
    removeBlockControls(block);
    block.remove();
    await refresh();
    await syncStoredCollectionOrder(blockInfo.collection);
    return;
  }

  const edit = {
    collection: blockInfo.collection,
    itemId: blockInfo.itemId,
    operation: 'remove'
  };

  if (block.dataset.ckRemoved === 'true') {
    await deleteBlockEdit(edit);
  } else {
    await storeBlockEdit(edit);
  }

  await refresh();
  await syncStoredCollectionOrder(blockInfo.collection);
};

const blockControlIconPaths = {
  cancel: ['M6 6l12 12M18 6 6 18'],
  down: ['m6 10 6 6 6-6'],
  duplicate: [
    'M8 8h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8Z',
    'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3'
  ],
  move: ['M9 5h6M9 9h6M9 13h6M9 17h6'],
  remove: ['M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5'],
  restore: ['M4 12a8 8 0 1 0 2.34-5.66L4 8M4 4v4h4'],
  up: ['m6 14 6-6 6 6']
};

const createBlockControlIcon = (icon) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('viewBox', '0 0 24 24');

  blockControlIconPaths[icon].forEach((pathData) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    path.setAttribute('d', pathData);
    svg.appendChild(path);
  });

  return svg;
};

const createBlockControlButton = ({ control, icon, label, tooltip }) => {
  const button = document.createElement('button');

  button.type = 'button';
  button.dataset.ckControl = control;
  button.dataset.ckTooltip = tooltip;
  button.title = tooltip;
  button.setAttribute('aria-label', label);
  button.appendChild(createBlockControlIcon(icon));

  return button;
};

const getBlockControlsPlacement = (block) => {
  const requestedPlacement = block.getAttribute('data-ck-controls-position');

  return blockControlsPlacements.has(requestedPlacement)
    ? requestedPlacement
    : 'auto';
};

const getBlockControlsCandidate = (
  blockRect,
  controlsRect,
  placement,
  direction
) => {
  const alignsFromRight =
    (placement.endsWith('start') && direction === 'rtl') ||
    (placement.endsWith('end') && direction !== 'rtl');
  const alignedX = alignsFromRight
    ? blockRect.right - controlsRect.width
    : blockRect.left;

  if (placement.startsWith('top')) {
    return {
      left: alignedX,
      top: blockRect.top - controlsRect.height - blockControlsGap
    };
  }

  if (placement.startsWith('bottom')) {
    return {
      left: alignedX,
      top: blockRect.bottom + blockControlsGap
    };
  }

  const centeredY =
    blockRect.top + (blockRect.height - controlsRect.height) / 2;

  return placement === 'left'
    ? {
        left: blockRect.left - controlsRect.width - blockControlsGap,
        top: centeredY
      }
    : {
        left: blockRect.right + blockControlsGap,
        top: centeredY
      };
};

const shiftBlockControlsIntoViewport = (candidate, controlsRect) => {
  const maximumLeft = Math.max(
    blockControlsViewportPadding,
    window.innerWidth - controlsRect.width - blockControlsViewportPadding
  );
  const maximumTop = Math.max(
    blockControlsViewportPadding,
    window.innerHeight - controlsRect.height - blockControlsViewportPadding
  );

  return {
    left: Math.min(
      Math.max(candidate.left, blockControlsViewportPadding),
      maximumLeft
    ),
    top: Math.min(
      Math.max(candidate.top, blockControlsViewportPadding),
      maximumTop
    )
  };
};

const getRectangleOverlapArea = (first, second) => {
  const width = Math.max(
    0,
    Math.min(first.right, second.right) - Math.max(first.left, second.left)
  );
  const height = Math.max(
    0,
    Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top)
  );

  return width * height;
};

const getBlockControlsCollisionRects = (block, controls) => {
  const collisionSelector = `${blockSelector}, ${editSelector}, ${imageSelector}`;

  return Array.from(document.querySelectorAll(collisionSelector))
    .filter(
      (element) =>
        element !== block &&
        !block.contains(element) &&
        !element.contains(block) &&
        !controls.contains(element)
    )
    .map((element) => ({
      element,
      rect: element.getBoundingClientRect()
    }))
    .filter(
      ({ element, rect }) =>
        rect.width > 0 &&
        rect.height > 0 &&
        window.getComputedStyle(element).visibility !== 'hidden'
    )
    .map(({ rect }) => rect);
};

const getPositionedBlockControlsRect = (position, controlsRect) => ({
  bottom: position.top + controlsRect.height,
  height: controlsRect.height,
  left: position.left,
  right: position.left + controlsRect.width,
  top: position.top,
  width: controlsRect.width
});

const getBlockControlsCandidateScore = ({
  blockRect,
  candidate,
  collisionRects,
  controlsRect,
  preference
}) => {
  const position = shiftBlockControlsIntoViewport(candidate, controlsRect);
  const positionedRect = getPositionedBlockControlsRect(position, controlsRect);
  const targetOverlap = getRectangleOverlapArea(positionedRect, blockRect);
  const markedContentOverlap = collisionRects.reduce(
    (total, rect) => total + getRectangleOverlapArea(positionedRect, rect),
    0
  );
  const displacement =
    Math.abs(position.left - candidate.left) +
    Math.abs(position.top - candidate.top);

  return {
    position,
    score:
      targetOverlap * 100000 +
      markedContentOverlap * 100 +
      displacement * 10 +
      preference
  };
};

const getBlockControlsTooltipSide = (placement, position, controlsRect) => {
  const availableSpace = {
    bottom:
      window.innerHeight -
      (position.top + controlsRect.height) -
      blockControlsViewportPadding,
    left: position.left - blockControlsViewportPadding,
    right:
      window.innerWidth -
      (position.left + controlsRect.width) -
      blockControlsViewportPadding,
    top: position.top - blockControlsViewportPadding
  };
  const preferredSide = placement.startsWith('top')
    ? 'top'
    : placement.startsWith('bottom')
      ? 'bottom'
      : placement;

  if (availableSpace[preferredSide] >= 36) {
    return preferredSide;
  }

  return Object.entries(availableSpace).sort(
    ([, firstSpace], [, secondSpace]) => secondSpace - firstSpace
  )[0][0];
};

const positionBlockControls = (controls) => {
  const session = blockControlSessions.get(controls);

  if (!session || !controls.isConnected || !session.block.isConnected) {
    return;
  }

  const blockRect = session.block.getBoundingClientRect();
  const controlsRect = controls.getBoundingClientRect();

  if (
    blockRect.width === 0 ||
    blockRect.height === 0 ||
    controlsRect.width === 0 ||
    controlsRect.height === 0
  ) {
    return;
  }

  const requestedPlacement = getBlockControlsPlacement(session.block);
  const placements =
    requestedPlacement === 'auto'
      ? automaticBlockControlsPlacements
      : [requestedPlacement];
  const collisionRects =
    requestedPlacement === 'auto'
      ? getBlockControlsCollisionRects(session.block, controls)
      : [];
  const direction = window.getComputedStyle(session.block).direction;
  const candidates = placements.map((placement, preference) => {
    const candidate = getBlockControlsCandidate(
      blockRect,
      controlsRect,
      placement,
      direction
    );
    const result = getBlockControlsCandidateScore({
      blockRect,
      candidate,
      collisionRects,
      controlsRect,
      preference
    });

    return {
      ...result,
      placement
    };
  });
  const selected = candidates.sort(
    (first, second) => first.score - second.score
  )[0];

  controls.style.left = `${Math.round(selected.position.left)}px`;
  controls.style.top = `${Math.round(selected.position.top)}px`;
  controls.dataset.ckPlacement = selected.placement;
  controls.dataset.ckTooltipSide = getBlockControlsTooltipSide(
    selected.placement,
    selected.position,
    controlsRect
  );
};

const positionVisibleBlockControls = () => {
  blockControlsPositionFrame = 0;

  visibleBlockControls.forEach((controls) => {
    positionBlockControls(controls);
  });
};

const scheduleBlockControlsPosition = () => {
  if (blockControlsPositionFrame) {
    return;
  }

  blockControlsPositionFrame = window.requestAnimationFrame(
    positionVisibleBlockControls
  );
};

const getBlockControlsResizeObserver = () => {
  if (!blockControlsResizeObserver && 'ResizeObserver' in window) {
    blockControlsResizeObserver = new window.ResizeObserver(
      scheduleBlockControlsPosition
    );
  }

  return blockControlsResizeObserver;
};

const hideBlockControls = (controls) => {
  const session = blockControlSessions.get(controls);

  if (!session) {
    return;
  }

  window.clearTimeout(session.hideTimer);
  session.hideTimer = 0;
  visibleBlockControls.delete(controls);
  delete controls.dataset.ckVisible;
  controls.setAttribute('aria-hidden', 'true');
  controls.querySelectorAll('button').forEach((button) => {
    button.tabIndex = -1;
  });
  blockControlsResizeObserver?.unobserve(session.block);
  blockControlsResizeObserver?.unobserve(controls);

  if (session.usesPopover && controls.matches(':popover-open')) {
    controls.hidePopover();
  }

  if (activeBlockControls === controls) {
    activeBlockControls = null;
  }
};

const showBlockControls = (controls) => {
  const session = blockControlSessions.get(controls);

  if (!session || !session.block.isConnected || !controls.isConnected) {
    return;
  }

  window.clearTimeout(session.hideTimer);
  session.hideTimer = 0;

  if (activeBlockControls && activeBlockControls !== controls) {
    hideBlockControls(activeBlockControls);
  }

  if (session.usesPopover && !controls.matches(':popover-open')) {
    controls.showPopover();
  }

  visibleBlockControls.add(controls);
  activeBlockControls = controls;
  controls.dataset.ckVisible = 'true';
  controls.setAttribute('aria-hidden', 'false');
  controls.querySelectorAll('button').forEach((button) => {
    button.tabIndex = 0;
  });
  getBlockControlsResizeObserver()?.observe(session.block);
  getBlockControlsResizeObserver()?.observe(controls);
  positionBlockControls(controls);
};

const scheduleBlockControlsHide = (controls) => {
  const session = blockControlSessions.get(controls);

  if (!session) {
    return;
  }

  window.clearTimeout(session.hideTimer);
  session.hideTimer = window.setTimeout(() => {
    const keepsControlsVisible =
      session.block.matches(':hover') ||
      session.block.matches(':focus-within') ||
      controls.matches(':hover') ||
      controls.matches(':focus-within');

    if (!keepsControlsVisible) {
      hideBlockControls(controls);
    }
  }, 120);
};

const bindBlockControls = (block, controls) => {
  const abortController = new window.AbortController();
  const session = {
    abortController,
    block,
    hideTimer: 0,
    usesPopover: typeof controls.showPopover === 'function'
  };
  const eventOptions = { signal: abortController.signal };
  const hasHover = !window.matchMedia('(hover: none)').matches;

  blockControlSessions.set(controls, session);
  block.addEventListener(
    'pointerenter',
    () => {
      if (hasHover) {
        showBlockControls(controls);
      }
    },
    eventOptions
  );
  block.addEventListener(
    'pointerleave',
    () => {
      if (hasHover) {
        scheduleBlockControlsHide(controls);
      }
    },
    eventOptions
  );
  block.addEventListener(
    'click',
    (event) => {
      if (
        hasHover ||
        visibleBlockControls.has(controls) ||
        controls.contains(event.target)
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      showBlockControls(controls);
    },
    { capture: true, signal: abortController.signal }
  );
  block.addEventListener(
    'focusin',
    () => showBlockControls(controls),
    eventOptions
  );
  block.addEventListener(
    'focusout',
    () => scheduleBlockControlsHide(controls),
    eventOptions
  );
  controls.addEventListener(
    'pointerenter',
    () => showBlockControls(controls),
    eventOptions
  );
  controls.addEventListener(
    'pointerleave',
    () => scheduleBlockControlsHide(controls),
    eventOptions
  );
  controls.addEventListener(
    'focusin',
    () => showBlockControls(controls),
    eventOptions
  );
  controls.addEventListener(
    'focusout',
    () => scheduleBlockControlsHide(controls),
    eventOptions
  );

  if (session.usesPopover) {
    controls.setAttribute('popover', 'manual');
    block.appendChild(controls);
  } else {
    document.body.appendChild(controls);
  }

  controls.setAttribute('aria-hidden', 'true');
  controls.querySelectorAll('button').forEach((button) => {
    button.tabIndex = -1;
  });
};

const destroyBlockControls = (controls) => {
  const session = blockControlSessions.get(controls);

  if (session) {
    hideBlockControls(controls);
    session.abortController.abort();
    blockControlSessions.delete(controls);
  }

  controls.remove();
};

const removeBlockControls = (root = document) => {
  const controlsToRemove = new Set(root.querySelectorAll(blockControlSelector));

  if (root !== document) {
    document.querySelectorAll(blockControlSelector).forEach((controls) => {
      const session = blockControlSessions.get(controls);

      if (session && (session.block === root || root.contains(session.block))) {
        controlsToRemove.add(controls);
      }
    });
  }

  controlsToRemove.forEach(destroyBlockControls);
};

window.addEventListener('resize', scheduleBlockControlsPosition, {
  passive: true
});
window.addEventListener('scroll', scheduleBlockControlsPosition, {
  capture: true,
  passive: true
});

const createBlockControls = (block, blockInfo) => {
  const controls = document.createElement('div');
  const activeItemCount = Array.from(
    document.querySelectorAll(blockSelector)
  ).filter(
    (item) =>
      item.getAttribute('data-ck-block') === blockInfo.collection &&
      item.dataset.ckRemoved !== 'true'
  ).length;

  controls.className = 'content-kit-block-controls';
  controls.dataset.ckBlockControls = 'true';
  controls.setAttribute('role', 'toolbar');
  controls.setAttribute('aria-label', 'Block actions');

  const collectionContainer = getCollectionContainer(
    block,
    blockInfo.collection
  );
  const collectionBlocks = collectionContainer
    ? getCollectionBlocks(collectionContainer, blockInfo.collection)
    : [];
  const blockIndex = collectionBlocks.indexOf(block);
  const canReorder =
    state.experimentalFeatures.ordering &&
    blockInfo.collectionConfig.operations.includes('reorder') &&
    block.dataset.ckRemoved !== 'true' &&
    collectionContainer &&
    isCompleteCollection(collectionContainer, blockInfo.collection) &&
    collectionBlocks.length > 1 &&
    blockIndex >= 0;

  if (canReorder) {
    const dragButton = createBlockControlButton({
      control: 'move',
      icon: 'move',
      label: `Drag block ${blockInfo.itemId} to reorder`,
      tooltip: 'Drag to reorder'
    });
    const upButton = createBlockControlButton({
      control: 'up',
      icon: 'up',
      label: `Move block ${blockInfo.itemId} up`,
      tooltip: 'Move up'
    });
    const downButton = createBlockControlButton({
      control: 'down',
      icon: 'down',
      label: `Move block ${blockInfo.itemId} down`,
      tooltip: 'Move down'
    });

    dragButton.dataset.ckDragHandle = 'true';
    dragButton.addEventListener('pointerdown', (event) => {
      startBlockDrag(event, block, blockInfo, dragButton);
    });
    dragButton.addEventListener('pointermove', (event) => {
      const session = activeDrag;

      if (
        !session ||
        session.handle !== dragButton ||
        session.pointerId !== event.pointerId ||
        session.finishing
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      session.pointerX = event.clientX;
      session.pointerY = event.clientY;

      if (!session.frameId) {
        session.frameId = window.requestAnimationFrame(() => {
          updateBlockDrag(session);
        });
      }
    });
    dragButton.addEventListener('pointerup', (event) => {
      const session = activeDrag;

      if (
        session?.handle === dragButton &&
        session.pointerId === event.pointerId
      ) {
        event.preventDefault();
        event.stopPropagation();
        session.pointerX = event.clientX;
        session.pointerY = event.clientY;
        finishBlockDrag(session, false);
      }
    });
    dragButton.addEventListener('pointercancel', (event) => {
      const session = activeDrag;

      if (
        session?.handle === dragButton &&
        session.pointerId === event.pointerId
      ) {
        finishBlockDrag(session, true);
      }
    });
    dragButton.addEventListener('lostpointercapture', (event) => {
      const session = activeDrag;

      if (
        session?.handle === dragButton &&
        session.pointerId === event.pointerId &&
        !session.finishing
      ) {
        finishBlockDrag(session, true);
      }
    });
    dragButton.addEventListener('keydown', async (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      await moveBlockByOffset(
        block,
        blockInfo,
        event.key === 'ArrowUp' ? -1 : 1
      );
    });

    upButton.disabled = blockIndex === 0;
    upButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await moveBlockByOffset(block, blockInfo, -1);
    });

    downButton.disabled = blockIndex === collectionBlocks.length - 1;
    downButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await moveBlockByOffset(block, blockInfo, 1);
    });

    controls.append(dragButton, upButton, downButton);
  }

  if (
    blockInfo.collectionConfig.operations.includes('duplicate') &&
    !block.hasAttribute('data-ck-added-block-id') &&
    block.dataset.ckRemoved !== 'true' &&
    activeItemCount < blockInfo.collectionConfig.maxItems
  ) {
    const duplicateButton = createBlockControlButton({
      control: 'duplicate',
      icon: 'duplicate',
      label: `Duplicate block ${blockInfo.itemId}`,
      tooltip: 'Duplicate'
    });

    duplicateButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await duplicateBlock(blockInfo);
    });
    controls.appendChild(duplicateButton);
  }

  if (
    blockInfo.collectionConfig.operations.includes('remove') &&
    (block.hasAttribute('data-ck-added-block-id') ||
      block.dataset.ckRemoved === 'true' ||
      activeItemCount > blockInfo.collectionConfig.minItems)
  ) {
    const isAddedBlock = block.hasAttribute('data-ck-added-block-id');
    const isRemovedBlock = block.dataset.ckRemoved === 'true';
    const removeLabel = isAddedBlock
      ? 'Cancel duplicate'
      : isRemovedBlock
        ? 'Restore'
        : 'Remove';
    const removeButton = createBlockControlButton({
      control: isAddedBlock
        ? 'cancel-duplicate'
        : isRemovedBlock
          ? 'restore'
          : 'remove',
      icon: isAddedBlock ? 'cancel' : isRemovedBlock ? 'restore' : 'remove',
      label: `${removeLabel} block ${blockInfo.itemId}`,
      tooltip: removeLabel
    });

    removeButton.dataset.ckDestructive = isRemovedBlock ? 'false' : 'true';
    removeButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await toggleBlockRemoval(block, blockInfo);
    });
    controls.appendChild(removeButton);
  }

  if (controls.childElementCount > 0) {
    bindBlockControls(block, controls);
  }
};

const applyBlockOverrides = (blockEdits) => {
  Object.values(blockEdits).forEach((edit) => {
    if (edit.operation !== 'duplicate') {
      return;
    }

    const block = getBlockById(edit.collection, edit.newId);
    const overrides = edit.overrides?.[state.locale] ?? {};

    if (!block) {
      return;
    }

    const blockFields = [
      ...(block.matches('[data-ck-block-field]') ? [block] : []),
      ...block.querySelectorAll('[data-ck-block-field]')
    ];

    blockFields.forEach((element) => {
      const field = element.getAttribute('data-ck-block-field');

      if (field && typeof overrides[field] === 'string') {
        if (element.matches(selectSelector)) {
          setSelectValue(element, overrides[field]);
        } else {
          element.textContent = overrides[field];
          element.dataset.ckOriginalText = overrides[field];
        }
      }
    });
  });
};

const applyCollectionOrder = (edit) => {
  getCollectionContainers(edit.collection).forEach((container) => {
    captureOriginalCollectionOrder(container, edit.collection);

    const blocks = getCollectionBlocks(container, edit.collection);
    const blocksById = new Map(
      blocks.map((block) => [block.getAttribute('data-ck-block-id'), block])
    );
    const orderedBlocks = edit.itemIds
      .map((itemId) => blocksById.get(itemId))
      .filter(Boolean);
    const orderedSet = new Set(orderedBlocks);

    blocks.forEach((block) => {
      if (!orderedSet.has(block)) {
        orderedBlocks.push(block);
      }
    });

    if (orderedBlocks.every((block, index) => block === blocks[index])) {
      return;
    }

    const removedBlocks = getCollectionBlocks(
      container,
      edit.collection,
      true
    ).filter((block) => block.dataset.ckRemoved === 'true');

    suppressNextBlockMutationRefresh();
    [...orderedBlocks, ...removedBlocks].forEach((block) => {
      container.appendChild(block);
    });
  });
};

const restoreOriginalCollectionOrders = () => {
  document.querySelectorAll('[data-ck-original-order]').forEach((container) => {
    const collection = container.getAttribute('data-ck-collection');
    const originalIds = container.dataset.ckOriginalOrder?.split(',') ?? [];

    if (collection) {
      const blocksById = new Map(
        getCollectionBlocks(container, collection, true).map((block) => [
          block.getAttribute('data-ck-block-id'),
          block
        ])
      );

      suppressNextBlockMutationRefresh();
      originalIds.forEach((itemId) => {
        const block = blocksById.get(itemId);

        if (block) {
          container.appendChild(block);
        }
      });
    }

    delete container.dataset.ckOriginalOrder;
  });
};

const reconcileBlockPreviews = (blockEdits) => {
  removeBlockControls();

  if (
    !state.experimentalFeatures.ordering &&
    document.querySelector('[data-ck-original-order]')
  ) {
    document.querySelectorAll('[data-ck-added-block-id]').forEach((block) => {
      block.remove();
    });
    restoreOriginalCollectionOrders();
  }

  const duplicateIds = new Set(
    Object.values(blockEdits)
      .filter((edit) => edit.operation === 'duplicate')
      .map((edit) => edit.newId)
  );

  document.querySelectorAll('[data-ck-added-block-id]').forEach((block) => {
    if (!duplicateIds.has(block.getAttribute('data-ck-added-block-id'))) {
      block.remove();
    }
  });

  document.querySelectorAll(blockSelector).forEach((block) => {
    delete block.dataset.ckRemoved;
  });

  Object.values(blockEdits).forEach((edit) => {
    if (
      edit.operation !== 'duplicate' ||
      getBlockById(edit.collection, edit.newId)
    ) {
      return;
    }

    const source = getBlockById(edit.collection, edit.sourceId);
    const insertionTarget = getBlockById(edit.collection, edit.afterId);
    const sourceInfo = source ? getConfiguredBlock(source) : null;

    if (!source || !insertionTarget || !sourceInfo) {
      return;
    }

    const clone = sanitizeClonedBlock(
      source.cloneNode(true),
      sourceInfo.prefix,
      edit.newId
    );

    insertionTarget.insertAdjacentElement('afterend', clone);
  });

  Object.values(blockEdits).forEach((edit) => {
    if (edit.operation !== 'remove') {
      return;
    }

    const block = getBlockById(edit.collection, edit.itemId);

    if (block) {
      block.dataset.ckRemoved = 'true';
    }
  });

  Object.values(blockEdits).forEach((edit) => {
    if (state.experimentalFeatures.ordering && edit.operation === 'reorder') {
      applyCollectionOrder(edit);
    }
  });

  if (state.editModeEnabled) {
    document.querySelectorAll(blockSelector).forEach((block) => {
      const blockInfo = getConfiguredBlock(block);

      if (blockInfo) {
        createBlockControls(block, blockInfo);
      }
    });
  }
};

const clearBlockPreviews = () => {
  removeBlockControls();
  document.querySelectorAll('[data-ck-added-block-id]').forEach((block) => {
    block.remove();
  });
  restoreOriginalCollectionOrders();
  document.querySelectorAll('[data-ck-removed]').forEach((block) => {
    delete block.dataset.ckRemoved;
  });
};

const storeEdit = async (key, value, locales = [getLocale()]) => {
  if (!isSafeContentKey(key)) {
    throw new Error('Invalid Content Kit text key.');
  }

  const store = await getStore();
  const project = ensureProject(store);
  const safeLocales = locales.filter((locale) =>
    state.contentConfig.locales.includes(locale)
  );

  if (safeLocales.length === 0) {
    throw new Error('No valid locale was found for the Content Kit edit.');
  }

  safeLocales.forEach((locale) => {
    if (
      !project.edits[locale] ||
      typeof project.edits[locale] !== 'object' ||
      Array.isArray(project.edits[locale])
    ) {
      project.edits[locale] = {};
    }

    project.edits[locale][key] = {
      key,
      locale,
      updatedAt: new Date().toISOString(),
      url: window.location.href,
      value
    };
  });

  await saveStore(store);

  return Object.keys(project.edits[getLocale()] ?? {}).length;
};

const storeImageEdit = async ({
  dataUrl,
  fileName,
  key,
  mimeType,
  previewUrl
}) => {
  if (!isSafeContentKey(key)) {
    throw new Error('Invalid Content Kit image key.');
  }

  const imageInfo = getSafeImageDataUrlInfo(dataUrl);

  if (
    !imageInfo ||
    !getSafeImageDataUrlInfo(previewUrl) ||
    (mimeType && mimeType !== imageInfo.mimeType)
  ) {
    throw new Error('Content Kit image data failed validation.');
  }

  const store = await getStore();
  const project = ensureProject(store);
  const locale = getLocale();

  if (
    !project.imageEdits ||
    typeof project.imageEdits !== 'object' ||
    Array.isArray(project.imageEdits)
  ) {
    project.imageEdits = {};
  }

  if (
    !project.imageEdits[locale] ||
    typeof project.imageEdits[locale] !== 'object' ||
    Array.isArray(project.imageEdits[locale])
  ) {
    project.imageEdits[locale] = {};
  }

  project.imageEdits[locale][key] = {
    dataUrl,
    fileName,
    key,
    locale,
    mimeType: imageInfo.mimeType,
    previewUrl,
    updatedAt: new Date().toISOString(),
    url: window.location.href
  };

  await saveStore(store);

  return Object.keys(project.imageEdits[locale]).length;
};

const setElementState = (element, enabled) => {
  if (enabled) {
    element.setAttribute('contenteditable', 'true');
    element.setAttribute('spellcheck', 'true');
    return;
  }

  element.removeAttribute('contenteditable');
  element.removeAttribute('spellcheck');
  delete element.dataset.ckSaving;
  delete element.dataset.ckError;
};

const setImageState = (element, enabled) => {
  if (enabled) {
    element.dataset.ckImageEnabled = 'true';
  } else {
    delete element.dataset.ckImageEnabled;
  }
  delete element.dataset.ckSaving;
  delete element.dataset.ckError;
};

const setSelectState = (element, enabled) => {
  if (enabled) {
    if (element.dataset.ckSelectManaged !== 'true') {
      if (element.hasAttribute('role')) {
        element.dataset.ckOriginalRole = element.getAttribute('role') ?? '';
      } else {
        element.dataset.ckAddedRole = 'true';
      }

      if (element.hasAttribute('aria-haspopup')) {
        element.dataset.ckOriginalHaspopup =
          element.getAttribute('aria-haspopup') ?? '';
      } else {
        element.dataset.ckAddedHaspopup = 'true';
      }

      if (!element.hasAttribute('tabindex')) {
        element.dataset.ckAddedTabindex = 'true';
      }

      element.dataset.ckSelectManaged = 'true';
    }

    element.dataset.ckSelectEnabled = 'true';
    element.setAttribute('aria-haspopup', 'listbox');
    element.setAttribute('role', 'button');

    if (element.dataset.ckAddedTabindex === 'true') {
      element.tabIndex = 0;
    }
    return;
  }

  delete element.dataset.ckSelectEnabled;
  delete element.dataset.ckSaving;
  delete element.dataset.ckError;
  if (element.dataset.ckAddedHaspopup === 'true') {
    element.removeAttribute('aria-haspopup');
  } else if (element.dataset.ckOriginalHaspopup != null) {
    element.setAttribute('aria-haspopup', element.dataset.ckOriginalHaspopup);
  }

  if (element.dataset.ckAddedRole === 'true') {
    element.removeAttribute('role');
  } else if (element.dataset.ckOriginalRole != null) {
    element.setAttribute('role', element.dataset.ckOriginalRole);
  }

  if (element.dataset.ckAddedTabindex === 'true') {
    element.removeAttribute('tabindex');
    delete element.dataset.ckAddedTabindex;
  }

  delete element.dataset.ckAddedHaspopup;
  delete element.dataset.ckAddedRole;
  delete element.dataset.ckOriginalHaspopup;
  delete element.dataset.ckOriginalRole;
  delete element.dataset.ckSelectManaged;
};

const getImageTarget = (element) => {
  if (element instanceof HTMLImageElement) {
    return element;
  }

  return element.querySelector('img');
};

const getAscii = (bytes, start, end) =>
  String.fromCharCode(...bytes.subarray(start, end));

const getImageMimeTypeFromBytes = (bytes) => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (bytes.length >= 4 && getAscii(bytes, 0, 4) === 'GIF8') {
    return 'image/gif';
  }

  if (
    bytes.length >= 12 &&
    getAscii(bytes, 0, 4) === 'RIFF' &&
    getAscii(bytes, 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
};

const getFileExtension = (filename) => {
  const extensionMatch = filename.toLowerCase().match(/\.([a-z0-9]+)$/);

  return extensionMatch?.[1] ?? '';
};

const getBase64ByteLength = (base64) => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return base64.length * 0.75 - padding;
};

const getBase64PrefixBytes = (base64) => {
  const prefixLength = Math.min(base64.length, 32);
  const alignedPrefixLength = prefixLength - (prefixLength % 4);
  const prefix = base64.slice(0, alignedPrefixLength);

  if (!prefix) {
    return new Uint8Array();
  }

  const binary = atob(prefix);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const getSafeImageDataUrlInfo = (dataUrl) => {
  const match =
    typeof dataUrl === 'string'
      ? dataUrl.match(
          /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u
        )
      : null;

  if (!match || match[2].length % 4 !== 0) {
    return null;
  }

  const mimeType = match[1];
  const byteLength = getBase64ByteLength(match[2]);

  if (
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > maxImageBytes
  ) {
    return null;
  }

  try {
    const prefixMimeType = getImageMimeTypeFromBytes(
      getBase64PrefixBytes(match[2])
    );

    if (prefixMimeType !== mimeType) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    byteLength,
    mimeType
  };
};

const assertSafeImageFile = async (file) => {
  if (!file || typeof file.name !== 'string') {
    throw new Error('Choose a PNG, JPEG, GIF, or WebP image.');
  }

  const extension = getFileExtension(file.name);

  if (!allowedImageExtensions.has(extension)) {
    throw new Error('Only PNG, JPEG, GIF, and WebP images are allowed.');
  }

  if (file.size <= 0 || file.size > maxImageBytes) {
    throw new Error('Image files must be between 1 byte and 5 MB.');
  }

  if (file.type && !allowedImageTypes.has(file.type)) {
    throw new Error('Only PNG, JPEG, GIF, and WebP images are allowed.');
  }

  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const mimeType = getImageMimeTypeFromBytes(bytes);

  if (!mimeType) {
    throw new Error('The selected file does not look like a valid image.');
  }

  if (file.type && file.type !== mimeType) {
    throw new Error('The selected file content does not match its file type.');
  }

  return mimeType;
};

const setImageSource = (element, src) => {
  if (!getSafeImageDataUrlInfo(src)) {
    return false;
  }

  const image = getImageTarget(element);

  if (image) {
    image.setAttribute('src', src);
    image.removeAttribute('srcset');
    return true;
  }

  element.style.backgroundImage = `url("${src}")`;
  element.style.backgroundPosition = 'center';
  element.style.backgroundSize = 'cover';

  return true;
};

const syncMatchingElements = (key, value, sourceElement) => {
  document.querySelectorAll(editSelector).forEach((element) => {
    if (
      element === sourceElement ||
      element.getAttribute('data-ck-edit') !== key
    ) {
      return;
    }

    element.textContent = value;
    element.dataset.ckOriginalText = value;
  });
};

const syncMatchingImages = (key, value, sourceElement) => {
  document.querySelectorAll(imageSelector).forEach((element) => {
    if (
      element === sourceElement ||
      element.getAttribute('data-ck-image') !== key
    ) {
      return;
    }

    setImageSource(element, value);
  });
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

const chooseImageFile = () =>
  new Promise((resolve) => {
    const input = document.createElement('input');

    input.type = 'file';
    input.accept =
      '.gif,.jpg,.jpeg,.png,.webp,image/gif,image/jpeg,image/png,image/webp';
    input.addEventListener(
      'change',
      () => {
        resolve(input.files?.[0] ?? null);
      },
      { once: true }
    );
    input.click();
  });

const saveImageElement = async (element) => {
  if (!state.extensionEnabled || !state.editModeEnabled) {
    return;
  }

  const key = element.getAttribute('data-ck-image');

  if (!key || !isSafeContentKey(key)) {
    element.dataset.ckError = 'true';
    element.title = 'Invalid Content Kit image key.';
    return;
  }

  const file = await chooseImageFile();

  if (!file) {
    return;
  }

  element.dataset.ckSaving = 'true';
  delete element.dataset.ckError;

  try {
    const mimeType = await assertSafeImageFile(file);
    const dataUrl = await readFileAsDataUrl(file);
    const imageInfo = getSafeImageDataUrlInfo(dataUrl);

    if (!imageInfo || imageInfo.mimeType !== mimeType) {
      throw new Error('The selected image could not be validated.');
    }

    await storeImageEdit({
      dataUrl,
      fileName: file.name,
      key,
      mimeType: imageInfo.mimeType,
      previewUrl: dataUrl
    });
    setImageSource(element, dataUrl);
    syncMatchingImages(key, dataUrl, element);
  } catch (error) {
    element.dataset.ckError = 'true';
    element.title =
      error instanceof Error ? error.message : 'Content Kit image save failed.';
  } finally {
    delete element.dataset.ckSaving;
  }
};

const saveElement = async (element) => {
  if (!state.extensionEnabled || !state.editModeEnabled) {
    return;
  }

  const key = element.getAttribute('data-ck-edit');
  const value = element.textContent ?? '';
  const addedBlock = element.closest('[data-ck-added-block-id]');
  const blockField = element.getAttribute('data-ck-block-field');

  if (
    !key ||
    !isSafeContentKey(key) ||
    (addedBlock && (!blockField || !isSafeContentKey(blockField)))
  ) {
    element.dataset.ckError = 'true';
    element.title = 'Invalid Content Kit text key.';
    return;
  }

  if (value === element.dataset.ckOriginalText) {
    dirtyKeys.delete(key);
    state.dirtyKeys = Array.from(dirtyKeys);
    return;
  }

  element.dataset.ckSaving = 'true';
  delete element.dataset.ckError;

  try {
    if (addedBlock && blockField) {
      await storeBlockOverride(addedBlock, blockField, value);
    } else {
      state.editCount = await storeEdit(key, value);
    }
    element.dataset.ckOriginalText = value;
    dirtyKeys.delete(key);
    state.dirtyKeys = Array.from(dirtyKeys);

    if (!addedBlock) {
      syncMatchingElements(key, value, element);
    }
  } catch (error) {
    element.dataset.ckError = 'true';
    element.title =
      error instanceof Error ? error.message : 'Content Kit save failed.';
  } finally {
    delete element.dataset.ckSaving;
  }
};

const blockPageInteraction = (event) => {
  if (!state.extensionEnabled || !state.editModeEnabled) {
    return;
  }

  event.stopPropagation();
};

const blockClickableDefault = (event) => {
  if (!state.extensionEnabled || !state.editModeEnabled) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
};

const bindElement = (element) => {
  setElementState(element, state.editModeEnabled);

  if (boundElements.has(element)) {
    return;
  }

  boundElements.add(element);

  element.addEventListener('focus', () => {
    element.dataset.ckOriginalText = element.textContent ?? '';
  });

  element.addEventListener('blur', () => {
    saveElement(element);
  });

  element.addEventListener('input', () => {
    const key = element.getAttribute('data-ck-edit');

    if (!key) {
      return;
    }

    if ((element.textContent ?? '') === element.dataset.ckOriginalText) {
      dirtyKeys.delete(key);
    } else {
      dirtyKeys.add(key);
    }

    state.dirtyKeys = Array.from(dirtyKeys);
  });

  element.addEventListener('pointerdown', blockPageInteraction);
  element.addEventListener('mousedown', blockPageInteraction);
  element.addEventListener('mouseup', blockPageInteraction);
  element.addEventListener('click', blockClickableDefault);
  element.addEventListener('auxclick', blockClickableDefault);

  element.addEventListener('keydown', (event) => {
    if (!state.extensionEnabled || !state.editModeEnabled) {
      return;
    }

    if (event.key === 'Escape') {
      element.textContent =
        element.dataset.ckOriginalText ?? element.textContent;
      const key = element.getAttribute('data-ck-edit');

      if (key) {
        dirtyKeys.delete(key);
        state.dirtyKeys = Array.from(dirtyKeys);
      }

      element.blur();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      element.blur();
    }
  });
};

const bindImage = (element) => {
  setImageState(element, state.editModeEnabled);

  if (boundElements.has(element)) {
    return;
  }

  boundElements.add(element);

  element.addEventListener('pointerdown', blockPageInteraction);
  element.addEventListener('mousedown', blockPageInteraction);
  element.addEventListener('mouseup', blockPageInteraction);
  element.addEventListener('click', (event) => {
    if (!state.extensionEnabled || !state.editModeEnabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    saveImageElement(element);
  });
};

const bindSelect = (element) => {
  setSelectState(element, state.editModeEnabled);

  if (boundElements.has(element)) {
    return;
  }

  boundElements.add(element);

  element.addEventListener('pointerdown', blockPageInteraction);
  element.addEventListener('mousedown', blockPageInteraction);
  element.addEventListener('mouseup', blockPageInteraction);
  element.addEventListener('click', (event) => {
    if (!state.extensionEnabled || !state.editModeEnabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openSelectPicker(element);
  });
  element.addEventListener('keydown', (event) => {
    if (!state.extensionEnabled || !state.editModeEnabled) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      openSelectPicker(element);
    }
  });
};

const applyStoredEdits = (elements, edits) => {
  elements.forEach((element) => {
    const key = element.getAttribute('data-ck-edit');
    const edit = key ? edits[key] : null;

    if (!edit || document.activeElement === element) {
      return;
    }

    element.textContent = edit.value;
    element.dataset.ckOriginalText = edit.value;
  });
};

const applyStoredImageEdits = (elements, edits) => {
  elements.forEach((element) => {
    const key = element.getAttribute('data-ck-image');
    const edit = key ? edits[key] : null;

    if (!edit?.previewUrl || !getSafeImageDataUrlInfo(edit.previewUrl)) {
      return;
    }

    setImageSource(element, edit.previewUrl);
  });
};

const applyStoredSelectEdits = (elements, edits) => {
  elements.forEach((element) => {
    const key = element.getAttribute('data-ck-select');
    const edit = key ? edits[key] : null;

    if (typeof edit?.value === 'string') {
      setSelectValue(element, edit.value);
    }
  });
};

const disableEditing = () => {
  closeSelectPicker();
  document.documentElement.classList.remove('content-kit-edit-on');
  document.documentElement.classList.remove('content-kit-image-edit-on');
  document.querySelectorAll(editSelector).forEach((element) => {
    setElementState(element, false);
  });
  document.querySelectorAll(imageSelector).forEach((element) => {
    setImageState(element, false);
  });
  document.querySelectorAll(selectSelector).forEach((element) => {
    setSelectState(element, false);
  });
};

const disableExtension = () => {
  cancelActiveBlockDrag();
  disableEditing();
  clearBlockPreviews();
  dirtyKeys.clear();
  state.dirtyKeys = [];
  state.editableCount = 0;
  state.editableFields = [];
  state.editableImages = [];
  state.editableBlocks = [];
  state.editCount = 0;
  state.pageEditable = false;
};

const refresh = async () => {
  const stored = await chrome.storage.local.get({
    [experimentalFeaturesStorageKey]: { ordering: false },
    contentKitEditMode: false,
    contentKitEnabled: false
  });
  state.contentConfig = readContentConfig();
  state.extensionEnabled = stored.contentKitEnabled;
  state.experimentalFeatures = {
    ordering: stored[experimentalFeaturesStorageKey]?.ordering === true
  };
  state.editModeEnabled =
    state.extensionEnabled && stored.contentKitEditMode === true;
  state.locale = getLocale();
  state.origin = getProjectId();

  if (!state.extensionEnabled) {
    disableExtension();
    return state;
  }

  const blockEdits = await getBlockEdits();

  reconcileBlockPreviews(blockEdits);

  const elements = Array.from(document.querySelectorAll(editSelector)).filter(
    (element) =>
      isSafeContentKey(element.getAttribute('data-ck-edit')) &&
      element.closest('[data-ck-removed]') == null
  );
  const imageElements = Array.from(
    document.querySelectorAll(imageSelector)
  ).filter(
    (element) =>
      isSafeContentKey(element.getAttribute('data-ck-image')) &&
      element.closest('[data-ck-removed]') == null
  );
  const selectElements = Array.from(
    document.querySelectorAll(selectSelector)
  ).filter(
    (element) =>
      isSafeContentKey(element.getAttribute('data-ck-select')) &&
      getSelectOptions(element).length > 0 &&
      element.closest('[data-ck-removed]') == null
  );
  const blockElements = Array.from(
    document.querySelectorAll(blockSelector)
  ).filter((element) => getConfiguredBlock(element) != null);
  const edits = await getLocaleEdits();
  const imageEdits = await getLocaleImageEdits();

  state.editableCount =
    elements.length +
    imageElements.length +
    selectElements.length +
    blockElements.length;
  state.editCount =
    Object.keys(edits).length +
    Object.keys(imageEdits).length +
    Object.keys(blockEdits).length;
  state.pageEditable =
    elements.length > 0 ||
    imageElements.length > 0 ||
    selectElements.length > 0 ||
    blockElements.length > 0;

  if (!state.pageEditable) {
    disableEditing();
    state.extensionEnabled = true;
    state.editableFields = [];
    state.editableImages = [];
    state.editableBlocks = [];
    await consumePendingScroll();
    return state;
  }

  applyStoredEdits(elements, edits);
  applyStoredImageEdits(imageElements, imageEdits);
  applyStoredSelectEdits(selectElements, edits);
  applyBlockOverrides(blockEdits);
  state.editableFields = [
    ...elements.map((element) => ({
      key: element.getAttribute('data-ck-edit') ?? '',
      locale: state.locale,
      url: window.location.href,
      value: element.textContent ?? ''
    })),
    ...selectElements.map((element) => ({
      key: element.getAttribute('data-ck-select') ?? '',
      locale: state.locale,
      url: window.location.href,
      value: element.getAttribute('data-ck-select-value') ?? ''
    }))
  ];
  state.editableImages = imageElements.map((element) => ({
    key: element.getAttribute('data-ck-image') ?? '',
    locale: state.locale,
    url: window.location.href,
    value:
      getImageTarget(element)?.getAttribute('src') ??
      element.style.backgroundImage ??
      ''
  }));
  state.editableBlocks = blockElements.map((element) => ({
    collection: element.getAttribute('data-ck-block') ?? '',
    itemId: element.getAttribute('data-ck-block-id') ?? '',
    locale: state.locale,
    url: window.location.href
  }));
  document.documentElement.classList.toggle(
    'content-kit-edit-on',
    state.editModeEnabled
  );
  document.documentElement.classList.toggle(
    'content-kit-image-edit-on',
    state.editModeEnabled
  );
  elements.forEach(bindElement);
  imageElements.forEach(bindImage);
  selectElements.forEach(bindSelect);
  await consumePendingScroll();

  return state;
};

const scheduleRefresh = () => {
  if (activeDrag) {
    refreshPendingAfterDrag = true;
    return;
  }

  if (refreshTimer) {
    return;
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0;

    if (activeDrag) {
      refreshPendingAfterDrag = true;
      return;
    }

    refresh();
  }, 100);
};

const startObserver = () => {
  if (observer || !document.body) {
    return;
  }

  observer = new MutationObserver((mutations) => {
    if (suppressBlockObserver) {
      return;
    }

    const hasExternalMutation = mutations.some((mutation) => {
      const target = mutation.target;

      if (
        activeDrag &&
        target.nodeType === 1 &&
        (target === activeDrag.container ||
          activeDrag.container.contains(target))
      ) {
        return false;
      }

      if (
        target.nodeType === 1 &&
        (target.closest?.(blockControlSelector) ||
          target.closest?.('[data-ck-added-block-id]') ||
          target.closest?.('[data-ck-announcer]') ||
          target.closest?.('[data-ck-drag-preview]') ||
          target.closest?.('[data-ck-select-picker]') ||
          target.closest?.(editSelector) ||
          target.closest?.(imageSelector) ||
          target.closest?.(selectSelector))
      ) {
        return false;
      }

      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node.nodeType !== 1 ||
          (!node.matches?.(blockControlSelector) &&
            !node.matches?.('[data-ck-added-block-id]') &&
            !node.matches?.('[data-ck-announcer]') &&
            !node.matches?.('[data-ck-drag-preview]') &&
            !node.matches?.('[data-ck-select-picker]'))
      );
    });

    if (state.extensionEnabled && hasExternalMutation) {
      scheduleRefresh();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'content-kit:get-state') {
    refresh().then(sendResponse);
    return true;
  }

  if (message?.type === 'content-kit:set-enabled') {
    const nextState =
      message.enabled === true
        ? { contentKitEnabled: true }
        : { contentKitEditMode: false, contentKitEnabled: false };

    chrome.storage.local.set(nextState).then(refresh).then(sendResponse);
    return true;
  }

  if (message?.type === 'content-kit:set-edit-mode') {
    chrome.storage.local
      .set({ contentKitEditMode: message.enabled === true })
      .then(refresh)
      .then(sendResponse);
    return true;
  }

  if (message?.type === 'content-kit:reload-edits') {
    refresh().then(sendResponse);
    return true;
  }

  if (message?.type === 'content-kit:reload-settings') {
    refresh().then(sendResponse);
    return true;
  }

  if (message?.type === 'content-kit:set-locale') {
    if (typeof message.locale !== 'string') {
      sendResponse(state);
      return true;
    }

    refresh()
      .then(() => switchLocale(message.locale))
      .then(sendResponse);
    return true;
  }

  if (message?.type === 'content-kit:scroll-to-edit') {
    if (typeof message.key !== 'string' || !isSafeContentKey(message.key)) {
      sendResponse(false);
      return true;
    }

    refresh()
      .then(() => scrollToEditKey(message.key))
      .then(sendResponse);
    return true;
  }

  return false;
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  if (activeSelectPicker) {
    event.preventDefault();
    closeSelectPicker({ restoreFocus: true });
    return;
  }

  if (activeDrag) {
    event.preventDefault();
    finishBlockDrag(activeDrag, true);
  }
});

document.addEventListener(
  'pointerup',
  (event) => {
    const session = activeDrag;

    if (session?.pointerId === event.pointerId && !session.finishing) {
      session.pointerX = event.clientX;
      session.pointerY = event.clientY;
      finishBlockDrag(session, false);
    }
  },
  true
);

document.addEventListener(
  'pointercancel',
  (event) => {
    const session = activeDrag;

    if (session?.pointerId === event.pointerId && !session.finishing) {
      finishBlockDrag(session, true);
    }
  },
  true
);

window.addEventListener('blur', () => {
  if (activeDrag && !activeDrag.finishing) {
    finishBlockDrag(activeDrag, true);
  }
});

window.addEventListener(
  'scroll',
  () => {
    const session = activeDrag;

    if (!session?.activated || session.finishing || session.frameId) {
      return;
    }

    session.frameId = window.requestAnimationFrame(() => {
      updateBlockDrag(session);
    });
  },
  { capture: true, passive: true }
);

if (document.body) {
  startObserver();
  refresh();
} else {
  window.addEventListener(
    'DOMContentLoaded',
    () => {
      startObserver();
      refresh();
    },
    { once: true }
  );
}
