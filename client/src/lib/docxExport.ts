import { markdownToDocx } from "./markdownToDocx";

export async function buildDocxBlob(title: string, markdownContent: string): Promise<Blob> {
  return markdownToDocx(markdownContent, { title });
}
