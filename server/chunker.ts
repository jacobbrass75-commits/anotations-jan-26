export interface TextChunkData {
  text: string;
  startPosition: number;
  endPosition: number;
}

export function chunkText(
  text: string,
  chunkSize: number = 500,
  overlap: number = 50
): TextChunkData[] {
  const chunks: TextChunkData[] = [];
  let start = 0;
  const safeChunkSize = Math.max(1, chunkSize);
  const safeOverlap = Math.max(0, Math.min(overlap, safeChunkSize - 1));

  while (start < text.length) {
    const fallbackEnd = Math.min(text.length, start + safeChunkSize);
    let end = fallbackEnd;

    // Try to end at a sentence boundary
    if (end < text.length) {
      const slice = text.slice(start, Math.min(end + 100, text.length));
      const sentenceEnd = findSentenceEnd(slice, chunkSize);
      // Ignore boundaries that would keep us inside the overlap window and
      // cause the next iteration to reuse the same start offset forever.
      if (sentenceEnd > safeOverlap) {
        end = start + sentenceEnd;
      }
    }

    if (end <= start) {
      end = fallbackEnd;
    }

    const chunkText = text.slice(start, end);
    
    if (chunkText.trim()) {
      chunks.push({
        text: chunkText,
        startPosition: start,
        endPosition: end,
      });
    }

    if (end >= text.length) break;

    const nextStart = Math.max(start + 1, end - safeOverlap);
    if (nextStart <= start) break;
    start = nextStart;
  }

  return chunks;
}

function findSentenceEnd(text: string, targetLength: number): number {
  // Look for sentence endings near the target length
  const sentenceEnders = ['. ', '.\n', '! ', '!\n', '? ', '?\n'];
  
  let bestPos = -1;
  
  for (const ender of sentenceEnders) {
    let pos = text.indexOf(ender);
    while (pos !== -1 && pos <= targetLength + 50) {
      if (pos >= targetLength - 50) {
        bestPos = pos + ender.length;
        break;
      }
      pos = text.indexOf(ender, pos + 1);
    }
  }

  return bestPos;
}

export function extractTextFromTxt(content: string): string {
  // Clean up the text, normalize whitespace
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}
