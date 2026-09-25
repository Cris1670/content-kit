import { fail } from '../utils/errors.mjs';
import { readJsonFile } from '../utils/json.mjs';

const ruleTypes = new Set(['forbiddenPattern', 'protectedTerms']);
const severities = new Set(['error', 'warning']);
const allowedPatternFlags = /^[imsu]*$/u;
const maxRules = 200;
const maxPatternLength = 200;
const maxTerms = 200;
const maxTextLength = 500;
const safeIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const localePattern = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u;

const assertText = (value, label, { optional = false } = {}) => {
  if (value == null && optional) {
    return;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > maxTextLength
  ) {
    fail(
      `${label} must be a non-empty string up to ${maxTextLength} characters.`
    );
  }
};

const normalizeRule = (rule, index, seenIds) => {
  const label = `Content rule ${index + 1}`;

  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    fail(`${label} must be an object.`);
  }

  if (typeof rule.id !== 'string' || !safeIdPattern.test(rule.id)) {
    fail(`${label} needs a lowercase kebab-case "id".`);
  }

  if (seenIds.has(rule.id)) {
    fail(`${label}: duplicate rule id "${rule.id}".`);
  }

  seenIds.add(rule.id);

  if (!ruleTypes.has(rule.type)) {
    fail(`${label}: "type" must be "forbiddenPattern" or "protectedTerms".`);
  }

  if (!severities.has(rule.severity)) {
    fail(`${label}: "severity" must be "error" or "warning".`);
  }

  if (typeof rule.overridable !== 'boolean') {
    fail(`${label}: "overridable" must be true or false.`);
  }

  assertText(rule.message, `${label} "message"`);
  assertText(rule.source, `${label} "source"`, { optional: true });

  if (
    rule.locales != null &&
    (!Array.isArray(rule.locales) ||
      rule.locales.some(
        (locale) => typeof locale !== 'string' || !localePattern.test(locale)
      ))
  ) {
    fail(`${label}: "locales" must be an array of locale codes.`);
  }

  const normalized = {
    id: rule.id,
    type: rule.type,
    severity: rule.severity,
    overridable: rule.overridable,
    message: rule.message,
    source: rule.source ?? null,
    locales: rule.locales ?? null
  };

  if (rule.type === 'forbiddenPattern') {
    if (
      typeof rule.pattern !== 'string' ||
      rule.pattern.length === 0 ||
      rule.pattern.length > maxPatternLength
    ) {
      fail(`${label}: "pattern" must be 1 to ${maxPatternLength} characters.`);
    }

    const flags = rule.flags ?? '';

    if (typeof flags !== 'string' || !allowedPatternFlags.test(flags)) {
      fail(`${label}: "flags" may only contain i, m, s and u.`);
    }

    try {
      // eslint-disable-next-line security/detect-non-literal-regexp
      normalized.regex = new RegExp(
        rule.pattern,
        flags.includes('u') ? flags : `${flags}u`
      );
    } catch {
      fail(`${label}: "pattern" is not a valid regular expression.`);
    }

    normalized.pattern = rule.pattern;
  }

  if (rule.type === 'protectedTerms') {
    if (
      !Array.isArray(rule.terms) ||
      rule.terms.length === 0 ||
      rule.terms.length > maxTerms
    ) {
      fail(`${label}: "terms" must contain 1 to ${maxTerms} strings.`);
    }

    rule.terms.forEach((term) => assertText(term, `${label} term`));
    normalized.terms = [...rule.terms].sort((a, b) => b.length - a.length);
  }

  return normalized;
};

const normalizeContentRules = (document) => {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    fail('Content rules must be a JSON object.');
  }

  if (document.version !== 1) {
    fail('Content rules "version" must be 1.');
  }

  if (!Array.isArray(document.rules) || document.rules.length > maxRules) {
    fail(`Content rules "rules" must be an array of up to ${maxRules} rules.`);
  }

  const seenIds = new Set();

  return {
    version: 1,
    rules: document.rules.map((rule, index) =>
      normalizeRule(rule, index, seenIds)
    )
  };
};

const loadContentRules = (filePath) => {
  if (filePath == null) {
    return { version: 1, rules: [] };
  }

  return normalizeContentRules(readJsonFile(filePath));
};

const describeContentRules = (rules) =>
  rules.rules.map(({ regex: _regex, ...rule }) => rule);

export { describeContentRules, loadContentRules, normalizeContentRules };
