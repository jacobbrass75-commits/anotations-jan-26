#!/usr/bin/env python3
"""PaddleOCR pipeline for scanned PDF text extraction.

Usage:
    python pdf_pipeline.py --mode=ocr --model=ppocr --dpi=200 <pdf_path>

Outputs extracted text to stdout (one page separated by form-feed).
Progress lines are written to stderr.
"""

import argparse
import json
import os
import sys
import tempfile


def _get_page_count(pdf_path: str) -> int:
    """Get the number of pages in a PDF."""
    try:
        import fitz
        doc = fitz.open(pdf_path)
        count = len(doc)
        doc.close()
        return count
    except ImportError:
        print("PyMuPDF not installed, cannot count pages", file=sys.stderr)
        return 0


def _resize_if_needed(img, max_dim: int = 4096):
    """Resize image if either dimension exceeds max_dim, preserving aspect ratio."""
    import numpy as np
    h, w = img.shape[:2]
    if max(h, w) <= max_dim:
        return img
    scale = max_dim / max(h, w)
    new_w = int(w * scale)
    new_h = int(h * scale)
    try:
        import cv2
        return cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    except ImportError:
        from PIL import Image
        pil_img = Image.fromarray(img)
        pil_img = pil_img.resize((new_w, new_h), Image.LANCZOS)
        return np.array(pil_img)


def _run_ppocr(image_path: str) -> str:
    """Run PaddleOCR on a single image and return extracted text."""
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        print("PaddleOCR not installed. Install with: pip install paddleocr", file=sys.stderr)
        sys.exit(1)

    import numpy as np
    try:
        import cv2
        img = cv2.imread(image_path)
        if img is None:
            return ""
    except ImportError:
        from PIL import Image
        img = np.array(Image.open(image_path))

    img = _resize_if_needed(img)

    ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    result = ocr.ocr(img, cls=True)

    if not result or not result[0]:
        return ""

    lines = []
    for line in result[0]:
        if line and len(line) >= 2:
            text = line[1][0] if isinstance(line[1], (list, tuple)) else str(line[1])
            lines.append(text)

    return "\n".join(lines)


def mode_ocr(pdf_path: str, dpi: int = 200) -> str:
    """Extract text from PDF using PaddleOCR at the given DPI."""
    try:
        import fitz
    except ImportError:
        print("PyMuPDF not installed. Install with: pip install PyMuPDF", file=sys.stderr)
        sys.exit(1)

    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    all_text = []
    tmpdir = tempfile.mkdtemp(prefix="ppocr_")

    try:
        for page_num in range(total_pages):
            print(f"Processing page {page_num + 1}/{total_pages}...", file=sys.stderr)

            page = doc[page_num]
            pix = page.get_pixmap(matrix=matrix)
            img_path = os.path.join(tmpdir, f"page_{page_num + 1}.png")
            pix.save(img_path)

            page_text = _run_ppocr(img_path)
            all_text.append(page_text)

            # Clean up image
            os.remove(img_path)
    finally:
        doc.close()
        try:
            os.rmdir(tmpdir)
        except OSError:
            pass

    return "\f".join(all_text)


def main():
    parser = argparse.ArgumentParser(description="PaddleOCR PDF pipeline")
    parser.add_argument("pdf_path", help="Path to input PDF")
    parser.add_argument("--mode", default="ocr", choices=["ocr"], help="Processing mode")
    parser.add_argument("--model", default="ppocr", choices=["ppocr"], help="OCR model")
    parser.add_argument("--dpi", type=int, default=200, help="Resolution in DPI")
    args = parser.parse_args()

    if not os.path.isfile(args.pdf_path):
        print(json.dumps({"error": f"PDF not found: {args.pdf_path}"}), file=sys.stderr)
        sys.exit(1)

    text = mode_ocr(args.pdf_path, dpi=args.dpi)
    # Output the extracted text to stdout
    print(text)


if __name__ == "__main__":
    main()
