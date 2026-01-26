#!/usr/bin/env python3
"""Extract screenshot images from specific PDF pages for vision analysis."""

import argparse
import json
import os
import sys
import tempfile

from pdf2image import convert_from_path


def extract_screenshots(pdf_path: str, pages: list[int], output_dir: str) -> dict:
    """Convert specific PDF pages to PNG images.

    Args:
        pdf_path: Path to the PDF file.
        pages: List of 0-indexed page numbers to extract.
        output_dir: Directory to save screenshot PNGs.

    Returns:
        Dict with screenshot paths and total page count.
    """
    # Get total page count by converting just the first page with minimal DPI
    all_pages = convert_from_path(pdf_path, dpi=20, first_page=1, last_page=1)
    # To get total pages, we need to convert all (but at very low DPI just to count)
    # pdf2image doesn't expose page count directly, so use pdfinfo
    try:
        from pdf2image.pdf2image import pdfinfo_from_path
        info = pdfinfo_from_path(pdf_path)
        total_pages = info["Pages"]
    except Exception:
        # Fallback: convert all pages at minimal quality just to count
        all_imgs = convert_from_path(pdf_path, dpi=10)
        total_pages = len(all_imgs)

    # Filter valid page numbers
    valid_pages = [p for p in pages if 0 <= p < total_pages]
    if not valid_pages:
        valid_pages = [0]

    screenshots = []
    for page_num in valid_pages:
        # pdf2image uses 1-indexed pages
        images = convert_from_path(
            pdf_path,
            dpi=150,
            first_page=page_num + 1,
            last_page=page_num + 1,
        )
        if images:
            filename = f"page_{page_num}.png"
            filepath = os.path.join(output_dir, filename)
            images[0].save(filepath, "PNG")
            screenshots.append(filepath)

    return {
        "screenshots": screenshots,
        "total_pages": total_pages,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract PDF page screenshots")
    parser.add_argument("--pdf_path", required=True, help="Path to the PDF file")
    parser.add_argument(
        "--pages",
        required=True,
        help="Comma-separated 0-indexed page numbers",
    )
    parser.add_argument(
        "--output_dir",
        required=False,
        help="Directory to save screenshots (auto-created temp dir if omitted)",
    )
    args = parser.parse_args()

    pages = [int(p.strip()) for p in args.pages.split(",") if p.strip()]

    output_dir = args.output_dir
    if not output_dir:
        output_dir = tempfile.mkdtemp(prefix="pdf_screenshots_")
    os.makedirs(output_dir, exist_ok=True)

    result = extract_screenshots(args.pdf_path, pages, output_dir)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
