import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

import { configFileName } from './constants.mjs';
import { detectProjectConfig } from './detect-project.mjs';
import { resolveFromCwd, safeExists } from '../utils/filesystem.mjs';
import { toUtf8Json } from '../utils/json.mjs';

const kitDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const logSetupHints = (hints) => {
  if (hints.length === 0) {
    return;
  }

  console.log('\nContent Kit setup hints:');
  hints.forEach((hint) => {
    console.log(`- ${hint}`);
  });
};

const initConfig = (options) => {
  const projectRoot = options.projectRoot
    ? resolveFromCwd(options.projectRoot)
    : resolve(
        options.install && process.env.INIT_CWD
          ? process.env.INIT_CWD
          : process.cwd()
      );

  if (projectRoot === kitDir && !options.projectRoot) {
    console.log(
      'Content Kit: run init from a consuming project root, or pass --project-root.'
    );
    return;
  }

  const projectConfigPath = join(projectRoot, configFileName);

  if (safeExists(projectConfigPath)) {
    console.log(`Content Kit config already exists: ${projectConfigPath}`);
    return;
  }

  const { config, hints } = detectProjectConfig(projectRoot);

  writeFileSync(projectConfigPath, toUtf8Json(config), 'utf-8');
  console.log(`Created Content Kit config: ${projectConfigPath}`);
  logSetupHints([
    ...hints,
    `Review ${configFileName} before importing client content.`
  ]);
};

export { initConfig };
