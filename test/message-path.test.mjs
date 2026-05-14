import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNoSparseArrays,
  parseMessagePath,
  setValueAtPath
} from '../src/messages/message-path.mjs';

test('parseMessagePath supports nested keys and array indexes', () => {
  assert.deepEqual(parseMessagePath('cards[0].title', 'Edit'), [
    'cards',
    0,
    'title'
  ]);
});

test('parseMessagePath rejects prototype pollution keys', () => {
  assert.throws(
    () => parseMessagePath('__proto__.polluted', 'Edit'),
    /forbidden path segment/
  );
});

test('parseMessagePath rejects very large array indexes', () => {
  assert.throws(
    () => parseMessagePath('cards[5001].title', 'Edit'),
    /array index is too large/
  );
});

test('setValueAtPath creates nested objects and arrays', () => {
  const catalog = {};

  setValueAtPath(catalog, ['cards', 0, 'title'], 'Hello');

  assert.deepEqual(catalog, {
    cards: [
      {
        title: 'Hello'
      }
    ]
  });
});

test('assertNoSparseArrays rejects sparse arrays', () => {
  const catalog = {
    cards: []
  };

  catalog.cards[1] = {
    title: 'Gap'
  };

  assert.throws(() => assertNoSparseArrays(catalog), /Sparse array detected/);
});
