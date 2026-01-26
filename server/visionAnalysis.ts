import OpenAI from "openai";
import { readFile } from "fs/promises";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface PdfAnalysis {
  textClarity: "clear" | "blurry" | "mixed";
  handwritingType: "none" | "print" | "cursive" | "mixed";
  languages: string[];
  difficulty: "easy" | "medium" | "hard";
}

const DEFAULT_ANALYSIS: PdfAnalysis = {
  textClarity: "clear",
  handwritingType: "none",
  languages: ["english"],
  difficulty: "medium",
};

/**
 * Send PDF page screenshots to GPT-4o vision to analyze OCR difficulty.
 * Uses low-detail mode to minimize cost (~$0.01/upload).
 */
export async function analyzePdfDifficulty(
  screenshotPaths: string[]
): Promise<PdfAnalysis> {
  try {
    // Read screenshots and convert to base64
    const imageMessages: OpenAI.Chat.Completions.ChatCompletionContentPart[] =
      [];
    for (const screenshotPath of screenshotPaths) {
      const buffer = await readFile(screenshotPath);
      const base64 = buffer.toString("base64");
      imageMessages.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${base64}`,
          detail: "low",
        },
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are a document analysis assistant. Analyze the provided PDF page images and assess the OCR difficulty. Respond with ONLY valid JSON, no markdown.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze these PDF page images and return a JSON object with:
- "textClarity": "clear" | "blurry" | "mixed" - how clear/readable is the text
- "handwritingType": "none" | "print" | "cursive" | "mixed" - type of handwriting present (none = typed/digital text)
- "languages": array of detected languages (e.g. ["english", "chinese"])
- "difficulty": "easy" | "medium" | "hard" - overall OCR difficulty where:
  - easy: clean typed text, standard fonts, good contrast
  - medium: some noise, mixed formatting, or scanned but clear
  - hard: handwritten, cursive, very noisy, distorted, or complex layouts

Return ONLY the JSON object, no explanation.`,
            },
            ...imageMessages,
          ],
        },
      ],
      max_tokens: 200,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      console.warn("Vision analysis returned empty response, using defaults");
      return DEFAULT_ANALYSIS;
    }

    // Parse JSON, stripping markdown fences if present
    const jsonStr = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(jsonStr) as PdfAnalysis;

    // Validate required fields
    if (!parsed.difficulty || !parsed.handwritingType) {
      console.warn("Vision analysis missing fields, using defaults");
      return DEFAULT_ANALYSIS;
    }

    return parsed;
  } catch (error) {
    console.warn("Vision analysis failed, using defaults:", error);
    return DEFAULT_ANALYSIS;
  }
}

/**
 * Choose the OCR model based on vision analysis results.
 *
 * Routing rules:
 * - easy/medium difficulty + print/none handwriting → PP-OCRv5 (fast)
 * - hard difficulty OR cursive/mixed handwriting → PaddleOCR-VL (accurate)
 */
export function chooseOcrModel(analysis: PdfAnalysis): "ppocr" | "vl" {
  if (analysis.difficulty === "hard") {
    return "vl";
  }

  if (
    analysis.handwritingType === "cursive" ||
    analysis.handwritingType === "mixed"
  ) {
    return "vl";
  }

  return "ppocr";
}
