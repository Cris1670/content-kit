export type ContentKitEditAttributes = {
  'data-ck-edit'?: string;
};

export type ContentKitImageAttributes = {
  'data-ck-image'?: string;
};

export type ContentKitSelectAttributes = {
  'data-ck-select'?: string;
  'data-ck-select-config'?: string;
  'data-ck-select-scope'?: 'all';
  'data-ck-select-value'?: string;
};

export type ContentKitBlockAttributes = {
  'data-ck-block'?: string;
  'data-ck-block-id'?: string;
  'data-ck-block-prefix'?: string;
};

export type ContentKitCollectionAttributes = {
  'data-ck-collection'?: string;
  'data-ck-collection-total'?: number;
};

export type ContentKitBlockMarker = {
  collection: string;
  itemId: string;
  prefix: string;
};

export type ContentKitCollectionMarker = {
  collection: string;
  totalItems: number;
};

export type ContentKitSelectionOption = {
  icon?: string;
  label: string;
  value: string;
};

export type ContentKitSelectionConfig = {
  options: ContentKitSelectionOption[];
  scope?: 'locale' | 'all';
};

export type ContentKitMarkerFactory = {
  block: (marker: ContentKitBlockMarker) => ContentKitBlockAttributes;
  collection: (
    marker: ContentKitCollectionMarker
  ) => ContentKitCollectionAttributes;
  edit: (key: string) => ContentKitEditAttributes;
  image: (key: string) => ContentKitImageAttributes;
  select: (
    key: string,
    value: string,
    selectionId: string
  ) => ContentKitSelectAttributes;
};

export const createContentKitMarkers: (options?: {
  enabled?: boolean;
  selections?: Record<string, ContentKitSelectionConfig>;
}) => ContentKitMarkerFactory;
