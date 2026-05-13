import { fileHandleDbName, fileHandleStoreName } from '../shared/constants.js';

const openHandleDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(fileHandleDbName, 1);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(fileHandleStoreName);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });

const getStoredFileHandle = async (projectId) => {
  if (!projectId) {
    return null;
  }

  const db = await openHandleDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(fileHandleStoreName, 'readonly');
    const request = transaction.objectStore(fileHandleStoreName).get(projectId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result ?? null);
  });
};

const setStoredFileHandle = async (projectId, handle) => {
  if (!projectId || !handle) {
    return;
  }

  const db = await openHandleDb();

  await new Promise((resolve, reject) => {
    const transaction = db.transaction(fileHandleStoreName, 'readwrite');
    const request = transaction
      .objectStore(fileHandleStoreName)
      .put(handle, projectId);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
};

const writeFileHandle = async (handle, payload) => {
  if (handle.requestPermission) {
    const permission = await handle.requestPermission({ mode: 'readwrite' });

    if (permission !== 'granted') {
      throw new Error('Permission to save the edit file was denied.');
    }
  }

  const writable = await handle.createWritable();

  await writable.write(`${JSON.stringify(payload, null, 2)}\n`);
  await writable.close();
};

export { getStoredFileHandle, setStoredFileHandle, writeFileHandle };
