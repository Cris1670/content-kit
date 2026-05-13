import { existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const resolveFromCwd = (inputPath) =>
  isAbsolute(inputPath) ? inputPath : resolve(process.cwd(), inputPath);

const resolveFromDir = (baseDir, inputPath) =>
  isAbsolute(inputPath) ? inputPath : resolve(baseDir, inputPath);

const safeExists = (filePath) => {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
};

const safeReadDir = (dirPath, hints) => {
  try {
    return readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    hints.push(`Could not inspect ${dirPath}: ${error.message}`);
    return [];
  }
};

const findUp = (startDir, fileName) => {
  let currentDir = resolve(startDir);

  while (true) {
    const candidate = resolve(currentDir, fileName);

    if (safeExists(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);

    if (parentDir === currentDir) {
      return null;
    }

    currentDir = parentDir;
  }
};

export { findUp, resolveFromCwd, resolveFromDir, safeExists, safeReadDir };
