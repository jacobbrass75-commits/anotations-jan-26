import type { Request } from "express";
import multer, { type StorageEngine } from "multer";

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const DEFAULT_UPLOAD_FILE_SIZE_LIMIT_BYTES = 50 * 1024 * 1024;
export const DEFAULT_UPLOAD_FIELD_SIZE_LIMIT_BYTES = 5 * 1024 * 1024;

export function getFileExtension(filename: string): string {
  const extStart = filename.lastIndexOf(".");
  if (extStart < 0) return "";
  return filename.slice(extStart).toLowerCase();
}

export function isImageFile(mimeType: string, extension: string): boolean {
  return mimeType.startsWith("image/") || IMAGE_MIME_TYPES.has(mimeType) || IMAGE_EXTENSIONS.has(extension);
}

function createMemoryStorage(options: { maxTotalFileSizeBytes?: number } = {}): StorageEngine {
  const requestTotals = new WeakMap<Request, { bytes: number }>();

  return {
    _handleFile(req, file, callback) {
      const chunks: Buffer[] = [];
      let fileSize = 0;
      let callbackCalled = false;

      function complete(error?: Error, info?: Partial<Express.Multer.File>): void {
        if (callbackCalled) return;
        callbackCalled = true;
        callback(error, info);
      }

      file.stream.on("data", (chunk: Buffer) => {
        if (callbackCalled) return;

        const chunkLength = chunk.length;
        fileSize += chunkLength;

        if (options.maxTotalFileSizeBytes) {
          const total = requestTotals.get(req) ?? { bytes: 0 };
          total.bytes += chunkLength;
          requestTotals.set(req, total);

          if (total.bytes > options.maxTotalFileSizeBytes) {
            complete(new multer.MulterError("LIMIT_FILE_SIZE", file.fieldname));
            file.stream.resume();
            return;
          }
        }

        chunks.push(chunk);
      });

      file.stream.on("error", complete);
      file.stream.on("end", () => {
        complete(undefined, {
          buffer: Buffer.concat(chunks, fileSize),
          size: fileSize,
        });
      });
    },
    _removeFile(_req, file, callback) {
      delete (file as Partial<Express.Multer.File>).buffer;
      callback(null);
    },
  };
}

export function createUploadMiddleware(options: {
  maxFileSizeBytes?: number;
  maxFieldSizeBytes?: number;
  maxFileCount?: number;
  maxTotalFileSizeBytes?: number;
} = {}) {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_UPLOAD_FILE_SIZE_LIMIT_BYTES;
  const maxFieldSizeBytes = options.maxFieldSizeBytes ?? DEFAULT_UPLOAD_FIELD_SIZE_LIMIT_BYTES;

  return multer({
    storage: createMemoryStorage({ maxTotalFileSizeBytes: options.maxTotalFileSizeBytes }),
    limits: {
      fileSize: maxFileSizeBytes,
      fieldSize: maxFieldSizeBytes,
      ...(options.maxFileCount ? { files: options.maxFileCount } : {}),
    },
    fileFilter: (_req, file, cb) => {
      const ext = getFileExtension(file.originalname);
      const isPdf = file.mimetype === "application/pdf" || ext === ".pdf";
      const isTxt = file.mimetype === "text/plain" || ext === ".txt";
      const image = isImageFile(file.mimetype, ext);

      if (isPdf || isTxt || image) {
        cb(null, true);
        return;
      }

      cb(new Error("Only PDF, TXT, and image files (including HEIC/HEIF) are allowed"));
    },
  });
}

export const upload = createUploadMiddleware();
