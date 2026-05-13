import { readFileSync } from 'node:fs';

const readJsonFile = (filePath) => {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
};

const toUtf8Json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export { readJsonFile, toUtf8Json };
