import {
  buildExport,
  countProjectEdits,
  getSuggestedFilename,
  mergeEditPayload
} from './popup/domain/edits.js';
import { getPopupElements } from './popup/ui/dom.js';
import {
  renderDownloads,
  renderEditTree,
  renderFiles,
  renderLocaleSwitcher,
  renderStatus
} from './popup/ui/render.js';
import {
  chooseOpenEditFile,
  chooseSaveEditFile,
  downloadJson,
  readFilePayload
} from './popup/services/files.js';
import {
  getStoredFileHandle,
  setStoredFileHandle,
  writeFileHandle
} from './popup/services/file-handles.js';
import {
  getExtensionFlags,
  getStore,
  loadTreeUiState,
  saveEditModeEnabled,
  saveExperimentalOrderingEnabled,
  saveExtensionEnabled,
  savePendingScroll,
  saveStore,
  saveTreeUiState
} from './popup/services/storage.js';
import {
  getActiveTab,
  sendToActiveTab,
  updateTabUrl
} from './popup/services/tabs.js';
import { pendingScrollStorageKey } from './popup/shared/constants.js';
import {
  getComparableUrl,
  getProjectIdFromUrl,
  getSafeEditUrl
} from './popup/shared/security.js';

const elements = getPopupElements();

let activeProjectId = null;
let activeProject = null;
let activeFileHandle = null;
let activeState = null;
let reloadTimer = 0;
let treeUiState = {
  openPaths: [],
  panelOpen: false
};

const getFreshProject = async () => {
  const store = await getStore();

  return activeProjectId ? store.projects[activeProjectId] : null;
};

const mergePayloadIntoStore = async (payload) => {
  const store = await getStore();
  const payloadOrigin = getProjectIdFromUrl(
    payload?.project && typeof payload.project.origin === 'string'
      ? payload.project.origin
      : ''
  );
  const result = mergeEditPayload({
    activeProjectId,
    payload,
    payloadOrigin,
    state: activeState,
    store
  });

  await saveStore(store);
  await sendToActiveTab({ type: 'content-kit:reload-edits' });

  activeProject = result.project;

  return result.count;
};

const syncStoredFileHandle = async () => {
  if (!activeFileHandle?.queryPermission) {
    return;
  }

  const permission = await activeFileHandle.queryPermission({ mode: 'read' });

  if (permission !== 'granted') {
    return;
  }

  const file = await activeFileHandle.getFile();
  await mergePayloadIntoStore(await readFilePayload(file));
};

const loadProject = async (state) => {
  const tab = await getActiveTab();
  const fallbackProjectId = getProjectIdFromUrl(tab?.url ?? '');

  activeProjectId = state?.origin ?? fallbackProjectId;
  activeProject = await getFreshProject();
  activeFileHandle = await getStoredFileHandle(activeProjectId);

  if (activeFileHandle) {
    await syncStoredFileHandle();
    activeProject = await getFreshProject();
  }
};

const downloadExport = (locale) => {
  if (!activeProject) {
    return;
  }

  downloadJson(
    buildExport(activeProject, locale),
    getSuggestedFilename(activeProject, locale ? locale : 'all')
  );
};

const renderAll = () => {
  renderStatus(elements, activeState);
  renderLocaleSwitcher(elements, activeState, selectLocale);
  renderFiles(elements, activeFileHandle, activeProject);
  renderEditTree({
    activeProject,
    activeState,
    callbacks: {
      onNavigateToEdit: navigateToEdit,
      onTreePathToggle: updateTreePathState
    },
    elements,
    treeUiState
  });
  renderDownloads(elements, activeProject, activeState, downloadExport);
};

const showSettingsView = (visible) => {
  elements.editorView.hidden = visible;
  elements.settingsView.hidden = !visible;
  elements.settingsButton.classList.toggle('active', visible);
  elements.settingsButton.setAttribute(
    'aria-label',
    visible ? 'Settings open' : 'Open settings'
  );

  if (visible) {
    elements.settingsBackButton.focus();
  } else {
    elements.settingsButton.focus();
  }
};

const loadState = async () => {
  const stored = await getExtensionFlags();

  treeUiState = await loadTreeUiState(treeUiState);
  elements.editsPanel.open = treeUiState.panelOpen;
  elements.editModeInput.checked = stored.contentKitEditMode;
  elements.experimentalOrderingInput.checked =
    stored.experimentalFeatures.ordering;
  elements.powerButton.classList.toggle('active', stored.contentKitEnabled);

  activeState = await sendToActiveTab({ type: 'content-kit:get-state' });
  await loadProject(activeState);
  renderAll();
};

const scheduleLoadState = () => {
  if (reloadTimer) {
    window.clearTimeout(reloadTimer);
  }

  reloadTimer = window.setTimeout(() => {
    reloadTimer = 0;
    loadState();
  }, 250);
};

const loadFileObject = async (file) => {
  const count = await mergePayloadIntoStore(await readFilePayload(file));

  elements.fileStatus.textContent = `Loaded ${count} edits from ${file.name}.`;
  await loadState();
};

const chooseAndLoadFile = async () => {
  const handle = await chooseOpenEditFile();

  if (!handle) {
    elements.loadFileInput.click();
    return;
  }

  const file = await handle.getFile();
  const count = await mergePayloadIntoStore(await readFilePayload(file));

  activeFileHandle = handle;
  await setStoredFileHandle(activeProjectId, handle);
  elements.fileStatus.textContent = `Loaded ${count} edits from ${file.name}.`;
  await loadState();
};

const saveActiveFile = async () => {
  if (!activeProject || countProjectEdits(activeProject) === 0) {
    return;
  }

  let handle = activeFileHandle;

  if (!handle) {
    handle = await chooseSaveEditFile(getSuggestedFilename(activeProject));
  }

  if (!handle) {
    downloadExport();
    return;
  }

  await writeFileHandle(handle, buildExport(activeProject));
  activeFileHandle = handle;
  await setStoredFileHandle(activeProjectId, handle);
  elements.fileStatus.textContent = `Saved to ${handle.name}.`;
};

const selectLocale = async (locale) => {
  const nextState = await sendToActiveTab({
    locale,
    type: 'content-kit:set-locale'
  });

  if (nextState) {
    activeState = nextState;
    renderLocaleSwitcher(elements, nextState, selectLocale);
  }
};

const navigateToEdit = async (edit) => {
  const tab = await getActiveTab();

  if (!tab?.id) {
    return;
  }

  const safeUrl = getSafeEditUrl(edit.url, activeProjectId);

  await savePendingScroll(pendingScrollStorageKey, {
    createdAt: new Date().toISOString(),
    key: edit.key,
    origin: activeProjectId,
    url: safeUrl
  });

  if (safeUrl && getComparableUrl(safeUrl) !== getComparableUrl(tab.url)) {
    await updateTabUrl(tab.id, safeUrl);
    return;
  }

  await sendToActiveTab({
    key: edit.key,
    type: 'content-kit:scroll-to-edit'
  });
};

const updateTreePathState = (path, open) => {
  const openPaths = new Set(treeUiState.openPaths);

  if (open) {
    openPaths.add(path);
  } else {
    openPaths.delete(path);
  }

  treeUiState = {
    ...treeUiState,
    openPaths: Array.from(openPaths)
  };
  saveTreeUiState(treeUiState);
};

elements.editModeInput.addEventListener('change', async () => {
  if (!elements.powerButton.classList.contains('active')) {
    elements.editModeInput.checked = false;
    return;
  }

  const enabled = elements.editModeInput.checked;
  await saveEditModeEnabled(enabled);

  activeState = await sendToActiveTab({
    type: 'content-kit:set-edit-mode',
    enabled
  });
  await loadProject(activeState);
  renderAll();
});

elements.powerButton.addEventListener('click', async () => {
  const enabled = !elements.powerButton.classList.contains('active');

  await saveExtensionEnabled(enabled);
  elements.powerButton.classList.toggle('active', enabled);
  elements.editModeInput.checked = enabled
    ? elements.editModeInput.checked
    : false;
  elements.editModeInput.disabled = !enabled;

  activeState = await sendToActiveTab({
    type: 'content-kit:set-enabled',
    enabled
  });
  await loadProject(activeState);
  renderAll();
});

elements.settingsButton.addEventListener('click', () => {
  showSettingsView(true);
});

elements.settingsBackButton.addEventListener('click', () => {
  showSettingsView(false);
});

elements.experimentalOrderingInput.addEventListener('change', async () => {
  const enabled = elements.experimentalOrderingInput.checked;

  await saveExperimentalOrderingEnabled(enabled);
  activeState = await sendToActiveTab({
    type: 'content-kit:reload-settings'
  });
  await loadProject(activeState);
  renderAll();
});

elements.loadFileButton.addEventListener('click', async () => {
  try {
    await chooseAndLoadFile();
  } catch (error) {
    elements.fileStatus.textContent =
      error instanceof Error ? error.message : 'Could not load edit file.';
  }
});

elements.loadFileInput.addEventListener('change', async () => {
  const file = elements.loadFileInput.files?.[0];

  if (!file) {
    return;
  }

  try {
    await loadFileObject(file);
  } catch (error) {
    elements.fileStatus.textContent =
      error instanceof Error ? error.message : 'Could not load edit file.';
  } finally {
    elements.loadFileInput.value = '';
  }
});

elements.saveFileButton.addEventListener('click', async () => {
  try {
    await saveActiveFile();
  } catch (error) {
    elements.fileStatus.textContent =
      error instanceof Error ? error.message : 'Could not save edit file.';
  }
});

elements.downloadAllButton.addEventListener('click', () => {
  downloadExport();
});

elements.showUneditedInput.addEventListener('change', () => {
  renderAll();
});

elements.showUneditedInput.addEventListener('click', (event) => {
  event.stopPropagation();
});

elements.showUneditedControl.addEventListener('click', (event) => {
  event.stopPropagation();
});

elements.editsPanel.addEventListener('toggle', () => {
  treeUiState = {
    ...treeUiState,
    panelOpen: elements.editsPanel.open
  };
  saveTreeUiState(treeUiState);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') {
    return;
  }

  const activeTab = await getActiveTab();

  if (activeTab?.id === tabId) {
    scheduleLoadState();
  }
});

loadState();
