import { maxEditFileBytes } from '../shared/constants.js';

const readFilePayload = async (file) => {
  if (!file || file.size <= 0 || file.size > maxEditFileBytes) {
    throw new Error('Edit files must be JSON files between 1 byte and 25 MB.');
  }

  if (file.name && !file.name.toLowerCase().endsWith('.json')) {
    throw new Error('Choose a Content Kit JSON edit file.');
  }

  return JSON.parse(await file.text());
};

const chooseOpenEditFile = async () => {
  if (!window.showOpenFilePicker) {
    return null;
  }

  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: 'Content Kit edit JSON',
        accept: {
          'application/json': ['.json']
        }
      }
    ]
  });

  return handle ?? null;
};

const chooseSaveEditFile = async (suggestedName) => {
  if (!window.showSaveFilePicker) {
    return null;
  }

  return window.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: 'Content Kit edit JSON',
        accept: {
          'application/json': ['.json']
        }
      }
    ]
  });
};

const downloadJson = (payload, filename) => {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};

export {
  chooseOpenEditFile,
  chooseSaveEditFile,
  downloadJson,
  readFilePayload
};
