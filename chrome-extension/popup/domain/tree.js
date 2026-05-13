import { parseMessagePath } from '../shared/message-path.js';

const getTreeSegmentLabel = (part) =>
  typeof part === 'number' ? `[${part}]` : part;

const createTreeNode = () => ({
  children: new Map(),
  edit: null,
  hasChange: false
});

const addEditToTree = (root, edit) => {
  let cursor = root;
  const hasChange = edit.edited || edit.dirty;

  if (hasChange) {
    cursor.hasChange = true;
  }

  parseMessagePath(edit.key)
    .map(getTreeSegmentLabel)
    .forEach((segment) => {
      if (!cursor.children.has(segment)) {
        cursor.children.set(segment, createTreeNode());
      }

      cursor = cursor.children.get(segment);

      if (hasChange) {
        cursor.hasChange = true;
      }
    });

  cursor.edit = edit;
};

const getEntryLabel = (entry) => {
  if (entry.kind === 'image' && entry.edited) {
    return `Image: ${entry.fileName ?? entry.value}`;
  }

  if (entry.kind === 'image') {
    return 'Unedited image';
  }

  if (entry.edited) {
    return entry.value;
  }

  return entry.value ? `Unedited: ${entry.value}` : 'Unedited field';
};

const buildEditTree = (edits) => {
  const root = createTreeNode();

  edits.forEach((edit) => {
    addEditToTree(root, edit);
  });

  return root;
};

export { buildEditTree, getEntryLabel };
