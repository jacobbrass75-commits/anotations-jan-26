#!/usr/bin/env python3
"""Convert PDF pages to PNG images at a given DPI.

Usage:
    python pdf_to_images.py <pdf_path> <output_dir> [--dpi 200]

Outputs JSON to stdout:
    { "images": ["page_1.png", ...], "total_pages": N }
"""

import argparse
import json
import os
import sys

def main():
    parser = argparse.ArgumentParser(description="Convert PDF to images")
    parser.add_argument("pdf_path", help="Path to input PDF")
    parser.add_argument("output_dir", help="Directory to write PNG files")
    parser.add_argument("--dpi", type=int, default=200, help="Resolution in DPI")
    args = parser.parse_args()

    if not os.path.isfile(args.pdf_path):
        print(json.dumps({"error": f"PDF not found: {args.pdf_path}"}), file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)

    try:
        import fitz  # PyMuPDF
    except ImportError:
        print(json.dumps({"error": "PyMuPDF (fitz) is not installed. Install with: pip install PyMuPDF"}), file=sys.stderr)
        sys.exit(1)

    doc = fitz.open(args.pdf_path)
    total_pages = len(doc)
    images = []

    zoom = args.dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)

    for page_num in range(total_pages):
        page = doc[page_num]
        pix = page.get_pixmap(matrix=matrix)
        filename = f"page_{page_num + 1}.png"
        filepath = os.path.join(args.output_dir, filename)
        pix.save(filepath)
        images.append(filepath)

    doc.close()

    result = {"images": images, "total_pages": total_pages}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
