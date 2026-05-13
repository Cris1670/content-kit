import { defaultLocales } from '../shared/constants.js';
import {
  countLocaleEdits,
  countProjectEdits,
  getProjectLocales,
  getVisibleTreeEntries
} from '../domain/edits.js';
import { buildEditTree, getEntryLabel } from '../domain/tree.js';

const renderStatus = (elements, state) => {
  const setVisualState = (extensionEnabled, editModeEnabled) => {
    elements.statusDot.classList.toggle('active', extensionEnabled);
    elements.powerButton.classList.toggle('active', extensionEnabled);
    elements.editModeInput.checked = extensionEnabled && editModeEnabled;
    elements.editModeInput.disabled = !extensionEnabled;
  };

  if (!state) {
    setVisualState(elements.powerButton.classList.contains('active'), false);
    elements.statusText.textContent =
      'Open a page with Content Kit edit markers.';
    return;
  }

  if (!state.extensionEnabled) {
    setVisualState(false, false);
    elements.statusText.textContent = 'Extension is off.';
    return;
  }

  if (!state.pageEditable) {
    setVisualState(true, state.editModeEnabled);
    elements.statusText.textContent =
      'No editable text fields found on this page.';
    return;
  }

  setVisualState(true, state.editModeEnabled);
  elements.statusText.textContent = state.editModeEnabled
    ? `${state.editableCount} fields ready to edit. ${state.editCount} saved edits for ${state.locale}.`
    : `${state.editableCount} fields found. ${state.editCount} saved edits are applied for ${state.locale}.`;
};

const renderFiles = (elements, activeFileHandle, activeProject) => {
  const totalEdits = countProjectEdits(activeProject);

  elements.saveFileButton.disabled = totalEdits === 0;

  if (activeFileHandle) {
    elements.fileStatus.textContent = `Using ${activeFileHandle.name}.`;
    return;
  }

  elements.fileStatus.textContent = totalEdits
    ? 'Edits are saved in Chrome. Choose Save edits file to write a shared file.'
    : 'No edit file loaded.';
};

const renderDownloads = (
  elements,
  activeProject,
  activeState,
  onDownloadLocale
) => {
  const totalEdits = countProjectEdits(activeProject);

  elements.downloadAllButton.disabled = totalEdits === 0;
  elements.totalBadge.textContent = `${totalEdits} total`;
  elements.downloadNote.textContent = totalEdits
    ? `${totalEdits} saved edits for this site.`
    : 'No saved edits yet.';
  elements.languageButtons.textContent = '';

  getProjectLocales(activeProject, activeState).forEach((locale) => {
    const count = countLocaleEdits(activeProject, locale);
    const button = document.createElement('button');
    const code = document.createElement('span');
    const countLabel = document.createElement('span');

    button.className = 'language-button';
    button.classList.toggle('active', count > 0);
    button.type = 'button';
    button.disabled = count === 0;

    code.className = 'language-code';
    code.textContent = locale.toUpperCase();

    countLabel.className = 'language-count';
    countLabel.textContent = `(${count})`;

    button.append(code, countLabel);
    button.addEventListener('click', () => {
      onDownloadLocale(locale);
    });

    elements.languageButtons.appendChild(button);
  });
};

const setSelectedLocale = (elements, locale) => {
  Array.from(elements.localeButtons.querySelectorAll('.locale-button')).forEach(
    (button) => {
      const isActive = button.dataset.locale === locale;

      button.classList.toggle('active', isActive);
      button.disabled = isActive;
    }
  );
};

const renderLocaleSwitcher = (elements, state, onSelectLocale) => {
  const config = state?.contentConfig;
  const locales =
    config?.locales && config.locales.length > 0
      ? config.locales
      : defaultLocales;

  elements.localeButtons.textContent = '';
  elements.localeNote.textContent = state?.extensionEnabled
    ? 'Switch language without using the website navigation.'
    : 'Turn on the extension to switch page language.';

  locales.forEach((locale) => {
    const button = document.createElement('button');

    button.className = 'locale-button';
    button.classList.toggle('active', state?.locale === locale);
    button.dataset.locale = locale;
    button.type = 'button';
    button.disabled = !state?.extensionEnabled || state.locale === locale;
    button.textContent = locale.toUpperCase();
    button.addEventListener('click', () => {
      setSelectedLocale(elements, locale);
      elements.localeNote.textContent = `Switching to ${locale.toUpperCase()}...`;
      onSelectLocale(locale);
    });

    elements.localeButtons.appendChild(button);
  });
};

const renderTreeBranch = (
  label,
  node,
  treeUiState,
  callbacks,
  parentPath = ''
) => {
  if (node.edit) {
    const button = document.createElement('button');
    const key = document.createElement('span');
    const value = document.createElement('span');

    button.className = 'edit-tree-leaf';
    button.classList.toggle('unedited', !node.edit.edited);
    button.classList.toggle('has-change', node.edit.edited || node.edit.dirty);
    button.type = 'button';

    key.className = 'edit-tree-key';
    key.textContent = label;

    value.className = 'edit-tree-value';
    value.textContent = getEntryLabel(node.edit);

    button.append(key, value);
    button.addEventListener('click', () => {
      callbacks.onNavigateToEdit(node.edit);
    });

    return button;
  }

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const children = document.createElement('div');
  const path = parentPath ? `${parentPath}/${label}` : label;

  details.className = 'edit-tree-group';
  details.classList.toggle('has-change', node.hasChange);
  details.dataset.treePath = path;
  details.open = treeUiState.openPaths.includes(path);
  summary.className = 'edit-tree-summary';
  summary.textContent = label;
  children.className = 'edit-tree-children';

  details.addEventListener('toggle', () => {
    callbacks.onTreePathToggle(path, details.open);
  });

  Array.from(node.children.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([childLabel, childNode]) => {
      children.appendChild(
        renderTreeBranch(childLabel, childNode, treeUiState, callbacks, path)
      );
    });

  details.append(summary, children);

  return details;
};

const renderEditTree = ({
  activeProject,
  activeState,
  callbacks,
  elements,
  treeUiState
}) => {
  if (!activeState?.locale) {
    elements.editsTree.textContent = '';
    elements.editsNote.textContent =
      'Open a page with Content Kit edit markers.';
    return;
  }

  const showUnedited = elements.showUneditedInput.checked;
  const edits = getVisibleTreeEntries(activeProject, activeState, showUnedited);
  const root = buildEditTree(edits);
  const locale = activeState?.locale ?? '';
  const editedCount = countLocaleEdits(activeProject, locale);

  elements.editsTree.textContent = '';
  elements.editsNote.textContent = showUnedited
    ? `${edits.length} fields for ${locale.toUpperCase()}. ${editedCount} edited.`
    : editedCount
      ? `${editedCount} saved edits for ${locale.toUpperCase()}.`
      : `No saved edits for ${locale.toUpperCase()}.`;

  if (edits.length === 0) {
    return;
  }

  Array.from(root.children.entries()).forEach(([label, node]) => {
    elements.editsTree.appendChild(
      renderTreeBranch(label, node, treeUiState, callbacks)
    );
  });
};

export {
  renderDownloads,
  renderEditTree,
  renderFiles,
  renderLocaleSwitcher,
  renderStatus,
  setSelectedLocale
};
