import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

import {
  assertNoSparseArrays,
  getValueAtPath,
  parseMessagePath,
  setValueAtPath
} from './message-path.mjs';
import { fail } from '../utils/errors.mjs';
import { toUtf8Json } from '../utils/json.mjs';

const safeLocalePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u;
const maxCatalogBytes = 5 * 1024 * 1024;

const sha256 = (value) =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`;

const valueRevision = (value) => sha256(JSON.stringify(value ?? null));

const createCatalogStore = ({ locales, baseLocale, messagesDir }) => {
  locales.forEach((locale) => {
    if (!safeLocalePattern.test(locale)) {
      fail(`Locale "${locale}" is not a safe locale code.`);
    }
  });

  const assertLocale = (locale) => {
    if (typeof locale !== 'string' || !locales.includes(locale)) {
      fail(`Locale "${locale}" is not configured.`);
    }
  };

  const catalogPath = (locale) => {
    assertLocale(locale);
    return join(messagesDir, `${locale}.json`);
  };

  const readCatalog = (locale) => {
    const filePath = catalogPath(locale);

    if (!existsSync(filePath)) {
      return { catalog: {}, exists: false, fileRevision: sha256('') };
    }

    if (lstatSync(filePath).isSymbolicLink()) {
      fail(`Refusing to read ${locale}.json because it is a symbolic link.`);
    }

    const raw = readFileSync(filePath);

    if (raw.length > maxCatalogBytes) {
      fail(`${locale}.json is larger than ${maxCatalogBytes} bytes.`);
    }

    const catalog = JSON.parse(raw.toString('utf-8'));

    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
      fail(`${locale}.json must contain a JSON object.`);
    }

    return { catalog, exists: true, fileRevision: sha256(raw) };
  };

  const readItem = (key, locale, catalogs = new Map()) => {
    const pathParts = parseMessagePath(key, 'Content key');

    if (!catalogs.has(locale)) {
      catalogs.set(locale, readCatalog(locale));
    }

    const value = getValueAtPath(catalogs.get(locale).catalog, pathParts);

    return {
      locale,
      exists: value !== undefined,
      value: value ?? null,
      kind:
        value === undefined
          ? 'missing'
          : typeof value === 'string'
            ? 'text'
            : 'structure',
      revision: valueRevision(value)
    };
  };

  const writeCatalog = (locale, catalog) => {
    const filePath = catalogPath(locale);

    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
      fail(`Refusing to write ${locale}.json because it is a symbolic link.`);
    }

    assertNoSparseArrays(catalog);

    const tempPath = join(messagesDir, `.${locale}.json.${randomUUID()}.tmp`);

    try {
      writeFileSync(tempPath, toUtf8Json(catalog), {
        encoding: 'utf-8',
        flag: 'wx'
      });
      renameSync(tempPath, filePath);
    } catch (error) {
      rmSync(tempPath, { force: true });
      throw error;
    }
  };

  // Every change is checked against a fresh read before anything is written, so a
  // conflict in one locale leaves all catalogs untouched.
  const applyValues = (changes) => {
    const catalogs = new Map();
    const conflicts = [];

    changes.forEach((change) => {
      const current = readItem(change.key, change.locale, catalogs);

      if (current.revision !== change.expectedRevision) {
        conflicts.push({
          key: change.key,
          locale: change.locale,
          expectedRevision: change.expectedRevision,
          currentRevision: current.revision
        });
      }

      if (current.kind === 'structure') {
        fail(
          `"${change.key}" in ${change.locale} is a group, not a text value.`
        );
      }
    });

    if (conflicts.length > 0) {
      return { applied: false, conflicts };
    }

    changes.forEach((change) => {
      setValueAtPath(
        catalogs.get(change.locale).catalog,
        parseMessagePath(change.key, 'Content key'),
        change.value
      );
    });

    new Set(changes.map((change) => change.locale)).forEach((locale) =>
      writeCatalog(locale, catalogs.get(locale).catalog)
    );

    return { applied: true, conflicts: [] };
  };

  return {
    baseLocale,
    locales,
    applyValues,
    readCatalog,
    readItem
  };
};

export { createCatalogStore, valueRevision };
