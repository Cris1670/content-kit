import {
  allowedImageExtensions,
  allowedImageTypes,
  maxImageBytes
} from './constants.js';

const isSupportedLocale = (locale) =>
  /^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(locale);

const getProjectIdFromUrl = (url) => {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return null;
    }

    return parsedUrl.origin;
  } catch {
    return null;
  }
};

const getSafeEditUrl = (url, projectOrigin) => {
  if (typeof url !== 'string' || url.length > 2048) {
    return '';
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return '';
    }

    if (projectOrigin && parsedUrl.origin !== projectOrigin) {
      return '';
    }

    return parsedUrl.href;
  } catch {
    return '';
  }
};

const getComparableUrl = (url) => {
  try {
    const parsedUrl = new URL(url);

    return `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search}`;
  } catch {
    return '';
  }
};

const getAscii = (bytes, start, end) =>
  String.fromCharCode(...bytes.subarray(start, end));

const getImageMimeTypeFromBytes = (bytes) => {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  if (bytes.length >= 4 && getAscii(bytes, 0, 4) === 'GIF8') {
    return 'image/gif';
  }

  if (
    bytes.length >= 12 &&
    getAscii(bytes, 0, 4) === 'RIFF' &&
    getAscii(bytes, 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
};

const getFileExtension = (filename) => {
  const extensionMatch = filename.toLowerCase().match(/\.([a-z0-9]+)$/);

  return extensionMatch?.[1] ?? '';
};

const getBase64ByteLength = (base64) => {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return base64.length * 0.75 - padding;
};

const getBase64PrefixBytes = (base64) => {
  const prefixLength = Math.min(base64.length, 32);
  const alignedPrefixLength = prefixLength - (prefixLength % 4);
  const prefix = base64.slice(0, alignedPrefixLength);

  if (!prefix) {
    return new Uint8Array();
  }

  const binary = atob(prefix);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const getSafeImageDataUrlInfo = (dataUrl) => {
  const match =
    typeof dataUrl === 'string'
      ? dataUrl.match(
          /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u
        )
      : null;

  if (!match || match[2].length % 4 !== 0) {
    return null;
  }

  const mimeType = match[1];
  const byteLength = getBase64ByteLength(match[2]);

  if (
    !Number.isInteger(byteLength) ||
    byteLength <= 0 ||
    byteLength > maxImageBytes
  ) {
    return null;
  }

  try {
    const prefixMimeType = getImageMimeTypeFromBytes(
      getBase64PrefixBytes(match[2])
    );

    if (prefixMimeType !== mimeType) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    byteLength,
    mimeType
  };
};

const assertSafeImageEdit = (edit, index) => {
  const imageInfo = getSafeImageDataUrlInfo(edit.dataUrl);
  const previewUrl =
    typeof edit.previewUrl === 'string' &&
    getSafeImageDataUrlInfo(edit.previewUrl)
      ? edit.previewUrl
      : edit.dataUrl;

  if (!imageInfo) {
    throw new Error(
      `Image edit ${index + 1} must be a valid PNG, JPEG, GIF, or WebP data URL under 5 MB.`
    );
  }

  if (!allowedImageExtensions.has(getFileExtension(edit.fileName))) {
    throw new Error(
      `Image edit ${index + 1} must use a PNG, JPEG, GIF, or WebP filename.`
    );
  }

  if (
    typeof edit.mimeType === 'string' &&
    allowedImageTypes.has(edit.mimeType) &&
    edit.mimeType !== imageInfo.mimeType
  ) {
    throw new Error(
      `Image edit ${index + 1} content does not match its MIME type.`
    );
  }

  return {
    mimeType: imageInfo.mimeType,
    previewUrl
  };
};

export {
  assertSafeImageEdit,
  getComparableUrl,
  getProjectIdFromUrl,
  getSafeEditUrl,
  isSupportedLocale
};
