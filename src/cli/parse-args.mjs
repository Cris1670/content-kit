import { fail } from '../utils/errors.mjs';

const supportedCommands = new Set(['init', 'apply-edits', 'help']);

const parseArgs = () => {
  const [command = 'help', ...rawArgs] = process.argv.slice(2);

  if (!supportedCommands.has(command)) {
    fail(`Unknown command "${command}". Run "content-kit help".`);
  }

  const options = {};
  const getOptionValue = (arg, index) => {
    const value = rawArgs[index + 1];

    if (!value || value.startsWith('-')) {
      fail(`Option "${arg}" requires a value.`);
    }

    return value;
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === '--input' || arg === '-i') {
      options.input = getOptionValue(arg, index);
      index += 1;
      continue;
    }

    if (arg === '--config') {
      options.config = getOptionValue(arg, index);
      index += 1;
      continue;
    }

    if (arg === '--project-root') {
      options.projectRoot = getOptionValue(arg, index);
      index += 1;
      continue;
    }

    if (arg === '--install') {
      options.install = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      return { command: 'help', options: {} };
    }

    if (arg.startsWith('-')) {
      fail(`Unknown option "${arg}".`);
    }

    if (!options.input) {
      options.input = arg;
      continue;
    }

    fail(`Unexpected argument "${arg}".`);
  }

  return { command, options };
};

export { parseArgs };
