const editSelector = '[data-ck-edit]';
const imageSelector = '[data-ck-image]';
const maxConfigLocales = 20;
const maxLocalePathPatternLength = 160;
const maxArrayIndex = 5000;
const maxContentKeyLength = 512;
const maxImageBytes = 5 * 1024 * 1024;
const pendingScrollStorageKey = 'contentKitPendingScroll';
const storageKey = 'contentKitBrowserEdits';
const allowedImageExtensions = new Set(['gif', 'jpg', 'jpeg', 'png', 'webp']);
const allowedImageTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const forbiddenPathParts = new Set(['__proto__', 'constructor', 'prototype']);
const defaultContentConfig = {
  baseLocale: 'en',
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
  editCount: 0,
  extensionEnabled: false,
  locale: '',
  origin: '',
  pageEditable: false
};

const boundElements = new WeakSet();
const dirtyKeys = new Set();

let observer = null;
let refreshTimer = 0;

const isSupportedLocale = (locale) =>
  /^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(locale);

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
        document.querySelectorAll(`${editSelector}, ${imageSelector}`)
      ).find(
        (element) =>
          element.getAttribute('data-ck-edit') === key ||
          element.getAttribute('data-ck-image') === key
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

  store.projects[origin].title = getProjectTitle();
  store.projects[origin].updatedAt = new Date().toISOString();

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

const storeEdit = async (key, value) => {
  if (!isSafeContentKey(key)) {
    throw new Error('Invalid Content Kit text key.');
  }

  const store = await getStore();
  const project = ensureProject(store);
  const locale = getLocale();

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

  await saveStore(store);

  return Object.keys(project.edits[locale]).length;
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
  element.dataset.ckImageEnabled = enabled ? 'true' : 'false';
  delete element.dataset.ckSaving;
  delete element.dataset.ckError;
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

  if (!key || !isSafeContentKey(key)) {
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
    state.editCount = await storeEdit(key, value);
    element.dataset.ckOriginalText = value;
    dirtyKeys.delete(key);
    state.dirtyKeys = Array.from(dirtyKeys);
    syncMatchingElements(key, value, element);
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

const disableEditing = () => {
  document.documentElement.classList.remove('content-kit-edit-on');
  document.documentElement.classList.remove('content-kit-image-edit-on');
  document.querySelectorAll(editSelector).forEach((element) => {
    setElementState(element, false);
  });
  document.querySelectorAll(imageSelector).forEach((element) => {
    setImageState(element, false);
  });
};

const disableExtension = () => {
  disableEditing();
  dirtyKeys.clear();
  state.dirtyKeys = [];
  state.editableCount = 0;
  state.editableFields = [];
  state.editableImages = [];
  state.editCount = 0;
  state.pageEditable = false;
};

const refresh = async () => {
  const stored = await chrome.storage.local.get({
    contentKitEditMode: false,
    contentKitEnabled: false
  });
  state.contentConfig = readContentConfig();
  state.extensionEnabled = stored.contentKitEnabled;
  state.editModeEnabled =
    state.extensionEnabled && stored.contentKitEditMode === true;
  state.locale = getLocale();
  state.origin = getProjectId();

  if (!state.extensionEnabled) {
    disableExtension();
    return state;
  }

  const elements = Array.from(document.querySelectorAll(editSelector)).filter(
    (element) => isSafeContentKey(element.getAttribute('data-ck-edit'))
  );
  const imageElements = Array.from(
    document.querySelectorAll(imageSelector)
  ).filter((element) =>
    isSafeContentKey(element.getAttribute('data-ck-image'))
  );
  const edits = await getLocaleEdits();
  const imageEdits = await getLocaleImageEdits();

  state.editableCount = elements.length + imageElements.length;
  state.editCount = Object.keys(edits).length + Object.keys(imageEdits).length;
  state.pageEditable = elements.length > 0 || imageElements.length > 0;

  if (!state.pageEditable) {
    disableEditing();
    state.extensionEnabled = true;
    state.editableFields = [];
    state.editableImages = [];
    await consumePendingScroll();
    return state;
  }

  applyStoredEdits(elements, edits);
  applyStoredImageEdits(imageElements, imageEdits);
  state.editableFields = elements.map((element) => ({
    key: element.getAttribute('data-ck-edit') ?? '',
    locale: state.locale,
    url: window.location.href,
    value: element.textContent ?? ''
  }));
  state.editableImages = imageElements.map((element) => ({
    key: element.getAttribute('data-ck-image') ?? '',
    locale: state.locale,
    url: window.location.href,
    value:
      getImageTarget(element)?.getAttribute('src') ??
      element.style.backgroundImage ??
      ''
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
  await consumePendingScroll();

  return state;
};

const scheduleRefresh = () => {
  if (refreshTimer) {
    return;
  }

  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0;
    refresh();
  }, 100);
};

const startObserver = () => {
  if (observer || !document.body) {
    return;
  }

  observer = new MutationObserver(() => {
    if (state.extensionEnabled) {
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
