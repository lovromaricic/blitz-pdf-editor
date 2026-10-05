// Image work off the main thread: preparing inserted images (decoding,
// converting, downscaling) and cutting cropped ones when a PDF is written.
import { prepareInsertImage, UnsupportedImageError, type PreparedImage } from './image-prepare';
import { cutImage, type PixelRect } from './image-cut';
import type { ImageAsset } from './image-store';

export type ImageJob = { id: number; bytes: Uint8Array; heic: boolean } | { id: number; cut: { asset: ImageAsset; rect: PixelRect } };

export type ImageJobResult =
  | { id: number; image: PreparedImage }
  | { id: number; cut: { asset: ImageAsset; reduced: boolean } }
  | { id: number; error: 'unsupported' | string };

self.onmessage = async (e: MessageEvent<ImageJob>) => {
  const job = e.data;
  const { id } = job;
  const post = (msg: ImageJobResult, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    if ('cut' in job) {
      const cut = await cutImage(job.cut.asset, job.cut.rect);
      post({ id, cut }, [cut.asset.bytes.buffer as ArrayBuffer]);
      return;
    }
    const image = await prepareInsertImage(job.bytes, job.heic);
    post({ id, image }, [image.bytes.buffer as ArrayBuffer]);
  } catch (err) {
    post({ id, error: err instanceof UnsupportedImageError ? 'unsupported' : String((err as Error)?.message ?? err) });
  }
};
