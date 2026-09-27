import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExport,
  countProjectEdits,
  mergeEditPayload
} from '../chrome-extension/popup/domain/edits.js';
import { compactStoredImageEdits } from '../chrome-extension/popup/services/storage.js';

const state = {
  contentConfig: {
    collections: {
      'Team.members': {
        idField: 'id',
        operations: ['duplicate', 'remove', 'reorder']
      }
    },
    locales: ['en', 'de']
  },
  origin: 'https://example.com'
};

test('block edits merge localized overrides and export as version 2', () => {
  const store = { projects: {}, version: 1 };
  const basePayload = {
    blockEdits: [
      {
        collection: 'Team.members',
        newId: 'ck_new',
        operation: 'duplicate',
        overrides: {
          en: {
            name: 'New teammate'
          }
        },
        sourceId: 'member-1'
      }
    ],
    locales: ['en']
  };

  mergeEditPayload({
    activeProjectId: state.origin,
    payload: basePayload,
    payloadOrigin: state.origin,
    state,
    store
  });
  mergeEditPayload({
    activeProjectId: state.origin,
    payload: {
      ...basePayload,
      blockEdits: [
        {
          ...basePayload.blockEdits[0],
          overrides: {
            de: {
              name: 'Neues Teammitglied'
            }
          }
        }
      ],
      locales: ['de']
    },
    payloadOrigin: state.origin,
    state,
    store
  });

  const project = store.projects[state.origin];
  const exported = buildExport(project);

  assert.equal(countProjectEdits(project), 1);
  assert.equal(exported.version, 2);
  assert.deepEqual(exported.locales, ['en', 'de']);
  assert.deepEqual(exported.blockEdits[0].overrides, {
    de: {
      name: 'Neues Teammitglied'
    },
    en: {
      name: 'New teammate'
    }
  });
});

test('a later reorder snapshot replaces the collection order', () => {
  const store = { projects: {}, version: 1 };

  [
    ['member-1', 'member-2'],
    ['member-2', 'member-1']
  ].forEach((itemIds) => {
    mergeEditPayload({
      activeProjectId: state.origin,
      payload: {
        blockEdits: [
          {
            collection: 'Team.members',
            itemIds,
            operation: 'reorder'
          }
        ]
      },
      payloadOrigin: state.origin,
      state,
      store
    });
  });

  const exported = buildExport(store.projects[state.origin]);

  assert.equal(countProjectEdits(store.projects[state.origin]), 1);
  assert.deepEqual(exported.blockEdits[0].itemIds, ['member-2', 'member-1']);
  assert.equal(exported.blockEdits[0].overrides, undefined);
});

test('image imports and exports keep a single image payload', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const store = { projects: {}, version: 1 };

  mergeEditPayload({
    activeProjectId: state.origin,
    payload: {
      imageEdits: [
        {
          dataUrl,
          fileName: 'hero.png',
          key: 'Hero.image',
          locale: 'en',
          previewUrl: dataUrl
        }
      ],
      locales: ['en']
    },
    payloadOrigin: state.origin,
    state,
    store
  });

  const storedEdit = store.projects[state.origin].imageEdits.en['Hero.image'];
  const exportedEdit = buildExport(store.projects[state.origin]).imageEdits[0];

  assert.equal(storedEdit.dataUrl, dataUrl);
  assert.equal(Object.hasOwn(storedEdit, 'previewUrl'), false);
  assert.equal(exportedEdit.dataUrl, dataUrl);
  assert.equal(Object.hasOwn(exportedEdit, 'previewUrl'), false);
});

test('legacy stored image previews are compacted before saving', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const store = {
    projects: {
      [state.origin]: {
        imageEdits: {
          en: {
            'Hero.image': {
              dataUrl,
              previewUrl: dataUrl
            }
          }
        }
      }
    },
    version: 1
  };

  compactStoredImageEdits(store);

  assert.equal(
    Object.hasOwn(
      store.projects[state.origin].imageEdits.en['Hero.image'],
      'previewUrl'
    ),
    false
  );
});
