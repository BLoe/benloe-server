// Phone photos are 3-12 MB; Kevin reads them just as well at 2000px. Shrinking
// here keeps uploads quick on cellular and under the server's image limits.

export const MAX_SIDE = 2000;
export const JPEG_QUALITY = 0.85;

/** The size an image should be drawn at so its long side is at most `max`. Never enlarges. */
export function fitWithin(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max || long === 0) return { width, height };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** photo.HEIC -> photo.jpg */
export function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.jpg`;
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      // fall through: some browsers decode a format in <img> but not here
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Returns the file ready to upload: images re-encoded as JPEG at most 2000px
 * on the long side, everything else untouched. An image the browser cannot
 * decode is sent as it is, and the server decides.
 */
export async function prepareUpload(file: File): Promise<{ blob: Blob; filename: string }> {
  const asIs = { blob: file, filename: file.name || 'upload' };
  const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);
  // GIFs may be animated and SVG is not a photo: leave both alone.
  if (!isImage || /gif|svg/.test(file.type)) return asIs;
  try {
    const img = await decode(file);
    const { width, height } = fitWithin(img.width, img.height);
    const small = width === img.width && height === img.height;
    // Already small and already a JPEG: re-encoding would only lose quality.
    if (small && file.type === 'image/jpeg') {
      img.close();
      return asIs;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return asIs;
    // JPEG has no alpha: paint transparent areas white rather than black.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.source, 0, 0, width, height);
    img.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return asIs;
    // A small PNG screenshot can come out larger as JPEG; keep whichever is smaller.
    if (small && blob.size >= file.size) return asIs;
    return { blob, filename: jpegName(file.name || 'photo') };
  } catch {
    return asIs;
  }
}
