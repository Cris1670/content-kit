import assert from 'node:assert/strict';
import test from 'node:test';

import { createContentKitMarkers } from '../src/browser/markers.mjs';

test('browser markers are omitted when editing is disabled', () => {
  const markers = createContentKitMarkers();

  assert.deepEqual(markers.edit('Hero.title'), {});
  assert.deepEqual(
    markers.block({
      collection: 'Services.items',
      itemId: 'signal',
      prefix: 'Services.items[0]'
    }),
    {}
  );
});

test('browser markers expose the generic Content Kit data contract', () => {
  const markers = createContentKitMarkers({
    enabled: true,
    selections: {
      'technology-icons': {
        options: [{ label: 'Settings', value: 'settings' }],
        scope: 'all'
      }
    }
  });

  assert.deepEqual(markers.edit('Hero.title'), {
    'data-ck-edit': 'Hero.title'
  });
  assert.deepEqual(markers.image('Hero.image'), {
    'data-ck-image': 'Hero.image'
  });
  assert.deepEqual(
    markers.select('Services.items[0].icon', 'settings', 'technology-icons'),
    {
      'data-ck-select': 'Services.items[0].icon',
      'data-ck-select-config': 'technology-icons',
      'data-ck-select-scope': 'all',
      'data-ck-select-value': 'settings'
    }
  );
  assert.deepEqual(
    markers.collection({ collection: 'Services.items', totalItems: 3 }),
    {
      'data-ck-collection': 'Services.items',
      'data-ck-collection-total': 3
    }
  );
});
