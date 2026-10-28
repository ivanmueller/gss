import { afterEach, describe, expect, it, vi } from 'vitest';

import { PNG } from '../test/api';
import { logoAsPng, REDRAWN_LOGO_SIZE } from './logoImage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Stands in for the browser's image decoding and canvas, which jsdom lacks. */
function fakeCanvas(width: number, height: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() => Promise.resolve({ width, height, close: vi.fn() })),
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  const sizes: [number, number][] = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    sizes.push([this.width, this.height]);
    callback(new Blob([PNG], { type: 'image/png' }));
  });
  return { drawImage, sizes };
}

describe('logoAsPng', () => {
  it('keeps a valid PNG as it is', async () => {
    const result = await logoAsPng(new File([PNG], 'logo.png', { type: 'image/png' }));
    expect(result).toEqual({ ok: true, png: PNG });
  });

  it('redraws a JPG as a PNG, no larger than the logo size', async () => {
    const { sizes } = fakeCanvas(2000, 1000);
    const result = await logoAsPng(
      new File([new Uint8Array([0xff, 0xd8, 0xff])], 'logo.jpg', { type: 'image/jpeg' }),
    );
    expect(result).toEqual({ ok: true, png: PNG });
    expect(sizes).toEqual([[REDRAWN_LOGO_SIZE, REDRAWN_LOGO_SIZE / 2]]);
  });

  it('redraws a WebP as a PNG too', async () => {
    const { sizes } = fakeCanvas(300, 300);
    const result = await logoAsPng(
      new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], 'logo.webp', { type: 'image/webp' }),
    );
    expect(result).toEqual({ ok: true, png: PNG });
    expect(sizes).toEqual([[300, 300]]);
  });

  it('refuses other files, HTML included', async () => {
    for (const file of [
      new File(['<p>hi</p>'], 'logo.html', { type: 'text/html' }),
      new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
    ]) {
      expect(await logoAsPng(file)).toEqual({
        ok: false,
        message: 'The file is not a PNG, JPG or WebP image. Choose one of those.',
      });
    }
  });
});
