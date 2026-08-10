const configFileName = 'content-kit.config.json';

const defaultConfig = {
  locales: ['en', 'de', 'fr', 'it'],
  baseLocale: 'en',
  collections: {},
  selections: {},
  imagePublicPath: '/content-kit-images',
  imagesDir: 'public/content-kit-images',
  localePathPattern: '^/(?<locale>[A-Za-z]{2}(?:-[A-Za-z]{2})?)(?<rest>/.*)?$',
  messagesDir: 'messages'
};

const preferredLocaleOrder = ['en', 'de', 'fr', 'it'];

export { configFileName, defaultConfig, preferredLocaleOrder };
