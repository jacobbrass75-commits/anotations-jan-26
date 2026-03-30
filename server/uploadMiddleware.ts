import multer from "multer";

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

export function createUploadMiddleware(options: {
  maxFileSizeBytes?: number;
  maxFieldSizeBytes?: number;
} = {}) {
  const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_UPLOAD_FILE_SIZE_LIMIT_BYTES;
  const maxFieldSizeBytes = options.maxFieldSizeBytes ?? DEFAULT_UPLOAD_FIELD_SIZE_LIMIT_BYTES;

  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSizeBytes,
      fieldSize: maxFieldSizeBytes,
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
