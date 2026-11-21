export function decodeImage(bytes, mime) {
  return createImageBitmap(new Blob([bytes], { type: mime }), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  });
}

export function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function encodeCanvas(canvas, type = 'image/png', quality) {
  const blob = canvas.convertToBlob
    ? await canvas.convertToBlob({ type, quality })
    : await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export function hasTransparency(pixels) {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 255) return true;
  }
  return false;
}

export async function readImageSize(image) {
  try {
    const bitmap = await decodeImage(image.bytes, image.mime);
    image.width = bitmap.width;
    image.height = bitmap.height;
    bitmap.close?.();
  } catch {
    image.width = 0;
    image.height = 0;
  }
}

export const imageTools = {
  async toPNG(bytes, mime) {
    const bitmap = await decodeImage(bytes, mime);
    const canvas = createCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return encodeCanvas(canvas);
  },

  async alphaToPNG(bytes, mime) {
    if (mime === 'image/jpeg') return null;
    const bitmap = await decodeImage(bytes, mime);
    const canvas = createCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = image.data;
    if (!hasTransparency(px)) return null;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i + 1] = px[i + 2] = px[i + 3];
      px[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return encodeCanvas(canvas);
  },

  async textureToPNG(texture) {
    const image = texture.image;
    if (!image?.width) return null;
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    if (image.data) {
      if (image.data.length !== image.width * image.height * 4) return null;
      const data = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length);
      ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
    } else {
      if (image.decode) await image.decode().catch(() => {});
      ctx.drawImage(image, 0, 0);
    }
    return encodeCanvas(canvas);
  },
};
