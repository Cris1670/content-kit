export type ContentFindingSeverity = 'error' | 'warning';

export type ContentFinding = {
  ruleId: string;
  severity: ContentFindingSeverity;
  overridable: boolean;
  message: string;
  source?: string | null;
  match?: string;
  terms?: string[];
};

export type ContentValidationResult = {
  ok: boolean;
  findings: ContentFinding[];
};

export type ContentRuleDescription = {
  id: string;
  type: 'forbiddenPattern' | 'protectedTerms';
  severity: ContentFindingSeverity;
  overridable: boolean;
  message: string;
  source: string | null;
  locales: string[] | null;
  pattern?: string;
  terms?: string[];
};

export type ContentRules = {
  version: 1;
  rules: ReadonlyArray<ContentRuleDescription & { regex?: RegExp }>;
};

export type ValidateContentValueInput = {
  value: unknown;
  locale: string;
  sourceValue?: string | null;
  sourceLocale?: string | null;
  format?: 'icu' | 'plain';
  maxLength?: number | null;
  rules?: ContentRules;
};

export function validateContentValue(
  input: ValidateContentValueInput
): ContentValidationResult;

export function normalizeContentRules(document: unknown): ContentRules;

export function loadContentRules(filePath: string | null): ContentRules;

export function describeContentRules(
  rules: ContentRules
): ContentRuleDescription[];
