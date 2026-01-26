#!/usr/bin/env python3
"""Run PaddleOCR on a PDF file using either PP-OCRv5 or PaddleOCR-VL."""

import argparse
import json
import os
import sys

import numpy as np
from pdf2image import convert_from_path
from PIL import Image

os.environ["DISABLE_MODEL_SOURCE_CHECK"] = "True"

MAX_SIDE = 960


def _resize_if_needed(img: Image.Image) -> np.ndarray:
    """Resize image so longest side is at most MAX_SIDE pixels.

    PaddlePaddle 3.x on Apple Silicon segfaults on larger images.
    """
    w, h = img.size
    scale = min(MAX_SIDE / w, MAX_SIDE / h, 1.0)
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return np.array(img)


def run_ppocr(pdf_path: str, lang: str = "en") -> dict:
    """Run PP-OCRv5 on each page of the PDF.

    Converts pages to images, then runs PaddleOCR on each.
    """
    from paddleocr import PaddleOCR

    ocr = PaddleOCR(
        use_textline_orientation=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        lang=lang,
    )

    images = convert_from_path(pdf_path, dpi=200)
    pages = []
    all_text_parts = []

    for i, img in enumerate(images):
        img_array = _resize_if_needed(img)
        result = ocr.predict(img_array)

        page_lines = []
        page_confidences = []

        if result and len(result) > 0:
            page_result = result[0]
            rec_texts = page_result.get("rec_texts", [])
            rec_scores = page_result.get("rec_scores", [])
            for text, confidence in zip(rec_texts, rec_scores):
                page_lines.append(text)
                page_confidences.append(float(confidence))

        page_text = "\n".join(page_lines)
        avg_confidence = (
            sum(page_confidences) / len(page_confidences)
            if page_confidences
            else 0.0
        )

        pages.append({
            "page": i,
            "text": page_text,
            "confidence": round(avg_confidence, 4),
        })
        all_text_parts.append(page_text)

    full_text = "\n\n".join(all_text_parts)
    return {
        "pages": pages,
        "full_text": full_text,
        "model": "ppocr",
    }


def run_vl(pdf_path: str, lang: str = "en") -> dict:
    """Run PaddleOCR-VL directly on the PDF."""
    from paddleocr import PaddleOCRVL

    ocr_vl = PaddleOCRVL()
    result = ocr_vl.predict(input=pdf_path)

    pages = []
    all_text_parts = []

    if result:
        for i, page_result in enumerate(result):
            page_text = ""
            if hasattr(page_result, "text"):
                page_text = page_result.text
            elif isinstance(page_result, dict) and "text" in page_result:
                page_text = page_result["text"]
            elif hasattr(page_result, "rec_texts"):
                page_text = "\n".join(page_result.rec_texts)
            elif isinstance(page_result, (list, tuple)):
                # Try to extract text from list of detection results
                lines = []
                for item in page_result:
                    if isinstance(item, dict) and "text" in item:
                        lines.append(item["text"])
                    elif isinstance(item, (list, tuple)) and len(item) >= 2:
                        lines.append(str(item[1][0]) if isinstance(item[1], (list, tuple)) else str(item[1]))
                page_text = "\n".join(lines)

            pages.append({
                "page": i,
                "text": page_text,
                "confidence": 0.0,  # VL doesn't provide per-line confidence
            })
            all_text_parts.append(page_text)

    full_text = "\n\n".join(all_text_parts)
    return {
        "pages": pages,
        "full_text": full_text,
        "model": "vl",
    }


def main():
    parser = argparse.ArgumentParser(description="Run PaddleOCR on a PDF")
    parser.add_argument("--pdf_path", required=True, help="Path to the PDF file")
    parser.add_argument(
        "--model",
        required=True,
        choices=["ppocr", "vl"],
        help="OCR model to use: ppocr (PP-OCRv5) or vl (PaddleOCR-VL)",
    )
    parser.add_argument(
        "--lang",
        default="en",
        help="Language for OCR (default: en)",
    )
    args = parser.parse_args()

    if args.model == "ppocr":
        result = run_ppocr(args.pdf_path, args.lang)
    else:
        result = run_vl(args.pdf_path, args.lang)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
