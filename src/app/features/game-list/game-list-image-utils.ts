export function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      resolve(null);
    };
    image.src = dataUrl;
  });
}

export function encodeCanvasAsDataUrl(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): string | null {
  const dataUrl = canvas.toDataURL(mimeType, quality);
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl) ? dataUrl : null;
}

export function getCompressionOutputMimeType(inputMimeType: string): 'image/webp' | 'image/jpeg' {
  return inputMimeType === 'image/jpeg' || inputMimeType === 'image/jpg'
    ? 'image/jpeg'
    : 'image/webp';
}

export function getApproximateStringBytes(value: string): number {
  return value.length;
}
