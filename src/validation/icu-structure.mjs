import { TYPE, parse } from '@formatjs/icu-messageformat-parser';

const argumentKinds = new Map([
  [TYPE.argument, 'argument'],
  [TYPE.number, 'number'],
  [TYPE.date, 'date'],
  [TYPE.time, 'time'],
  [TYPE.select, 'select'],
  [TYPE.plural, 'plural']
]);

const addArgument = (structure, name, kind) => {
  const existing = structure.arguments.get(name);

  if (existing == null || existing === 'argument') {
    structure.arguments.set(name, kind);
  }
};

const walk = (elements, structure) => {
  elements.forEach((element) => {
    const kind = argumentKinds.get(element.type);

    if (kind) {
      addArgument(structure, element.value, kind);
    }

    if (element.type === TYPE.select) {
      const options = structure.selectOptions.get(element.value) ?? new Set();
      Object.keys(element.options).forEach((option) => options.add(option));
      structure.selectOptions.set(element.value, options);
    }

    if (element.type === TYPE.select || element.type === TYPE.plural) {
      Object.values(element.options).forEach((option) =>
        walk(option.value, structure)
      );
    }

    if (element.type === TYPE.tag) {
      structure.tags.add(element.value);
      walk(element.children, structure);
    }
  });
};

const describeIcuStructure = (message) => {
  const structure = {
    arguments: new Map(),
    selectOptions: new Map(),
    tags: new Set()
  };

  walk(parse(message, { requiresOtherClause: true }), structure);

  return structure;
};

export { describeIcuStructure };
