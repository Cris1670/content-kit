import { readFileSync } from 'node:fs';

import { createCatalogTools } from './catalog-tools.mjs';
import { createMcpServer, serveStdio } from './stdio-server.mjs';
import { validateConfig } from '../edits/apply-edits.mjs';
import { parseMessagePath } from '../messages/message-path.mjs';
import { fail } from '../utils/errors.mjs';
import { resolveFromDir } from '../utils/filesystem.mjs';
import { loadContentRules } from '../validation/content-rules.mjs';

const maxKeyPrefixes = 200;

const instructions = `Content Kit serves the JSON message catalogs of one app.
- Read with loadContentItem and findContentItems; check wording with validateContent.
- To change copy: previewContentChange (dry run) -> show the exact before/after to the editor -> only after explicit approval, applyApprovedChange with the previewId -> verifyAppliedChange.
- Writes land in the working tree only. A developer reviews, commits and merges; never report a change as live.
- Never invent tool results. If a tool fails, tell the editor what was not done.`;

const readPackageVersion = () =>
  JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
  ).version;

const validateKeyList = (value, label) => {
  if (value == null) {
    return;
  }

  if (!Array.isArray(value) || value.length > maxKeyPrefixes) {
    fail(
      `Config field "${label}" must be an array of up to ${maxKeyPrefixes} keys.`
    );
  }

  value.forEach((key) => parseMessagePath(key, `Config field "${label}"`));
};

const validateMcpConfig = (config) => {
  const mcpConfig = config.mcp;

  if (mcpConfig == null) {
    return;
  }

  if (typeof mcpConfig !== 'object' || Array.isArray(mcpConfig)) {
    fail('Config field "mcp" must be an object.');
  }

  const known = new Set(['writableKeys', 'readOnlyKeys']);
  Object.keys(mcpConfig).forEach((name) => {
    if (!known.has(name)) {
      fail(`Unknown config field "mcp.${name}".`);
    }
  });

  validateKeyList(mcpConfig.writableKeys, 'mcp.writableKeys');
  validateKeyList(mcpConfig.readOnlyKeys, 'mcp.readOnlyKeys');

  if (
    config.rulesFile != null &&
    (typeof config.rulesFile !== 'string' || config.rulesFile.length === 0)
  ) {
    fail('Config field "rulesFile" must be a path string.');
  }
};

const runMcpServer = async (config, configDir) => {
  validateConfig(config);
  validateMcpConfig(config);

  const rules = loadContentRules(
    config.rulesFile ? resolveFromDir(configDir, config.rulesFile) : null
  );
  const tools = createCatalogTools({
    config,
    rules,
    paths: {
      configDir,
      messagesDir: resolveFromDir(configDir, config.messagesDir)
    }
  });
  const server = createMcpServer({
    serverInfo: { name: 'content-kit', version: readPackageVersion() },
    instructions,
    tools,
    log: (message) => process.stderr.write(`${message}\n`)
  });

  process.stderr.write(
    `Content Kit MCP serving ${config.locales.join(', ')} from ${config.messagesDir}\n`
  );

  await serveStdio({ server });
};

export { runMcpServer, validateMcpConfig };
