// Prepares inserted images off the main thread (decoding, converting, downscaling).
import { prepareInsertImage, UnsupportedImageError, type PreparedImage } from './image-prepare';

export interface ImageJob {
  id: number;
  bytes: Uint8Array;
  heic: boolean;
}

export type ImageJobResult = { id: number; image: PreparedImage } | { id: number; error: 'unsupported' | string };

self.onmessage = async (e: MessageEvent<ImageJob>) => {
  const { id, bytes, heic } = e.data;
  const post = (msg: ImageJobResult, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    const image = await prepareInsertImage(bytes, heic);
    post({ id, image }, [image.bytes.buffer as ArrayBuffer]);
  } catch (err) {
    post({ id, error: err instanceof UnsupportedImageError ? 'unsupported' : String((err as Error)?.message ?? err) });
  }
};
