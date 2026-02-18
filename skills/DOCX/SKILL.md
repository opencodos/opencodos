---
name: docx
description: Create, edit, and analyze Word documents. Use for reports, contracts, and document manipulation.
---

# DOCX Processing

> Create, edit, and analyze Word documents.

## Trigger

`/docx [task]` or "create Word document" or "edit this document"

## Quick Reference

| Task | Tool | Method |
|------|------|--------|
| Extract text | pandoc | `pandoc file.docx -o output.md` |
| Create document | python-docx | Document/Paragraph API |
| Edit existing | python-docx | Load and modify |
| Track changes | XML manipulation | Direct OOXML editing |
| Access raw XML | unzip | DOCX is a ZIP archive |

## Reading Documents

### Extract Text with pandoc
```bash
# To markdown
pandoc document.docx -o output.md

# To plain text
pandoc document.docx -t plain -o output.txt

# With track changes visible
pandoc document.docx --track-changes=all -o output.md
```

### Read with python-docx
```python
from docx import Document

doc = Document("document.docx")

# Extract all text
for para in doc.paragraphs:
    print(para.text)

# Extract tables
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            print(cell.text)
```

### Access Raw XML
```bash
# DOCX files are ZIP archives
unzip -d unpacked/ document.docx

# Key paths:
# word/document.xml      - Main content
# word/styles.xml        - Style definitions
# word/comments.xml      - Comments
# word/footnotes.xml     - Footnotes
# word/media/            - Images
```

## Creating Documents

### Basic Document
```python
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

# Title
title = doc.add_heading("Document Title", 0)
title.alignment = WD_ALIGN_PARAGRAPH.CENTER

# Paragraph
doc.add_paragraph("This is a normal paragraph with some text.")

# Formatted text
para = doc.add_paragraph()
para.add_run("Bold text").bold = True
para.add_run(" and ")
para.add_run("italic text").italic = True

# Bullet list
doc.add_paragraph("First item", style="List Bullet")
doc.add_paragraph("Second item", style="List Bullet")
doc.add_paragraph("Third item", style="List Bullet")

# Numbered list
doc.add_paragraph("Step one", style="List Number")
doc.add_paragraph("Step two", style="List Number")

doc.save("output.docx")
```

### With Tables
```python
from docx import Document
from docx.shared import Inches

doc = Document()
doc.add_heading("Sales Report", 1)

# Create table
table = doc.add_table(rows=1, cols=3)
table.style = "Table Grid"

# Header row
headers = table.rows[0].cells
headers[0].text = "Product"
headers[1].text = "Q1 Sales"
headers[2].text = "Q2 Sales"

# Data rows
data = [
    ("Product A", "$10,000", "$12,000"),
    ("Product B", "$8,000", "$9,500"),
    ("Product C", "$15,000", "$14,000"),
]

for product, q1, q2 in data:
    row = table.add_row().cells
    row[0].text = product
    row[1].text = q1
    row[2].text = q2

doc.save("report.docx")
```

### With Images
```python
from docx import Document
from docx.shared import Inches

doc = Document()
doc.add_heading("Report with Image", 1)

doc.add_paragraph("Here is the chart:")
doc.add_picture("chart.png", width=Inches(5))

doc.save("report.docx")
```

## Editing Existing Documents

### Replace Text
```python
from docx import Document

doc = Document("template.docx")

replacements = {
    "{{NAME}}": "John Smith",
    "{{DATE}}": "January 24, 2026",
    "{{COMPANY}}": "Acme Corp"
}

for para in doc.paragraphs:
    for old, new in replacements.items():
        if old in para.text:
            for run in para.runs:
                if old in run.text:
                    run.text = run.text.replace(old, new)

# Also check tables
for table in doc.tables:
    for row in table.rows:
        for cell in row.cells:
            for para in cell.paragraphs:
                for old, new in replacements.items():
                    if old in para.text:
                        for run in para.runs:
                            if old in run.text:
                                run.text = run.text.replace(old, new)

doc.save("filled.docx")
```

### Modify Styles
```python
from docx import Document
from docx.shared import Pt, RGBColor

doc = Document("document.docx")

# Modify all headings
for para in doc.paragraphs:
    if para.style.name.startswith("Heading"):
        for run in para.runs:
            run.font.size = Pt(16)
            run.font.color.rgb = RGBColor(0, 51, 102)

doc.save("styled.docx")
```

## Track Changes (Redlining)

For tracked changes, work with raw XML:

```python
import zipfile
from lxml import etree

# Unpack
with zipfile.ZipFile("document.docx", 'r') as z:
    z.extractall("unpacked/")

# Edit document.xml
tree = etree.parse("unpacked/word/document.xml")
root = tree.getroot()

# Find and modify tracked changes
nsmap = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

for ins in root.findall('.//w:ins', nsmap):
    # Process insertions
    pass

for delete in root.findall('.//w:del', nsmap):
    # Process deletions
    pass

# Save
tree.write("unpacked/word/document.xml", xml_declaration=True, encoding="UTF-8")

# Repack
with zipfile.ZipFile("modified.docx", 'w') as z:
    for root_dir, dirs, files in os.walk("unpacked/"):
        for file in files:
            filepath = os.path.join(root_dir, file)
            arcname = os.path.relpath(filepath, "unpacked/")
            z.write(filepath, arcname)
```

## Node.js Alternative (docx-js)

```javascript
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import * as fs from "fs";

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        text: "Document Title",
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph({
        children: [
          new TextRun("Hello "),
          new TextRun({ text: "World", bold: true }),
        ],
      }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync("output.docx", buffer);
```

## CLI Operations

### Convert Formats
```bash
# DOCX to PDF
pandoc document.docx -o output.pdf

# Or with LibreOffice (better formatting)
soffice --headless --convert-to pdf document.docx

# DOCX to HTML
pandoc document.docx -o output.html
```

## Installation

```bash
# Python
pip install python-docx lxml

# Node.js
npm install docx

# CLI tools
brew install pandoc libreoffice  # macOS
apt install pandoc libreoffice  # Ubuntu
```

## Dependencies

- python-docx (Python manipulation)
- docx (Node.js creation)
- pandoc (format conversion)
- lxml (XML manipulation)
- LibreOffice (PDF conversion)
