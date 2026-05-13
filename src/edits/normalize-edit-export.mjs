import { parseMessagePath } from '../messages/message-path.mjs';
import { fail } from '../utils/errors.mjs';

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

const normalizeBrowserEditExport = (payload, config) => {
  if (!payload || typeof payload !== 'object') {
    fail('Browser edit export must be a JSON object.');
  }

  const edits = [];

  if (Array.isArray(payload.edits)) {
    payload.edits.forEach((edit, index) => {
      if (!edit || typeof edit !== 'object') {
        fail(`Browser edit ${index + 1}: edit must be an object.`);
      }

      if (
        typeof edit.key !== 'string' ||
        typeof edit.locale !== 'string' ||
        typeof edit.value !== 'string'
      ) {
        fail(
          `Browser edit ${index + 1}: expected string key, locale, and value.`
        );
      }

      edits.push({
        key: edit.key,
        locale: edit.locale,
        value: edit.value
      });
    });
  } else if (payload.messages && typeof payload.messages === 'object') {
    Object.entries(payload.messages).forEach(([locale, messages]) => {
      collectLeafEdits(messages, locale, '', edits);
    });
  } else if (!Array.isArray(payload.imageEdits)) {
    fail('Browser edit export must contain an edits array or messages object.');
  }

  if (edits.length === 0 && !Array.isArray(payload.imageEdits)) {
    fail('Browser edit export does not contain any edits.');
  }

  edits.forEach((edit, index) => {
    if (!config.locales.includes(edit.locale)) {
      fail(
        `Browser edit ${index + 1}: locale "${edit.locale}" is not configured.`
      );
    }

    parseMessagePath(edit.key, `Browser edit ${index + 1}`);
  });

  return edits;
};

const normalizeBrowserImageEditExport = (payload, config) => {
  if (!payload || typeof payload !== 'object') {
    fail('Browser edit export must be a JSON object.');
  }

  if (!Array.isArray(payload.imageEdits)) {
    return [];
  }

  const imageEdits = payload.imageEdits.map((edit, index) => {
    if (!edit || typeof edit !== 'object') {
      fail(`Browser image edit ${index + 1}: edit must be an object.`);
    }

    if (
      typeof edit.key !== 'string' ||
      typeof edit.locale !== 'string' ||
      typeof edit.dataUrl !== 'string' ||
      typeof edit.fileName !== 'string'
    ) {
      fail(
        `Browser image edit ${index + 1}: expected string key, locale, dataUrl, and fileName.`
      );
    }

    return {
      dataUrl: edit.dataUrl,
      fileName: edit.fileName,
      key: edit.key,
      locale: edit.locale,
      mimeType:
        typeof edit.mimeType === 'string'
          ? edit.mimeType
          : 'application/octet-stream'
    };
  });

  imageEdits.forEach((edit, index) => {
    if (!config.locales.includes(edit.locale)) {
      fail(
        `Browser image edit ${index + 1}: locale "${edit.locale}" is not configured.`
      );
    }

    parseMessagePath(edit.key, `Browser image edit ${index + 1}`);
  });

  return imageEdits;
};

export { normalizeBrowserEditExport, normalizeBrowserImageEditExport };
