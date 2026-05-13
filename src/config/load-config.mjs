import { dirname } from 'node:path';

import { configFileName, defaultConfig } from './constants.mjs';
import { fail } from '../utils/errors.mjs';
import { findUp, resolveFromCwd } from '../utils/filesystem.mjs';
import { readJsonFile } from '../utils/json.mjs';

const loadConfig = (options) => {
  const projectConfigPath = options.config
    ? resolveFromCwd(options.config)
    : findUp(process.cwd(), configFileName);

  if (!projectConfigPath) {
    fail(`No ${configFileName} found. Run "content-kit init".`);
  }

  return {
    config: {
      ...defaultConfig,
      ...readJsonFile(projectConfigPath)
    },
    configDir: dirname(projectConfigPath)
  };
};

export { loadConfig };
