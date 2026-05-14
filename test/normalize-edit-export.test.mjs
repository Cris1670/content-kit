import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBrowserEditExport,
  normalizeBrowserImageEditExport
} from '../src/edits/normalize-edit-export.mjs';

const config = {
  locales: ['en', 'de']
};

test('normalizeBrowserEditExport accepts flat edit exports', () => {
  assert.deepEqual(
    normalizeBrowserEditExport(
      {
        edits: [
          {
            key: 'hero.title',
            locale: 'en',
            value: 'Hello'
          }
        ]
      },
      config
    ),
    [
      {
        key: 'hero.title',
        locale: 'en',
        value: 'Hello'
      }
    ]
  );
});

test('normalizeBrowserEditExport flattens message objects', () => {
  assert.deepEqual(
    normalizeBrowserEditExport(
      {
        messages: {
          en: {
            cards: [
              {
                title: 'First'
              }
            ]
          }
        }
      },
      config
    ),
    [
      {
        key: 'cards[0].title',
        locale: 'en',
        value: 'First'
      }
    ]
  );
});

test('normalizeBrowserEditExport rejects unsupported locales', () => {
  assert.throws(
    () =>
      normalizeBrowserEditExport(
        {
          edits: [
            {
              key: 'hero.title',
              locale: 'fr',
              value: 'Bonjour'
            }
          ]
        },
        config
      ),
    /locale "fr" is not configured/
  );
});

test('normalizeBrowserImageEditExport accepts image edits', () => {
  assert.deepEqual(
    normalizeBrowserImageEditExport(
      {
        imageEdits: [
          {
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            fileName: 'hero.png',
            key: 'hero.image',
            locale: 'de'
          }
        ]
      },
      config
    ),
    [
      {
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        fileName: 'hero.png',
        key: 'hero.image',
        locale: 'de',
        mimeType: 'application/octet-stream'
      }
    ]
  );
});

test('normalizeBrowserImageEditExport rejects unsafe image keys', () => {
  assert.throws(
    () =>
      normalizeBrowserImageEditExport(
        {
          imageEdits: [
            {
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              fileName: 'hero.png',
              key: 'constructor.image',
              locale: 'en'
            }
          ]
        },
        config
      ),
    /forbidden path segment/
  );
});
