import {
  experimentalFeaturesStorageKey,
  maxContentKeyLength,
  storageKey,
  treeStateStorageKey
} from '../shared/constants.js';

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

const getExtensionFlags = async () => {
  const result = await chrome.storage.local.get({
    [experimentalFeaturesStorageKey]: { ordering: false },
    contentKitEditMode: false,
    contentKitEnabled: false
  });

  return {
    contentKitEditMode: result.contentKitEditMode === true,
    contentKitEnabled: result.contentKitEnabled === true,
    experimentalFeatures: {
      ordering: result[experimentalFeaturesStorageKey]?.ordering === true
    }
  };
};

const saveExtensionEnabled = async (enabled) => {
  const nextState = enabled
    ? { contentKitEnabled: true }
    : { contentKitEditMode: false, contentKitEnabled: false };

  await chrome.storage.local.set(nextState);

  return nextState;
};

const saveEditModeEnabled = async (enabled) => {
  await chrome.storage.local.set({ contentKitEditMode: enabled });
};

const saveExperimentalOrderingEnabled = async (enabled) => {
  const result = await chrome.storage.local.get({
    [experimentalFeaturesStorageKey]: {}
  });
  const currentFeatures = result[experimentalFeaturesStorageKey];

  await chrome.storage.local.set({
    [experimentalFeaturesStorageKey]: {
      ...(currentFeatures && typeof currentFeatures === 'object'
        ? currentFeatures
        : {}),
      ordering: enabled === true
    }
  });
};

const loadTreeUiState = async (fallbackState) => {
  const result = await chrome.storage.local.get({
    [treeStateStorageKey]: fallbackState
  });
  const storedState = result[treeStateStorageKey];

  if (!storedState || typeof storedState !== 'object') {
    return fallbackState;
  }

  return {
    openPaths: Array.isArray(storedState.openPaths)
      ? storedState.openPaths
          .filter((path) => typeof path === 'string')
          .filter((path) => path.length <= maxContentKeyLength)
          .slice(0, 200)
      : [],
    panelOpen: storedState.panelOpen === true
  };
};

const saveTreeUiState = async (treeUiState) => {
  await chrome.storage.local.set({ [treeStateStorageKey]: treeUiState });
};

const savePendingScroll = async (pendingScrollStorageKey, pendingScroll) => {
  await chrome.storage.local.set({
    [pendingScrollStorageKey]: pendingScroll
  });
};

export {
  getEmptyStore,
  getExtensionFlags,
  getStore,
  loadTreeUiState,
  saveEditModeEnabled,
  saveExperimentalOrderingEnabled,
  saveExtensionEnabled,
  savePendingScroll,
  saveStore,
  saveTreeUiState
};
