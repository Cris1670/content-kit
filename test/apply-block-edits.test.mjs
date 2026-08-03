import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyBlockEdits } from '../src/edits/apply-block-edits.mjs';

const config = {
  collections: {
    'Team.members': {
      idField: 'id',
      maxItems: 10,
      minItems: 1,
      operations: ['duplicate', 'remove', 'reorder']
    }
  },
  locales: ['en', 'de']
};

const writeCatalog = (directory, locale, name) => {
  writeFileSync(
    join(directory, `${locale}.json`),
    `${JSON.stringify(
      {
        Team: {
          members: [
            {
              id: 'member-1',
              name
            },
            {
              id: 'member-2',
              name: `${name} Two`
            }
          ]
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );
};

const readCatalog = (directory, locale) =>
  JSON.parse(readFileSync(join(directory, `${locale}.json`), 'utf8'));

test('applyBlockEdits duplicates localized items and remains idempotent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'content-kit-blocks-'));

  t.after(() => rmSync(directory, { recursive: true }));
  writeCatalog(directory, 'en', 'English');
  writeCatalog(directory, 'de', 'Deutsch');

  const edits = [
    {
      afterId: 'member-1',
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
  ];

  applyBlockEdits(edits, config, { messagesDir: directory });
  applyBlockEdits(edits, config, { messagesDir: directory });

  const englishMembers = readCatalog(directory, 'en').Team.members;
  const germanMembers = readCatalog(directory, 'de').Team.members;

  assert.deepEqual(
    englishMembers.map((member) => member.id),
    ['member-1', 'ck_new', 'member-2']
  );
  assert.equal(englishMembers[1].name, 'New teammate');
  assert.equal(germanMembers[1].name, 'Deutsch');
});

test('applyBlockEdits removes the same stable ID from every locale', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'content-kit-blocks-'));

  t.after(() => rmSync(directory, { recursive: true }));
  writeCatalog(directory, 'en', 'English');
  writeCatalog(directory, 'de', 'Deutsch');

  applyBlockEdits(
    [
      {
        collection: 'Team.members',
        itemId: 'member-2',
        operation: 'remove'
      }
    ],
    config,
    { messagesDir: directory }
  );

  assert.deepEqual(
    readCatalog(directory, 'en').Team.members.map((member) => member.id),
    ['member-1']
  );
  assert.deepEqual(
    readCatalog(directory, 'de').Team.members.map((member) => member.id),
    ['member-1']
  );
});

test('applyBlockEdits reorders every locale and remains idempotent', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'content-kit-blocks-'));

  t.after(() => rmSync(directory, { recursive: true }));
  writeCatalog(directory, 'en', 'English');
  writeCatalog(directory, 'de', 'Deutsch');

  const edits = [
    {
      collection: 'Team.members',
      itemIds: ['member-2', 'member-1'],
      operation: 'reorder'
    }
  ];

  applyBlockEdits(edits, config, { messagesDir: directory });
  applyBlockEdits(edits, config, { messagesDir: directory });

  assert.deepEqual(
    readCatalog(directory, 'en').Team.members.map((member) => member.id),
    ['member-2', 'member-1']
  );
  assert.deepEqual(
    readCatalog(directory, 'de').Team.members.map((member) => member.id),
    ['member-2', 'member-1']
  );
});

test('applyBlockEdits applies reorder after duplicate and remove edits', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'content-kit-blocks-'));

  t.after(() => rmSync(directory, { recursive: true }));
  writeCatalog(directory, 'en', 'English');
  writeCatalog(directory, 'de', 'Deutsch');

  applyBlockEdits(
    [
      {
        collection: 'Team.members',
        itemIds: ['ck_new', 'member-1'],
        operation: 'reorder'
      },
      {
        afterId: 'member-1',
        collection: 'Team.members',
        newId: 'ck_new',
        operation: 'duplicate',
        overrides: {},
        sourceId: 'member-1'
      },
      {
        collection: 'Team.members',
        itemId: 'member-2',
        operation: 'remove'
      }
    ],
    config,
    { messagesDir: directory }
  );

  assert.deepEqual(
    readCatalog(directory, 'en').Team.members.map((member) => member.id),
    ['ck_new', 'member-1']
  );
});

test('applyBlockEdits rejects a reorder that omits final collection IDs', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'content-kit-blocks-'));

  t.after(() => rmSync(directory, { recursive: true }));
  writeCatalog(directory, 'en', 'English');
  writeCatalog(directory, 'de', 'Deutsch');

  assert.throws(
    () =>
      applyBlockEdits(
        [
          {
            collection: 'Team.members',
            itemIds: ['member-1'],
            operation: 'reorder'
          }
        ],
        config,
        { messagesDir: directory }
      ),
    /must exactly match the final collection IDs/
  );
});

test('applyBlockEdits rejects removals below the configured minimum', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'content-kit-blocks-'));

  t.after(() => rmSync(directory, { recursive: true }));
  writeCatalog(directory, 'en', 'English');
  writeCatalog(directory, 'de', 'Deutsch');

  assert.throws(
    () =>
      applyBlockEdits(
        [
          {
            collection: 'Team.members',
            itemId: 'member-1',
            operation: 'remove'
          },
          {
            collection: 'Team.members',
            itemId: 'member-2',
            operation: 'remove'
          }
        ],
        config,
        { messagesDir: directory }
      ),
    /between 1 and 10 items/
  );

  assert.equal(readCatalog(directory, 'en').Team.members.length, 2);
  assert.equal(readCatalog(directory, 'de').Team.members.length, 2);
});

test('applyBlockEdits can replace an item while the collection is at its maximum', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'content-kit-blocks-'));
  const limitedConfig = {
    ...config,
    collections: {
      'Team.members': {
        ...config.collections['Team.members'],
        maxItems: 2
      }
    }
  };

  t.after(() => rmSync(directory, { recursive: true }));
  writeCatalog(directory, 'en', 'English');
  writeCatalog(directory, 'de', 'Deutsch');

  applyBlockEdits(
    [
      {
        collection: 'Team.members',
        itemId: 'member-2',
        operation: 'remove'
      },
      {
        afterId: 'member-1',
        collection: 'Team.members',
        newId: 'ck_new',
        operation: 'duplicate',
        overrides: {},
        sourceId: 'member-1'
      }
    ],
    limitedConfig,
    { messagesDir: directory }
  );

  assert.deepEqual(
    readCatalog(directory, 'en').Team.members.map((member) => member.id),
    ['member-1', 'ck_new']
  );
});
