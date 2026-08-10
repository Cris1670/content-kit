import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getExtensionFlags,
  saveExperimentalOrderingEnabled
} from '../chrome-extension/popup/services/storage.js';
import { experimentalFeaturesStorageKey } from '../chrome-extension/popup/shared/constants.js';

test('experimental ordering defaults off and preserves other feature flags', async () => {
  const values = {};

  globalThis.chrome = {
    storage: {
      local: {
        get: async (defaults) => ({ ...defaults, ...values }),
        set: async (updates) => {
          Object.assign(values, updates);
        }
      }
    }
  };

  try {
    assert.deepEqual(await getExtensionFlags(), {
      contentKitEditMode: false,
      contentKitEnabled: false,
      experimentalFeatures: {
        ordering: false
      }
    });

    values[experimentalFeaturesStorageKey] = {
      futureFeature: true,
      ordering: false
    };
    await saveExperimentalOrderingEnabled(true);

    assert.deepEqual(values[experimentalFeaturesStorageKey], {
      futureFeature: true,
      ordering: true
    });
    assert.equal(
      (await getExtensionFlags()).experimentalFeatures.ordering,
      true
    );
  } finally {
    delete globalThis.chrome;
  }
});
