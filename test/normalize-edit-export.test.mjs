import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeBrowserBlockEditExport,
  normalizeBrowserEditExport,
  normalizeBrowserImageEditExport
} from '../src/edits/normalize-edit-export.mjs';

const config = {
  collections: {
    'Team.members': {
      idField: 'id',
      maxItems: 20,
      minItems: 1,
      operations: ['duplicate', 'remove', 'reorder']
    }
  },
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

test('normalizeBrowserBlockEditExport accepts duplicate edits with localized overrides', () => {
  assert.deepEqual(
    normalizeBrowserBlockEditExport(
      {
        blockEdits: [
          {
            collection: 'Team.members',
            newId: 'ck_new',
            operation: 'duplicate',
            overrides: {
              en: {
                name: 'New name'
              }
            },
            sourceId: 'member-1'
          }
        ]
      },
      config
    ),
    [
      {
        afterId: 'member-1',
        collection: 'Team.members',
        newId: 'ck_new',
        operation: 'duplicate',
        overrides: {
          en: {
            name: 'New name'
          }
        },
        sourceId: 'member-1'
      }
    ]
  );
});

test('normalizeBrowserBlockEditExport rejects unconfigured collections', () => {
  assert.throws(
    () =>
      normalizeBrowserBlockEditExport(
        {
          blockEdits: [
            {
              collection: 'Projects.items',
              itemId: 'project-1',
              operation: 'remove'
            }
          ]
        },
        config
      ),
    /collection "Projects.items" is not configured/
  );
});

test('normalizeBrowserBlockEditExport accepts a collection reorder', () => {
  assert.deepEqual(
    normalizeBrowserBlockEditExport(
      {
        blockEdits: [
          {
            collection: 'Team.members',
            itemIds: ['member-2', 'member-1'],
            operation: 'reorder'
          }
        ]
      },
      config
    ),
    [
      {
        collection: 'Team.members',
        itemIds: ['member-2', 'member-1'],
        operation: 'reorder'
      }
    ]
  );
});

test('normalizeBrowserBlockEditExport rejects duplicate reorder IDs', () => {
  assert.throws(
    () =>
      normalizeBrowserBlockEditExport(
        {
          blockEdits: [
            {
              collection: 'Team.members',
              itemIds: ['member-1', 'member-1'],
              operation: 'reorder'
            }
          ]
        },
        config
      ),
    /cannot contain duplicate IDs/
  );
});

test('normalizeBrowserEditExport accepts block-only exports', () => {
  assert.deepEqual(
    normalizeBrowserEditExport(
      {
        blockEdits: [
          {
            collection: 'Team.members',
            itemId: 'member-1',
            operation: 'remove'
          }
        ]
      },
      config
    ),
    []
  );
});

test('normalizeBrowserEditExport rejects edits to configured stable IDs', () => {
  assert.throws(
    () =>
      normalizeBrowserEditExport(
        {
          edits: [
            {
              key: 'Team.members[0].id',
              locale: 'en',
              value: 'replacement-id'
            }
          ]
        },
        config
      ),
    /stable ID field/
  );
});
