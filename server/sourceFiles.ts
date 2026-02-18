import { constants } from "fs";
import { access, mkdir, writeFile } from "fs/promises";
import { extname, join } from "path";

const UPLOADS_DIR = join(process.cwd(), "data", "uploads");
const DEFAULT_EXTENSION = ".bin";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

function normalizeExtension(filename: string): string {
  const extension = extname(filename || "").toLowerCase();
  if (!extension || extension.length > 10) {
    return DEFAULT_EXTENSION;
  }
  return extension;
}

export function getDocumentSourcePath(documentId: string, filename: string): string {
  return join(UPLOADS_DIR, `${documentId}${normalizeExtension(filename)}`);
}

export async function saveDocumentSource(
  documentId: string,
  filename: string,
  fileBuffer: Buffer
): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filePath = getDocumentSourcePath(documentId, filename);
  await writeFile(filePath, fileBuffer);
  return filePath;
}

export async function hasDocumentSource(documentId: string, filename: string): Promise<boolean> {
  try {
    await access(getDocumentSourcePath(documentId, filename), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function inferDocumentSourceMimeType(filename: string): string {
  const extension = normalizeExtension(filename);
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}
