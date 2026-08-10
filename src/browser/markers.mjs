const createContentKitMarkers = ({ enabled = false, selections = {} } = {}) => {
  const whenEnabled = (attributes) => (enabled ? attributes : {});

  const edit = (key) => whenEnabled({ 'data-ck-edit': key });

  const image = (key) => whenEnabled({ 'data-ck-image': key });

  const select = (key, value, selectionId) => {
    const selection = selections[selectionId];

    if (!selection) {
      return {};
    }

    return whenEnabled({
      'data-ck-select': key,
      'data-ck-select-config': selectionId,
      ...(selection.scope === 'all' ? { 'data-ck-select-scope': 'all' } : {}),
      'data-ck-select-value': value
    });
  };

  const block = ({ collection, itemId, prefix }) =>
    whenEnabled({
      'data-ck-block': collection,
      'data-ck-block-id': itemId,
      'data-ck-block-prefix': prefix
    });

  const collection = ({ collection: name, totalItems }) =>
    whenEnabled({
      'data-ck-collection': name,
      'data-ck-collection-total': totalItems
    });

  return { block, collection, edit, image, select };
};

export { createContentKitMarkers };
