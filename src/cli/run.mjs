import { applyBrowserEdits } from '../edits/apply-edits.mjs';
import { initConfig } from '../config/init-config.mjs';
import { loadConfig } from '../config/load-config.mjs';
import { parseArgs } from './parse-args.mjs';
import { showHelp } from './help.mjs';

const run = () => {
  try {
    const { command, options } = parseArgs();

    if (command === 'help') {
      showHelp();
      process.exit(0);
    }

    if (command === 'init') {
      initConfig(options);
      process.exit(0);
    }

    const { config, configDir } = loadConfig(options);

    if (command === 'apply-edits') {
      applyBrowserEdits(config, configDir, options);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
};

export { run };
