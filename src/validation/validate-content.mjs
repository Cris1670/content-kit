import { describeIcuStructure } from './icu-structure.mjs';

// C0/C1 controls other than tab and newline, plus bidirectional overrides and
// isolates, which can make reviewed text render differently from what is stored.
const unsafeCharacters =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u;
const maxValueLength = 20000;

const finding = (ruleId, severity, message, extra = {}) => ({
  ruleId,
  severity,
  overridable: false,
  message,
  ...extra
});

const formatNames = (names) =>
  [...names]
    .sort()
    .map((name) => `{${name}}`)
    .join(', ');

const compareIcuStructures = (source, target, findings) => {
  const missing = [...source.arguments.keys()].filter(
    (name) => !target.arguments.has(name)
  );
  const added = [...target.arguments.keys()].filter(
    (name) => !source.arguments.has(name)
  );

  if (missing.length > 0) {
    findings.push(
      finding(
        'placeholders',
        'error',
        `Missing placeholders from the source: ${formatNames(missing)}.`
      )
    );
  }

  if (added.length > 0) {
    findings.push(
      finding(
        'placeholders',
        'error',
        `Placeholders not in the source: ${formatNames(added)}.`
      )
    );
  }

  source.arguments.forEach((kind, name) => {
    const targetKind = target.arguments.get(name);

    if (targetKind != null && targetKind !== kind) {
      findings.push(
        finding(
          'placeholders',
          'error',
          `Placeholder {${name}} changed from ${kind} to ${targetKind}.`
        )
      );
    }
  });

  source.selectOptions.forEach((options, name) => {
    const targetOptions = target.selectOptions.get(name);

    if (
      targetOptions != null &&
      (targetOptions.size !== options.size ||
        [...options].some((option) => !targetOptions.has(option)))
    ) {
      findings.push(
        finding(
          'placeholders',
          'error',
          `Choices for {${name}} must stay ${[...options].sort().join(', ')}.`
        )
      );
    }
  });

  const missingTags = [...source.tags].filter((tag) => !target.tags.has(tag));
  const addedTags = [...target.tags].filter((tag) => !source.tags.has(tag));

  if (missingTags.length > 0 || addedTags.length > 0) {
    findings.push(
      finding(
        'markup',
        'error',
        `Formatting tags must match the source (${[...source.tags].sort().join(', ') || 'none'}).`
      )
    );
  }
};

const parseIcu = (message, label, findings) => {
  try {
    return describeIcuStructure(message);
  } catch (error) {
    findings.push(
      finding(
        'icu-syntax',
        'error',
        `${label} is not a valid message: ${error.message}.`
      )
    );
    return null;
  }
};

const appliesToLocale = (rule, locale) =>
  rule.locales == null || rule.locales.includes(locale);

const applyContentRules = ({
  value,
  locale,
  sourceValue,
  sourceLocale,
  rules,
  findings
}) => {
  const isTranslation =
    typeof sourceValue === 'string' &&
    sourceLocale != null &&
    sourceLocale !== locale;

  rules.rules.forEach((rule) => {
    if (!appliesToLocale(rule, locale)) {
      return;
    }

    const base = {
      overridable: rule.overridable,
      source: rule.source
    };

    if (rule.type === 'forbiddenPattern') {
      const match = value.match(rule.regex);

      if (match) {
        findings.push(
          finding(rule.id, rule.severity, rule.message, {
            ...base,
            match: match[0]
          })
        );
      }
    }

    if (rule.type === 'protectedTerms' && isTranslation) {
      const missing = rule.terms.filter(
        (term) => sourceValue.includes(term) && !value.includes(term)
      );

      if (missing.length > 0) {
        findings.push(
          finding(
            rule.id,
            rule.severity,
            `${rule.message} Missing: ${missing.join(', ')}.`,
            { ...base, terms: missing }
          )
        );
      }
    }
  });
};

const validateContentValue = ({
  value,
  locale,
  sourceValue = null,
  sourceLocale = null,
  format = 'icu',
  maxLength = null,
  rules = { version: 1, rules: [] }
}) => {
  const findings = [];

  if (typeof value !== 'string') {
    return {
      ok: false,
      findings: [finding('type', 'error', 'The value must be text.')]
    };
  }

  if (value.trim().length === 0) {
    findings.push(finding('non-empty', 'error', 'The value is empty.'));
  }

  if (value.length > maxValueLength) {
    findings.push(
      finding(
        'max-length',
        'error',
        `The value is longer than ${maxValueLength} characters.`
      )
    );
  }

  if (maxLength != null && [...value].length > maxLength) {
    findings.push(
      finding(
        'max-length',
        'error',
        `The value has ${[...value].length} characters; the limit is ${maxLength}.`
      )
    );
  }

  if (unsafeCharacters.test(value)) {
    findings.push(
      finding(
        'unsafe-characters',
        'error',
        'The value contains invisible control or text-direction characters.'
      )
    );
  }

  if (format === 'icu') {
    const target = parseIcu(value, 'The value', findings);
    const source =
      typeof sourceValue === 'string'
        ? parseIcu(sourceValue, 'The source', [])
        : null;

    if (target && source) {
      compareIcuStructures(source, target, findings);
    }

    if (target && typeof sourceValue !== 'string' && target.tags.size > 0) {
      findings.push(
        finding(
          'markup',
          'warning',
          'The value adds formatting tags without a source to compare against.'
        )
      );
    }
  }

  if (format === 'plain' && /<\s*\/?\s*[A-Za-z]/u.test(value)) {
    findings.push(
      finding('markup', 'error', 'Plain text must not contain HTML tags.')
    );
  }

  if (
    typeof sourceValue === 'string' &&
    sourceLocale != null &&
    sourceLocale !== locale &&
    sourceValue.trim() === value.trim() &&
    /\p{L}{3}/u.test(value)
  ) {
    findings.push(
      finding(
        'unchanged-from-source',
        'warning',
        `The ${locale} value is identical to the ${sourceLocale} source.`
      )
    );
  }

  applyContentRules({
    value,
    locale,
    sourceValue,
    sourceLocale,
    rules,
    findings
  });

  return {
    ok: !findings.some((item) => item.severity === 'error'),
    findings
  };
};

export { validateContentValue };
