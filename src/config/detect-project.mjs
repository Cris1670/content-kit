import { join } from 'node:path';

import { defaultConfig, preferredLocaleOrder } from './constants.mjs';
import { safeExists, safeReadDir } from '../utils/filesystem.mjs';

const sortLocales = (locales) =>
  Array.from(new Set(locales)).sort((left, right) => {
    const leftIndex = preferredLocaleOrder.indexOf(left);
    const rightIndex = preferredLocaleOrder.indexOf(right);

    if (leftIndex >= 0 || rightIndex >= 0) {
      return (
        (leftIndex >= 0 ? leftIndex : preferredLocaleOrder.length) -
        (rightIndex >= 0 ? rightIndex : preferredLocaleOrder.length)
      );
    }

    return left.localeCompare(right);
  });

const detectMessagesDir = (projectRoot, hints) => {
  const candidates = [
    'messages',
    'src/messages',
    'app/messages',
    'locales',
    'src/locales',
    'i18n/messages'
  ];

  const detected = candidates.find((candidate) =>
    safeExists(join(projectRoot, candidate))
  );

  if (detected) {
    hints.push(`Detected messagesDir: ${detected}`);
    return detected;
  }

  hints.push(
    'Could not detect a messages directory. Defaulted messagesDir to "messages".'
  );
  return defaultConfig.messagesDir;
};

const detectLocales = (projectRoot, messagesDir, hints) => {
  const messagesPath = join(projectRoot, messagesDir);
  const entries = safeExists(messagesPath)
    ? safeReadDir(messagesPath, hints)
    : [];
  const locales = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.replace(/\.json$/, ''))
    .filter((locale) => /^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(locale));

  if (locales.length > 0) {
    const sortedLocales = sortLocales(locales);
    hints.push(`Detected locales: ${sortedLocales.join(', ')}`);
    return sortedLocales;
  }

  hints.push(
    `Could not detect locale JSON files in ${messagesDir}. Defaulted locales to ${defaultConfig.locales.join(', ')}.`
  );
  return defaultConfig.locales;
};

const detectBaseLocale = (locales) => {
  if (locales.includes('en')) {
    return 'en';
  }

  return locales[0] ?? defaultConfig.baseLocale;
};

const detectProjectConfig = (projectRoot) => {
  const hints = [];
  const messagesDir = detectMessagesDir(projectRoot, hints);
  const locales = detectLocales(projectRoot, messagesDir, hints);

  return {
    config: {
      locales,
      baseLocale: detectBaseLocale(locales),
      collections: defaultConfig.collections,
      selections: defaultConfig.selections,
      imagePublicPath: defaultConfig.imagePublicPath,
      imagesDir: defaultConfig.imagesDir,
      localePathPattern: defaultConfig.localePathPattern,
      messagesDir
    },
    hints
  };
};

export { detectProjectConfig };
