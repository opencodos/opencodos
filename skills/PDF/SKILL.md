---
name: pdf
description: Process PDF files - extract text, merge, split, convert tables, add watermarks. Use for any PDF manipulation task.
---

# PDF Processing

> Manipulate PDFs: extract, merge, split, convert, protect.

## Trigger

`/pdf [task]` or "extract text from PDF" or "merge these PDFs"

## Quick Reference

| Task | Tool | Command/Method |
|------|------|----------------|
| Extract text | pdfplumber | `page.extract_text()` |
| Extract tables | pdfplumber | `page.extract_tables()` |
| Merge PDFs | pypdf | `PdfWriter.append()` |
| Split PDF | pypdf | `PdfWriter.add_page()` |
| Create PDF | reportlab | `SimpleDocTemplate` |
| CLI text extract | pdftotext | `pdftotext -layout input.pdf` |
| CLI merge | qpdf | `qpdf --empty --pages *.pdf -- out.pdf` |
| OCR scanned | pytesseract | `image_to_string()` |

## Core Libraries

### pypdf — Read/Write/Merge/Split

```python
from pypdf import PdfReader, PdfWriter

# Read
reader = PdfReader("input.pdf")
text = reader.pages[0].extract_text()

# Merge
writer = PdfWriter()
for pdf in ["a.pdf", "b.pdf"]:
    writer.append(pdf)
writer.write("merged.pdf")

# Split (extract pages 1-5)
writer = PdfWriter()
for i in range(5):
    writer.add_page(reader.pages[i])
writer.write("first5.pdf")

# Rotate
page = reader.pages[0]
page.rotate(90)

# Password protect
writer.encrypt("userpass", "ownerpass")
```

### pdfplumber — Text & Table Extraction

```python
import pdfplumber

with pdfplumber.open("input.pdf") as pdf:
    # Extract text with layout
    for page in pdf.pages:
        text = page.extract_text()

    # Extract tables as list of lists
    tables = page.extract_tables()

    # To DataFrame
    import pandas as pd
    df = pd.DataFrame(tables[0][1:], columns=tables[0][0])
    df.to_excel("output.xlsx")
```

### reportlab — Create PDFs

```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("output.pdf", pagesize=letter)
c.drawString(100, 750, "Hello World")
c.showPage()
c.save()
```

## CLI Tools

### pdftotext (poppler-utils)

```bash
# Basic extraction
pdftotext input.pdf output.txt

# Preserve layout
pdftotext -layout input.pdf output.txt

# Specific pages
pdftotext -f 1 -l 5 input.pdf output.txt
```

### qpdf

```bash
# Merge
qpdf --empty --pages file1.pdf file2.pdf -- merged.pdf

# Extract pages
qpdf input.pdf --pages . 1-5 -- pages1-5.pdf

# Rotate page 1 by 90°
qpdf input.pdf output.pdf --rotate=+90:1

# Decrypt
qpdf --password=pass --decrypt encrypted.pdf decrypted.pdf

# Linearize (optimize for web)
qpdf --linearize input.pdf output.pdf
```

### pdfimages (poppler-utils)

```bash
# Extract all images
pdfimages -all input.pdf images/
```

## OCR for Scanned PDFs

```python
from pdf2image import convert_from_path
import pytesseract

# Convert PDF pages to images
images = convert_from_path("scanned.pdf")

# OCR each page
text = ""
for img in images:
    text += pytesseract.image_to_string(img)
```

## Common Workflows

### Extract All Text from PDF
```bash
pdftotext -layout document.pdf - | head -100
```

### Merge Multiple PDFs
```bash
qpdf --empty --pages *.pdf -- combined.pdf
```

### Extract Tables to Excel
```python
import pdfplumber
import pandas as pd

with pdfplumber.open("report.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables:
            df = pd.DataFrame(table[1:], columns=table[0])
            all_tables.append(df)

    # Combine and export
    result = pd.concat(all_tables)
    result.to_excel("tables.xlsx", index=False)
```

### Add Watermark
```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("document.pdf")
watermark = PdfReader("watermark.pdf")
writer = PdfWriter()

for page in reader.pages:
    page.merge_page(watermark.pages[0])
    writer.add_page(page)

writer.write("watermarked.pdf")
```

## Installation

```bash
# Python libraries
pip install pypdf pdfplumber reportlab pdf2image pytesseract

# CLI tools (macOS)
brew install poppler qpdf tesseract

# CLI tools (Ubuntu)
apt install poppler-utils qpdf tesseract-ocr
```

## Dependencies

- Python 3.8+
- poppler-utils (for pdftotext, pdfimages)
- qpdf (for advanced CLI operations)
- tesseract (for OCR)
