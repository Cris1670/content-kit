import { randomUUID } from 'node:crypto';
import { relative } from 'node:path';

import { ToolFailure } from './stdio-server.mjs';
import { createCatalogStore } from '../messages/catalog-store.mjs';
import {
  listStringMessages,
  parseMessagePath
} from '../messages/message-path.mjs';
import { describeContentRules } from '../validation/content-rules.mjs';
import { validateContentValue } from '../validation/validate-content.mjs';

const surfaceId = 'repository-catalog';
const previewTtlMs = 30 * 60 * 1000;
const maxStoredPreviews = 200;
const maxChangesPerPreview = 50;
const maxValueLength = 5000;
const keySchema = { type: 'string', minLength: 1, maxLength: 512 };
const localeSchema = {
  type: 'string',
  pattern: '^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$',
  maxLength: 35
};
const revisionSchema = {
  type: 'string',
  pattern: '^sha256:[0-9a-f]{64}$',
  maxLength: 71
};
const idSchema = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{8,128}$',
  maxLength: 128
};

const builtInChecks = [
  { id: 'non-empty', severity: 'error', overridable: false },
  { id: 'icu-syntax', severity: 'error', overridable: false },
  { id: 'placeholders', severity: 'error', overridable: false },
  { id: 'markup', severity: 'error', overridable: false },
  { id: 'unsafe-characters', severity: 'error', overridable: false },
  { id: 'max-length', severity: 'error', overridable: false },
  { id: 'unchanged-from-source', severity: 'warning', overridable: false }
];

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const startsWithParts = (keyParts, prefixParts) =>
  prefixParts.every((part, index) => keyParts[index] === part);

const createKeyPolicy = (mcpConfig) => {
  const toParts = (keys) =>
    (keys ?? []).map((key) => parseMessagePath(key, 'mcp key prefix'));
  const writable = toParts(mcpConfig.writableKeys);
  const readOnlyKeys = toParts(mcpConfig.readOnlyKeys);

  return (key) => {
    const parts = parseMessagePath(key, 'Content key');

    if (readOnlyKeys.some((prefix) => startsWithParts(parts, prefix))) {
      return { writable: false, reason: 'This key is marked read-only.' };
    }

    if (writable.some((prefix) => startsWithParts(parts, prefix))) {
      return { writable: true, reason: null };
    }

    return {
      writable: false,
      reason: 'This key is not in the list of keys editors may change.'
    };
  };
};

const createCatalogTools = ({
  config,
  paths,
  rules,
  now = () => Date.now()
}) => {
  const store = createCatalogStore({
    locales: config.locales,
    baseLocale: config.baseLocale,
    messagesDir: paths.messagesDir
  });
  const mcpConfig = config.mcp ?? {};
  const keyPolicy = createKeyPolicy(mcpConfig);
  const previews = new Map();
  const appliedByIdempotencyKey = new Map();
  const displayDir = relative(paths.configDir, paths.messagesDir) || '.';

  const catalogFile = (locale) => `${displayDir}/${locale}.json`;

  const sourceFor = (key, locale, catalogs) => {
    const base = store.readItem(key, store.baseLocale, catalogs);
    return {
      sourceLocale: store.baseLocale,
      sourceValue: base.kind === 'text' ? base.value : null,
      sameLocale: locale === store.baseLocale
    };
  };

  const validate = ({
    key,
    locale,
    value,
    maxLength,
    catalogs = new Map()
  }) => {
    const { sourceLocale, sourceValue } = sourceFor(key, locale, catalogs);

    return validateContentValue({
      value,
      locale,
      sourceValue,
      sourceLocale,
      format: 'icu',
      maxLength: maxLength ?? null,
      rules
    });
  };

  const prunePreviews = () => {
    const cutoff = now() - previewTtlMs;

    previews.forEach((preview, id) => {
      if (preview.createdAt < cutoff) {
        previews.delete(id);
      }
    });

    while (previews.size >= maxStoredPreviews) {
      previews.delete(previews.keys().next().value);
    }
  };

  const describeItem = (item) => ({
    ...item,
    value:
      item.kind === 'structure'
        ? '(group of messages, not editable as text)'
        : item.value,
    file: catalogFile(item.locale)
  });

  return [
    {
      name: 'discoverContentSurfaces',
      title: 'Discover content surfaces',
      description:
        'List the message catalogs this server owns, their locales, which keys editors may change, and which capabilities are available. Call this first.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      },
      annotations: readOnly,
      handler: () => ({
        surfaces: [
          {
            id: surfaceId,
            system: 'repository',
            description:
              'UI copy in JSON message catalogs of a code repository. Changes land in the working tree only; a developer reviews the diff, commits and merges. Nothing is deployed by this server.',
            messagesDir: displayDir,
            locales: store.locales,
            baseLocale: store.baseLocale,
            writableKeys: mcpConfig.writableKeys ?? [],
            readOnlyKeys: mcpConfig.readOnlyKeys ?? [],
            capabilities: {
              read: true,
              validate: true,
              previewChange: (mcpConfig.writableKeys ?? []).length > 0,
              applyChange: (mcpConfig.writableKeys ?? []).length > 0,
              saveDraft: false,
              publish: false,
              requestReview: false,
              recordException: false
            }
          }
        ]
      })
    },
    {
      name: 'resolveContentAuthority',
      title: 'Resolve content authority',
      description:
        'Tell whether a message key is owned by these catalogs, which file holds it per locale, and whether editors may change it.',
      inputSchema: {
        type: 'object',
        properties: { key: keySchema },
        required: ['key'],
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ key }) => {
        const catalogs = new Map();
        const base = store.readItem(key, store.baseLocale, catalogs);
        const policy = keyPolicy(key);

        return {
          key,
          surface: surfaceId,
          owned: base.exists,
          authority: base.exists
            ? `${catalogFile(store.baseLocale)} is the source; other locales translate it.`
            : 'The key does not exist in the source catalog. New keys are added by developers.',
          files: Object.fromEntries(
            store.locales.map((locale) => [locale, catalogFile(locale)])
          ),
          writable: base.exists && policy.writable,
          reason: base.exists ? policy.reason : 'Unknown key.'
        };
      }
    },
    {
      name: 'findContentItems',
      title: 'Find content items',
      description:
        'Search message keys and texts (case-insensitive) to find which key holds a piece of copy.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2, maxLength: 200 },
          locale: localeSchema,
          limit: { type: 'integer', minimum: 1, maximum: 50 }
        },
        required: ['query'],
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ query, locale, limit = 20 }) => {
        const locales = locale ? [locale] : store.locales;
        const needle = query.toLocaleLowerCase();
        const matches = [];

        for (const current of locales) {
          const { catalog } = store.readCatalog(current);

          for (const message of listStringMessages(catalog)) {
            if (
              message.key.toLocaleLowerCase().includes(needle) ||
              message.value.toLocaleLowerCase().includes(needle)
            ) {
              matches.push({ locale: current, ...message });

              if (matches.length >= limit) {
                return { matches, truncated: true };
              }
            }
          }
        }

        return { matches, truncated: false };
      }
    },
    {
      name: 'loadContentItem',
      title: 'Load content item',
      description:
        'Load one message key in every locale (or the ones given) with its current revision. Use the revision as expectedRevision when previewing a change.',
      inputSchema: {
        type: 'object',
        properties: {
          key: keySchema,
          locales: { type: 'array', items: localeSchema, maxItems: 20 }
        },
        required: ['key'],
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ key, locales }) => {
        const catalogs = new Map();
        const policy = keyPolicy(key);

        return {
          key,
          surface: surfaceId,
          sourceLocale: store.baseLocale,
          writable: policy.writable,
          reason: policy.reason,
          values: (locales ?? store.locales).map((locale) =>
            describeItem(store.readItem(key, locale, catalogs))
          )
        };
      }
    },
    {
      name: 'getApplicableRules',
      title: 'Get applicable rules',
      description:
        'Return the machine-checked content rules for a locale. Rules marked overridable:false can never be excepted.',
      inputSchema: {
        type: 'object',
        properties: { locale: localeSchema },
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ locale }) => ({
        builtInChecks,
        rules: describeContentRules(rules).filter(
          (rule) =>
            locale == null ||
            rule.locales == null ||
            rule.locales.includes(locale)
        )
      })
    },
    {
      name: 'getContentLifecycle',
      title: 'Get content lifecycle',
      description:
        'Explain the lifecycle of repository copy and which steps this server can perform.',
      inputSchema: {
        type: 'object',
        properties: { key: keySchema },
        additionalProperties: false
      },
      annotations: readOnly,
      handler: () => ({
        surface: surfaceId,
        states: [
          {
            id: 'working-tree',
            performedBy: 'this server (after preview and approval)'
          },
          { id: 'committed', performedBy: 'developer' },
          { id: 'merged', performedBy: 'merge request review' },
          { id: 'deployed', performedBy: 'CI/CD after merge' }
        ],
        note: 'A change applied here is not live. Never report it as published or deployed.'
      })
    },
    {
      name: 'validateContent',
      title: 'Validate content',
      description:
        'Check a proposed value for a key and locale: placeholders and ICU syntax against the source, markup, invisible characters, length and content rules. Does not write anything.',
      inputSchema: {
        type: 'object',
        properties: {
          key: keySchema,
          locale: localeSchema,
          value: { type: 'string', maxLength: maxValueLength },
          maxLength: { type: 'integer', minimum: 1, maximum: maxValueLength }
        },
        required: ['key', 'locale', 'value'],
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ key, locale, value, maxLength }) => ({
        key,
        locale,
        ...validate({ key, locale, value, maxLength })
      })
    },
    {
      name: 'previewContentChange',
      title: 'Preview content change',
      description:
        'Dry run: check up to 50 changes against their expected revisions and the rules, and return the exact before/after preview plus a previewId. Show the preview to the editor and get explicit approval before calling applyApprovedChange. Nothing is written.',
      inputSchema: {
        type: 'object',
        properties: {
          changes: {
            type: 'array',
            minItems: 1,
            maxItems: maxChangesPerPreview,
            items: {
              type: 'object',
              properties: {
                key: keySchema,
                locale: localeSchema,
                value: { type: 'string', maxLength: maxValueLength },
                expectedRevision: revisionSchema,
                maxLength: {
                  type: 'integer',
                  minimum: 1,
                  maximum: maxValueLength
                }
              },
              required: ['key', 'locale', 'value', 'expectedRevision'],
              additionalProperties: false
            }
          }
        },
        required: ['changes'],
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ changes }) => {
        const seen = new Set();
        const catalogs = new Map();

        const items = changes.map((change) => {
          const identity = `${change.locale}\u0000${change.key}`;

          if (seen.has(identity)) {
            throw new ToolFailure(
              'DUPLICATE_CHANGE',
              `"${change.key}" in ${change.locale} appears twice.`
            );
          }

          seen.add(identity);

          const policy = keyPolicy(change.key);
          const current = store.readItem(change.key, change.locale, catalogs);
          const base = store.readItem(change.key, store.baseLocale, catalogs);
          const validation = validate({ ...change, catalogs });
          const blockers = [];

          if (!policy.writable) {
            blockers.push(policy.reason);
          }

          if (!base.exists || base.kind !== 'text') {
            blockers.push(
              'The key is not a text message in the source catalog.'
            );
          }

          if (current.kind === 'structure') {
            blockers.push('The target is a group of messages, not a text.');
          }

          if (current.revision !== change.expectedRevision) {
            blockers.push(
              'The content changed since it was loaded. Reload it and review the new text.'
            );
          }

          if (current.value === change.value) {
            blockers.push('The new value is identical to the current value.');
          }

          validation.findings
            .filter((item) => item.severity === 'error' && !item.overridable)
            .forEach((item) => blockers.push(item.message));

          return {
            key: change.key,
            locale: change.locale,
            file: catalogFile(change.locale),
            before: current.exists ? current.value : null,
            after: change.value,
            expectedRevision: change.expectedRevision,
            currentRevision: current.revision,
            validation,
            blockers,
            exceptionsRequired: validation.findings
              .filter((item) => item.severity === 'error' && item.overridable)
              .map((item) => ({ ruleId: item.ruleId, message: item.message }))
          };
        });

        const blocked = items.some((item) => item.blockers.length > 0);
        const exceptionsRequired = [
          ...new Map(
            items
              .flatMap((item) => item.exceptionsRequired)
              .map((item) => [item.ruleId, item])
          ).values()
        ];

        if (blocked) {
          return {
            previewId: null,
            applicable: false,
            changes: items,
            exceptionsRequired
          };
        }

        prunePreviews();
        const previewId = randomUUID();
        const createdAt = now();
        previews.set(previewId, {
          createdAt,
          items,
          exceptionsRequired,
          appliedResult: null
        });

        return {
          previewId,
          applicable: true,
          expiresAt: new Date(createdAt + previewTtlMs).toISOString(),
          changes: items,
          exceptionsRequired
        };
      }
    },
    {
      name: 'applyApprovedChange',
      title: 'Apply approved change',
      description:
        'Write exactly the changes of an approved preview to the catalogs in the working tree. Only call this after the editor explicitly approved that preview. Overridable rule violations need an exception reference per rule. Fails without writing if any content changed since the preview.',
      inputSchema: {
        type: 'object',
        properties: {
          previewId: {
            type: 'string',
            pattern: '^[0-9a-f-]{36}$',
            maxLength: 36
          },
          idempotencyKey: idSchema,
          exceptions: {
            type: 'array',
            maxItems: 20,
            items: {
              type: 'object',
              properties: {
                ruleId: { type: 'string', maxLength: 64 },
                reference: { type: 'string', minLength: 1, maxLength: 200 }
              },
              required: ['ruleId', 'reference'],
              additionalProperties: false
            }
          }
        },
        required: ['previewId', 'idempotencyKey'],
        additionalProperties: false
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      handler: ({ previewId, idempotencyKey, exceptions = [] }) => {
        const previous = appliedByIdempotencyKey.get(idempotencyKey);

        if (previous) {
          if (previous.previewId !== previewId) {
            throw new ToolFailure(
              'IDEMPOTENCY_KEY_REUSED',
              'This idempotency key was already used for a different preview.'
            );
          }

          return { ...previous.result, replayed: true };
        }

        prunePreviews();
        const preview = previews.get(previewId);

        if (!preview) {
          throw new ToolFailure(
            'PREVIEW_NOT_FOUND',
            'The preview is unknown or expired. Create a new preview and ask for approval again.'
          );
        }

        if (preview.appliedResult) {
          throw new ToolFailure(
            'PREVIEW_ALREADY_APPLIED',
            'This preview was already applied with another idempotency key.'
          );
        }

        const references = new Map(
          exceptions.map((exception) => [exception.ruleId, exception.reference])
        );
        const missing = preview.exceptionsRequired.filter(
          (item) => !references.has(item.ruleId)
        );

        if (missing.length > 0) {
          throw new ToolFailure(
            'EXCEPTION_REQUIRED',
            'These rules need a recorded exception before the change can be applied.',
            { rules: missing }
          );
        }

        const outcome = store.applyValues(
          preview.items.map((item) => ({
            key: item.key,
            locale: item.locale,
            value: item.after,
            expectedRevision: item.expectedRevision
          }))
        );

        if (!outcome.applied) {
          throw new ToolFailure(
            'REVISION_CONFLICT',
            'Someone changed this content after the preview. Nothing was written; reload and review the current text.',
            { conflicts: outcome.conflicts }
          );
        }

        const catalogs = new Map();
        const result = {
          applied: true,
          previewId,
          changes: preview.items.map((item) => ({
            key: item.key,
            locale: item.locale,
            file: item.file,
            revision: store.readItem(item.key, item.locale, catalogs).revision
          })),
          exceptions: [...references].map(([ruleId, reference]) => ({
            ruleId,
            reference
          })),
          state: 'working-tree',
          nextStep:
            'Call verifyAppliedChange, then hand the diff to a developer for review, commit and merge request. The change is not live.'
        };

        preview.appliedResult = result;
        appliedByIdempotencyKey.set(idempotencyKey, { previewId, result });

        return result;
      }
    },
    {
      name: 'verifyAppliedChange',
      title: 'Verify applied change',
      description:
        'Re-read the catalogs and confirm every change of an applied preview holds the approved value. Report success to the editor only when verified is true.',
      inputSchema: {
        type: 'object',
        properties: {
          previewId: {
            type: 'string',
            pattern: '^[0-9a-f-]{36}$',
            maxLength: 36
          }
        },
        required: ['previewId'],
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ previewId }) => {
        const preview = previews.get(previewId);

        if (!preview?.appliedResult) {
          throw new ToolFailure(
            'NOTHING_TO_VERIFY',
            'No applied change is known for this preview in the current session.'
          );
        }

        const catalogs = new Map();
        const checks = preview.items.map((item) => {
          const current = store.readItem(item.key, item.locale, catalogs);
          return {
            key: item.key,
            locale: item.locale,
            matches: current.value === item.after,
            revision: current.revision
          };
        });

        return {
          previewId,
          verified: checks.every((check) => check.matches),
          checks,
          state: 'working-tree'
        };
      }
    },
    {
      name: 'findContentDrift',
      title: 'Find content drift',
      description:
        'Maintenance report: keys missing in a locale, translations identical to the source, and rule or placeholder violations. Read-only.',
      inputSchema: {
        type: 'object',
        properties: {
          locales: { type: 'array', items: localeSchema, maxItems: 20 },
          keyPrefix: keySchema,
          limit: { type: 'integer', minimum: 1, maximum: 500 }
        },
        additionalProperties: false
      },
      annotations: readOnly,
      handler: ({ locales, keyPrefix, limit = 100 }) => {
        const prefixParts = keyPrefix
          ? parseMessagePath(keyPrefix, 'keyPrefix')
          : null;
        const targets = (locales ?? store.locales).filter(
          (locale) => locale !== store.baseLocale
        );
        const catalogs = new Map();
        const { catalog } = store.readCatalog(store.baseLocale);
        const issues = [];
        const counts = {
          missing: 0,
          identical: 0,
          invalid: 0,
          sourceInvalid: 0
        };

        const push = (issue) => {
          if (issues.length < limit) {
            issues.push(issue);
          }
        };

        for (const message of listStringMessages(catalog)) {
          let parts;

          try {
            parts = parseMessagePath(message.key, 'Content key');
          } catch {
            continue;
          }

          if (prefixParts && !startsWithParts(parts, prefixParts)) {
            continue;
          }

          const sourceCheck = validateContentValue({
            value: message.value,
            locale: store.baseLocale,
            format: 'icu',
            rules
          });

          if (!sourceCheck.ok) {
            counts.sourceInvalid += 1;
            push({
              type: 'source-invalid',
              key: message.key,
              locale: store.baseLocale,
              findings: sourceCheck.findings
            });
          }

          for (const locale of targets) {
            const item = store.readItem(message.key, locale, catalogs);

            if (item.kind !== 'text') {
              counts.missing += 1;
              push({ type: 'missing', key: message.key, locale });
              continue;
            }

            const result = validateContentValue({
              value: item.value,
              locale,
              sourceValue: message.value,
              sourceLocale: store.baseLocale,
              format: 'icu',
              rules
            });

            if (!result.ok) {
              counts.invalid += 1;
              push({
                type: 'invalid',
                key: message.key,
                locale,
                findings: result.findings
              });
            } else if (
              result.findings.some((f) => f.ruleId === 'unchanged-from-source')
            ) {
              counts.identical += 1;
              push({ type: 'identical-to-source', key: message.key, locale });
            }
          }
        }

        return {
          sourceLocale: store.baseLocale,
          counts,
          issues,
          truncated:
            Object.values(counts).reduce((a, b) => a + b, 0) > issues.length
        };
      }
    }
  ];
};

export { createCatalogTools };
