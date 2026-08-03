const getPopupElements = () => ({
  downloadAllButton: document.getElementById('download-all'),
  downloadNote: document.getElementById('download-note'),
  editModeInput: document.getElementById('edit-mode'),
  editorView: document.getElementById('editor-view'),
  editsNote: document.getElementById('edits-note'),
  editsPanel: document.getElementById('edits-panel'),
  editsTree: document.getElementById('edits-tree'),
  fileStatus: document.getElementById('file-status'),
  experimentalOrderingInput: document.getElementById('experimental-ordering'),
  languageButtons: document.getElementById('language-buttons'),
  loadFileButton: document.getElementById('load-file-button'),
  loadFileInput: document.getElementById('load-file-input'),
  localeButtons: document.getElementById('locale-buttons'),
  localeNote: document.getElementById('locale-note'),
  powerButton: document.getElementById('power-button'),
  saveFileButton: document.getElementById('save-file-button'),
  settingsBackButton: document.getElementById('settings-back-button'),
  settingsButton: document.getElementById('settings-button'),
  settingsView: document.getElementById('settings-view'),
  showUneditedControl: document.querySelector('.checkbox-control.compact'),
  showUneditedInput: document.getElementById('show-unedited'),
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status'),
  totalBadge: document.getElementById('total-badge')
});

export { getPopupElements };
