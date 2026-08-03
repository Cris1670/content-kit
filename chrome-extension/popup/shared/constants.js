const storageKey = 'contentKitBrowserEdits';
const pendingScrollStorageKey = 'contentKitPendingScroll';
const treeStateStorageKey = 'contentKitTreeState';
const experimentalFeaturesStorageKey = 'contentKitExperimentalFeatures';
const fileHandleDbName = 'content-kit-file-handles';
const fileHandleStoreName = 'handles';
const defaultLocales = ['en', 'de', 'fr', 'it'];
const forbiddenPathParts = new Set(['__proto__', 'constructor', 'prototype']);
const maxArrayIndex = 5000;
const maxContentKeyLength = 512;
const maxEditFileBytes = 25 * 1024 * 1024;
const maxImageBytes = 5 * 1024 * 1024;
const allowedImageExtensions = new Set(['gif', 'jpg', 'jpeg', 'png', 'webp']);
const allowedImageTypes = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export {
  allowedImageExtensions,
  allowedImageTypes,
  defaultLocales,
  experimentalFeaturesStorageKey,
  fileHandleDbName,
  fileHandleStoreName,
  forbiddenPathParts,
  maxArrayIndex,
  maxContentKeyLength,
  maxEditFileBytes,
  maxImageBytes,
  pendingScrollStorageKey,
  storageKey,
  treeStateStorageKey
};
