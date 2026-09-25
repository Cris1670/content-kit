import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeContentRules, validateContentValue } from '../validation.mjs';

const rules = normalizeContentRules({
  version: 1,
  rules: [
    {
      id: 'protected-product-names',
      type: 'protectedTerms',
      terms: ['Acme Cloud', 'Widget'],
      severity: 'error',
      overridable: false,
      message: 'Product names stay untranslated.'
    },
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
      pattern: '\\bDeal\\b',
      flags: 'i',
      severity: 'error',
      overridable: true,
      message: 'Avoid sales language.'
    }
  ]
});

const ruleIds = (result) => result.findings.map((finding) => finding.ruleId);

test('accepts a translation that keeps placeholders and product names', () => {
  const result = validateContentValue({
    value: 'Hallo {name}, entdecke Acme Cloud.',
    locale: 'de',
    sourceValue: 'Hello {name}, discover Acme Cloud.',
    sourceLocale: 'en',
    rules
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
});

test('flags missing and added placeholders', () => {
  const result = validateContentValue({
    value: 'Hallo {user}',
    locale: 'de',
    sourceValue: 'Hello {name}',
    sourceLocale: 'en'
  });

  assert.equal(result.ok, false);
  assert.equal(ruleIds(result).filter((id) => id === 'placeholders').length, 2);
});

test('flags invalid ICU syntax', () => {
  const result = validateContentValue({
    value: 'Hallo {name',
    locale: 'de',
    sourceValue: 'Hello {name}',
    sourceLocale: 'en'
  });

  assert.deepEqual(ruleIds(result), ['icu-syntax']);
});

test('requires select choices to stay identical but lets plural categories vary', () => {
  const select = validateContentValue({
    value: '{kind, select, email {E-Mail} other {Andere}}',
    locale: 'de',
    sourceValue: '{kind, select, email {Email} phone {Phone} other {Other}}',
    sourceLocale: 'en'
  });
  const plural = validateContentValue({
    value: '{n, plural, one {# jour} many {# jours} other {# jours}}',
    locale: 'fr',
    sourceValue: '{n, plural, one {# day} other {# days}}',
    sourceLocale: 'en'
  });

  assert.deepEqual(ruleIds(select), ['placeholders']);
  assert.equal(plural.ok, true);
});

test('flags formatting tags that differ from the source', () => {
  const result = validateContentValue({
    value: 'Lies <a>das</a>',
    locale: 'de',
    sourceValue: 'Read <b>this</b>',
    sourceLocale: 'en'
  });

  assert.deepEqual(ruleIds(result), ['markup']);
});

test('applies a locale-scoped pattern only to that locale', () => {
  const english = validateContentValue({
    value: 'Loading...',
    locale: 'en',
    rules
  });
  const german = validateContentValue({
    value: 'Laden...',
    locale: 'de',
    rules
  });

  assert.deepEqual(ruleIds(english), ['en-ellipsis-character']);
  assert.equal(german.ok, true);
});

test('flags a translated product name but not an edit of the source locale', () => {
  const translation = validateContentValue({
    value: 'Découvrez le Nuage Acme.',
    locale: 'fr',
    sourceValue: 'Discover Acme Cloud.',
    sourceLocale: 'en',
    rules
  });
  const sourceEdit = validateContentValue({
    value: 'Discover our hosting.',
    locale: 'en',
    sourceValue: 'Discover Acme Cloud.',
    sourceLocale: 'en',
    rules
  });

  assert.deepEqual(ruleIds(translation), ['protected-product-names']);
  assert.equal(sourceEdit.ok, true);
});

test('marks overridable rule findings as overridable', () => {
  const result = validateContentValue({
    value: 'Today only: a deal',
    locale: 'en',
    rules
  });

  assert.equal(result.ok, false);
  assert.equal(result.findings[0].overridable, true);
});

test('flags invisible control and bidi override characters', () => {
  const result = validateContentValue({
    value: `Safe${String.fromCodePoint(0x202e)}txt.exe`,
    locale: 'en'
  });

  assert.deepEqual(ruleIds(result), ['unsafe-characters']);
});

test('flags an empty value, a length budget and HTML in plain text', () => {
  assert.deepEqual(
    ruleIds(
      validateContentValue({ value: '  ', locale: 'en', format: 'plain' })
    ),
    ['non-empty']
  );
  assert.deepEqual(
    ruleIds(
      validateContentValue({ value: 'Too long', locale: 'en', maxLength: 3 })
    ),
    ['max-length']
  );
  assert.deepEqual(
    ruleIds(
      validateContentValue({
        value: 'Hi <script>x</script>',
        locale: 'en',
        format: 'plain'
      })
    ),
    ['markup']
  );
});

test('warns when a translation is identical to its source', () => {
  const result = validateContentValue({
    value: 'Dashboard',
    locale: 'de',
    sourceValue: 'Dashboard',
    sourceLocale: 'en'
  });

  assert.equal(result.ok, true);
  assert.deepEqual(ruleIds(result), ['unchanged-from-source']);
});

test('rejects malformed rule files', () => {
  assert.throws(
    () => normalizeContentRules({ version: 2, rules: [] }),
    /version/
  );
  assert.throws(
    () =>
      normalizeContentRules({
        version: 1,
        rules: [
          {
            id: 'x',
            type: 'forbiddenPattern',
            pattern: '(',
            severity: 'error',
            overridable: false,
            message: 'm'
          }
        ]
      }),
    /not a valid regular expression/
  );
  assert.throws(
    () =>
      normalizeContentRules({
        version: 1,
        rules: [
          {
            id: 'a',
            type: 'protectedTerms',
            terms: ['A'],
            severity: 'error',
            overridable: false,
            message: 'm'
          },
          {
            id: 'a',
            type: 'protectedTerms',
            terms: ['B'],
            severity: 'error',
            overridable: false,
            message: 'm'
          }
        ]
      }),
    /duplicate rule id/
  );
});
