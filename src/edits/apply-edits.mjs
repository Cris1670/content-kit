import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

import {
  assertNoSparseArrays,
  parseMessagePath,
  setValueAtPath
} from '../messages/message-path.mjs';
import { fail } from '../utils/errors.mjs';
import { readJsonFile, toUtf8Json } from '../utils/json.mjs';
import { resolveFromCwd, resolveFromDir } from '../utils/filesystem.mjs';
import {
  normalizeBrowserEditExport,
  normalizeBrowserImageEditExport
} from './normalize-edit-export.mjs';

const applyEditsToMessages = (edits, paths) => {
  const messagesByLocale = new Map();

  edits.forEach((edit, index) => {
    if (!messagesByLocale.has(edit.locale)) {
      const messagePath = join(paths.messagesDir, `${edit.locale}.json`);
      const catalog = existsSync(messagePath) ? readJsonFile(messagePath) : {};

      messagesByLocale.set(edit.locale, {
        catalog,
        messagePath
      });
    }

    const localeMessages = messagesByLocale.get(edit.locale);
    const pathParts = parseMessagePath(edit.key, `Browser edit ${index + 1}`);

    setValueAtPath(localeMessages.catalog, pathParts, edit.value);
  });

  messagesByLocale.forEach(({ catalog, messagePath }) => {
    assertNoSparseArrays(catalog);
    mkdirSync(dirname(messagePath), { recursive: true });
    writeFileSync(messagePath, toUtf8Json(catalog), 'utf-8');
  });
};

const maxImageBytes = 5 * 1024 * 1024;
const allowedImageExtensions = new Set([
  '.gif',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp'
]);
const extensionByMimeType = new Map([
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

const sanitizeFilename = (filename, mimeType) => {
  const safeName =
    filename
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'image';
  const requiredExtension = extensionByMimeType.get(mimeType) ?? '.bin';
  const hasAllowedExtension = Array.from(allowedImageExtensions).some((ext) =>
    safeName.endsWith(ext)
  );

  return hasAllowedExtension ? safeName : `${safeName}${requiredExtension}`;
};

const hasValidImageSignature = (buffer, mimeType) => {
  if (mimeType === 'image/png') {
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (mimeType === 'image/jpeg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === 'image/gif') {
    return buffer.subarray(0, 4).toString('ascii') === 'GIF8';
  }

  if (mimeType === 'image/webp') {
    return (
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }

  return false;
};

const parseDataUrl = (dataUrl, label) => {
  const match = dataUrl.match(
    /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u
  );

  if (!match || match[2].length % 4 !== 0) {
    fail(`${label}: expected a base64 PNG, JPEG, GIF, or WebP data URL.`);
  }

  const buffer = Buffer.from(match[2], 'base64');
  const mimeType = match[1];

  if (buffer.length > maxImageBytes) {
    fail(`${label}: image exceeds the ${maxImageBytes} byte limit.`);
  }

  if (!hasValidImageSignature(buffer, mimeType)) {
    fail(`${label}: image content does not match its declared MIME type.`);
  }

  return {
    buffer,
    mimeType
  };
};

const joinPublicPath = (basePath, filename) =>
  `${basePath.replace(/\/+$/u, '')}/${filename}`;

const applyImageEdits = (imageEdits, paths) => {
  const messageEdits = imageEdits.map((edit, index) => {
    const { buffer, mimeType } = parseDataUrl(
      edit.dataUrl,
      `Browser image edit ${index + 1}`
    );
    const safeFilename = sanitizeFilename(edit.fileName, mimeType);
    const finalFilename = `${edit.locale}-${randomUUID()}-${safeFilename}`;
    const outputPath = join(paths.imagesDir, finalFilename);
    const publicUrl = joinPublicPath(paths.imagePublicPath, finalFilename);

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, buffer);

    return {
      key: edit.key,
      locale: edit.locale,
      value: publicUrl
    };
  });

  applyEditsToMessages(messageEdits, paths);
};

const validateConfig = (config) => {
  if (!Array.isArray(config.locales) || config.locales.length === 0) {
    fail('Config field "locales" must be a non-empty array.');
  }

  if (!config.locales.includes(config.baseLocale)) {
    fail(`baseLocale "${config.baseLocale}" must be listed in locales.`);
  }

  if (
    typeof config.localePathPattern !== 'string' ||
    config.localePathPattern.length === 0
  ) {
    fail('Config field "localePathPattern" must be a non-empty regex string.');
  }

  try {
    new RegExp(config.localePathPattern);
  } catch {
    fail(`localePathPattern is not a valid regex: ${config.localePathPattern}`);
  }

  if (typeof config.imagesDir !== 'string' || config.imagesDir.length === 0) {
    fail('Config field "imagesDir" must be a non-empty string.');
  }

  if (
    typeof config.imagePublicPath !== 'string' ||
    config.imagePublicPath.length === 0
  ) {
    fail('Config field "imagePublicPath" must be a non-empty string.');
  }

  if (
    !config.imagePublicPath.startsWith('/') ||
    config.imagePublicPath.includes('..')
  ) {
    fail('Config field "imagePublicPath" must be a root-relative public path.');
  }
};

const applyBrowserEdits = (config, configDir, options) => {
  if (!options.input) {
    fail('Run apply-edits with --input <browser-edit-export.json>.');
  }

  validateConfig(config);

  const inputPath = resolveFromCwd(options.input);

  if (!existsSync(inputPath)) {
    fail(`Browser edit export not found: ${inputPath}`);
  }

  const paths = {
    imagePublicPath: config.imagePublicPath,
    imagesDir: resolveFromDir(configDir, config.imagesDir),
    messagesDir: resolveFromDir(configDir, config.messagesDir)
  };
  const payload = readJsonFile(inputPath);
  const edits = normalizeBrowserEditExport(payload, config);
  const imageEdits = normalizeBrowserImageEditExport(payload, config);

  applyEditsToMessages(edits, paths);
  applyImageEdits(imageEdits, paths);

  console.log(
    `Applied ${edits.length} text edits and ${imageEdits.length} image edits to ${paths.messagesDir}`
  );
};

export { applyBrowserEdits };
