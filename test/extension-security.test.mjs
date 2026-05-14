import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProjectIdFromUrl,
  getSafeEditUrl,
  isSupportedLocale
} from '../chrome-extension/popup/shared/security.js';

test('isSupportedLocale accepts short locales and regional variants', () => {
  assert.equal(isSupportedLocale('en'), true);
  assert.equal(isSupportedLocale('de-CH'), true);
});

test('isSupportedLocale rejects malformed locales', () => {
  assert.equal(isSupportedLocale('english'), false);
  assert.equal(isSupportedLocale('../de'), false);
});

test('getProjectIdFromUrl returns only http origins', () => {
  assert.equal(
    getProjectIdFromUrl('https://example.com/de/about'),
    'https://example.com'
  );
  assert.equal(getProjectIdFromUrl('chrome://extensions'), null);
});

test('getSafeEditUrl keeps same-origin http urls', () => {
  assert.equal(
    getSafeEditUrl('https://example.com/de/about#team', 'https://example.com'),
    'https://example.com/de/about#team'
  );
});

test('getSafeEditUrl rejects cross-origin urls', () => {
  assert.equal(
    getSafeEditUrl('https://other.example/de/about', 'https://example.com'),
    ''
  );
});

test('getSafeEditUrl rejects javascript urls', () => {
  assert.equal(
    getSafeEditUrl('javascript:alert(1)', 'https://example.com'),
    ''
  );
});
