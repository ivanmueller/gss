import { inspectPng, MAX_LOGO_DIMENSION } from '@grain/domain';

// Logos are stored and served as PNG only (the API checks and rebuilds every PNG, which
// keeps uploaded files from carrying anything but an image). A JPG or WebP, or a PNG too
// large to store, is redrawn in the browser and saved as a PNG instead.

/** Longest side of a redrawn logo, in pixels; plenty for a logo, and keeps it small. */
export const REDRAWN_LOGO_SIZE = 512;

export type LogoResult =
  { ok: true; png: Uint8Array<ArrayBuffer> } | { ok: false; message: string };

const NOT_AN_IMAGE = 'The file is not a PNG, JPG or WebP image. Choose one of those.';

async function redraw(file: Blob): Promise<Uint8Array<ArrayBuffer> | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, REDRAWN_LOGO_SIZE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** The logo to upload, as a PNG the API accepts, from a PNG, JPG or WebP file. */
export async function logoAsPng(file: File): Promise<LogoResult> {
  const name = file.name.toLowerCase();
  const isPng = file.type === 'image/png' || name.endsWith('.png');
  const isJpeg = file.type === 'image/jpeg' || /\.jpe?g$/.test(name);
  const isWebp = file.type === 'image/webp' || name.endsWith('.webp');
  if (!isPng && !isJpeg && !isWebp) return { ok: false, message: NOT_AN_IMAGE };

  if (isPng) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if ((await inspectPng(bytes)).ok) return { ok: true, png: bytes };
  }
  const png = await redraw(file);
  if (!png) return { ok: false, message: NOT_AN_IMAGE };
  const check = await inspectPng(png);
  return check.ok
    ? { ok: true, png }
    : {
        ok: false,
        message: `The logo could not be made small enough. Use an image up to ${String(MAX_LOGO_DIMENSION)} pixels wide and high.`,
      };
}
