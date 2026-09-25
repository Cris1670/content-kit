import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { createCatalogTools } from '../src/mcp/catalog-tools.mjs';
import { validateMcpConfig } from '../src/mcp/run-mcp.mjs';
import { createMcpServer, serveStdio } from '../src/mcp/stdio-server.mjs';
import { normalizeContentRules } from '../src/validation/content-rules.mjs';

const rules = normalizeContentRules({
  version: 1,
  rules: [
    {
      id: 'en-ellipsis-character',
      type: 'forbiddenPattern',
      pattern: '\\.\\.\\.',
      locales: ['en'],
      severity: 'error',
      overridable: false,
      message: 'Use the ellipsis character.'
    },
    {
      id: 'campaign-term',
      type: 'forbiddenPattern',
      pattern: 'Deal',
      severity: 'error',
      overridable: true,
      message: 'Avoid sales language.'
    }
  ]
});

const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-kit-mcp-'));
  writeFileSync(
    join(dir, 'de.json'),
    `${JSON.stringify(
      {
        Profile: { greeting: 'Hallo {name}', title: 'Willkommen' },
        Auth: { signIn: 'Anmelden' }
      },
      null,
      2
    )}\n`
  );
  writeFileSync(
    join(dir, 'en.json'),
    `${JSON.stringify(
      {
        Profile: { greeting: 'Hello {name}', title: 'Welcome' },
        Auth: { signIn: 'Sign in' }
      },
      null,
      2
    )}\n`
  );

  const config = {
    locales: ['de', 'en', 'fr'],
    baseLocale: 'de',
    mcp: { writableKeys: ['Profile'], readOnlyKeys: ['Profile.locked'] }
  };
  const tools = createCatalogTools({
    config,
    rules,
    paths: { configDir: dir, messagesDir: dir }
  });
  const server = createMcpServer({
    serverInfo: { name: 'content-kit', version: 'test' },
    instructions: 'test',
    tools,
    log: () => {}
  });
  let nextId = 1;

  const rpc = async (method, params) =>
    JSON.parse(
      JSON.stringify(
        await server.handleMessage(
          JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
        )
      )
    );

  const call = async (name, args) => {
    const response = await rpc('tools/call', { name, arguments: args });
    return response.result.structuredContent;
  };

  const readCatalog = (locale) =>
    JSON.parse(readFileSync(join(dir, `${locale}.json`), 'utf-8'));

  return {
    dir,
    rpc,
    call,
    readCatalog,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
};

const initialize = (rpc) =>
  rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' }
  });

test('negotiates the protocol and refuses tool calls before initialize', async (t) => {
  const { rpc, cleanup } = setup();
  t.after(cleanup);

  const early = await rpc('tools/list');
  assert.equal(early.error.code, -32600);

  const init = await initialize(rpc);
  assert.equal(init.result.protocolVersion, '2025-06-18');

  const list = await rpc('tools/list');
  const names = list.result.tools.map((tool) => tool.name);
  assert.ok(names.includes('previewContentChange'));
  assert.ok(list.result.tools.every((tool) => !('handler' in tool)));

  const unknown = await rpc('resources/list');
  assert.equal(unknown.error.code, -32601);
});

test('answers malformed JSON with a parse error and ignores notifications', async (t) => {
  const { cleanup } = setup();
  t.after(cleanup);
  const server = createMcpServer({
    serverInfo: {},
    instructions: '',
    tools: [],
    log: () => {}
  });

  assert.equal((await server.handleMessage('{nope')).error.code, -32700);
  assert.equal(
    await server.handleMessage(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    ),
    null
  );
});

test('serves newline-delimited JSON-RPC over stdio', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createMcpServer({
    serverInfo: { name: 't' },
    instructions: '',
    tools: [],
    log: () => {}
  });
  const chunks = [];
  output.on('data', (chunk) => chunks.push(chunk));

  const done = serveStdio({ server, input, output });
  input.end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
  await done;

  assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), {
    jsonrpc: '2.0',
    id: 1,
    result: {}
  });
});

test('previews, applies and verifies an approved translation', async (t) => {
  const { rpc, call, readCatalog, cleanup } = setup();
  t.after(cleanup);
  await initialize(rpc);

  const item = await call('loadContentItem', { key: 'Profile.greeting' });
  const fr = item.values.find((value) => value.locale === 'fr');
  assert.equal(item.writable, true);
  assert.equal(fr.exists, false);

  const preview = await call('previewContentChange', {
    changes: [
      {
        key: 'Profile.greeting',
        locale: 'fr',
        value: 'Bonjour {name}',
        expectedRevision: fr.revision
      }
    ]
  });
  assert.equal(preview.applicable, true);
  assert.equal(preview.changes[0].before, null);
  assert.equal(readCatalog('de').Profile.greeting, 'Hallo {name}');

  const applied = await call('applyApprovedChange', {
    previewId: preview.previewId,
    idempotencyKey: 'apply-greeting-fr'
  });
  assert.equal(applied.applied, true);
  assert.equal(readCatalog('fr').Profile.greeting, 'Bonjour {name}');

  const replay = await call('applyApprovedChange', {
    previewId: preview.previewId,
    idempotencyKey: 'apply-greeting-fr'
  });
  assert.equal(replay.replayed, true);

  const verified = await call('verifyAppliedChange', {
    previewId: preview.previewId
  });
  assert.equal(verified.verified, true);
});

test('refuses to apply when the content changed after the preview', async (t) => {
  const { rpc, call, dir, readCatalog, cleanup } = setup();
  t.after(cleanup);
  await initialize(rpc);

  const item = await call('loadContentItem', {
    key: 'Profile.title',
    locales: ['en']
  });
  const preview = await call('previewContentChange', {
    changes: [
      {
        key: 'Profile.title',
        locale: 'en',
        value: 'Hi there',
        expectedRevision: item.values[0].revision
      }
    ]
  });

  const catalog = readCatalog('en');
  catalog.Profile.title = 'Welcome back';
  writeFileSync(join(dir, 'en.json'), JSON.stringify(catalog));

  const result = await call('applyApprovedChange', {
    previewId: preview.previewId,
    idempotencyKey: 'apply-title-en'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'REVISION_CONFLICT');
  assert.equal(readCatalog('en').Profile.title, 'Welcome back');
});

test('blocks keys outside the writable list and read-only keys', async (t) => {
  const { rpc, call, cleanup } = setup();
  t.after(cleanup);
  await initialize(rpc);

  const item = await call('loadContentItem', {
    key: 'Auth.signIn',
    locales: ['en']
  });
  const preview = await call('previewContentChange', {
    changes: [
      {
        key: 'Auth.signIn',
        locale: 'en',
        value: 'Log in',
        expectedRevision: item.values[0].revision
      }
    ]
  });

  assert.equal(preview.applicable, false);
  assert.equal(preview.previewId, null);
  assert.match(preview.changes[0].blockers[0], /not in the list/);
});

test('blocks hard rule violations and requires exceptions for overridable ones', async (t) => {
  const { rpc, call, readCatalog, cleanup } = setup();
  t.after(cleanup);
  await initialize(rpc);

  const de = await call('loadContentItem', {
    key: 'Profile.title',
    locales: ['de', 'en']
  });
  const [, enTitle] = de.values;

  const hard = await call('previewContentChange', {
    changes: [
      {
        key: 'Profile.title',
        locale: 'en',
        value: 'Welcome...',
        expectedRevision: enTitle.revision
      }
    ]
  });
  assert.equal(hard.applicable, false);

  const placeholder = await call('previewContentChange', {
    changes: [
      {
        key: 'Profile.greeting',
        locale: 'en',
        value: 'Hello there',
        expectedRevision: (
          await call('loadContentItem', {
            key: 'Profile.greeting',
            locales: ['en']
          })
        ).values[0].revision
      }
    ]
  });
  assert.equal(placeholder.applicable, false);

  const governed = await call('previewContentChange', {
    changes: [
      {
        key: 'Profile.title',
        locale: 'en',
        value: 'Deal of the day',
        expectedRevision: enTitle.revision
      }
    ]
  });
  assert.equal(governed.applicable, true);
  assert.deepEqual(
    governed.exceptionsRequired.map((item) => item.ruleId),
    ['campaign-term']
  );

  const refused = await call('applyApprovedChange', {
    previewId: governed.previewId,
    idempotencyKey: 'apply-deal-1'
  });
  assert.equal(refused.error.code, 'EXCEPTION_REQUIRED');
  assert.equal(readCatalog('en').Profile.title, 'Welcome');

  const accepted = await call('applyApprovedChange', {
    previewId: governed.previewId,
    idempotencyKey: 'apply-deal-2',
    exceptions: [{ ruleId: 'campaign-term', reference: 'EXC-2026-001' }]
  });
  assert.equal(accepted.applied, true);
  assert.equal(readCatalog('en').Profile.title, 'Deal of the day');
});

test('rejects unconfigured locales, prototype keys and unknown arguments', async (t) => {
  const { rpc, call, cleanup } = setup();
  t.after(cleanup);
  await initialize(rpc);

  const traversal = await call('loadContentItem', {
    key: 'Profile.title',
    locales: ['../../etc/passwd']
  });
  assert.equal(traversal.error.code, 'INVALID_INPUT');

  const unconfigured = await call('loadContentItem', {
    key: 'Profile.title',
    locales: ['it']
  });
  assert.equal(unconfigured.error.code, 'TOOL_FAILED');

  const pollution = await call('loadContentItem', {
    key: '__proto__.polluted'
  });
  assert.match(pollution.error.message, /forbidden path segment/);

  const extra = await call('loadContentItem', {
    key: 'Profile.title',
    path: '/etc'
  });
  assert.equal(extra.error.code, 'INVALID_INPUT');
});

test('reports drift for missing and identical translations', async (t) => {
  const { rpc, call, cleanup } = setup();
  t.after(cleanup);
  await initialize(rpc);

  const drift = await call('findContentDrift', {});
  assert.equal(drift.counts.missing, 3);
  assert.ok(
    drift.issues.some(
      (issue) => issue.type === 'missing' && issue.locale === 'fr'
    )
  );
});

test('validates the mcp config block', () => {
  assert.throws(
    () => validateMcpConfig({ mcp: { writable: [] } }),
    /Unknown config field/
  );
  assert.throws(
    () => validateMcpConfig({ mcp: { writableKeys: ['a..b'] } }),
    /invalid path segment/
  );
  assert.doesNotThrow(() =>
    validateMcpConfig({ mcp: { writableKeys: ['Profile'] } })
  );
});
