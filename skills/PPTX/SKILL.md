---
name: pptx
description: Create, edit, and analyze PowerPoint presentations. Use for slides, decks, and presentation manipulation.
---

# PPTX Processing

> Create, edit, and analyze PowerPoint presentations.

## Trigger

`/pptx [task]` or "create a presentation" or "edit this PowerPoint"

## Quick Reference

| Task | Tool | Method |
|------|------|--------|
| Extract text | markitdown | `python -m markitdown file.pptx` |
| Create slides | html2pptx | HTML → PptxGenJS conversion |
| Edit template | rearrange.py | Slide manipulation scripts |
| Convert to PDF | LibreOffice | `soffice --convert-to pdf` |
| Access raw XML | unzip | PPTX is a ZIP archive |

## Reading & Analysis

### Extract Text
```bash
# Quick text extraction
python -m markitdown presentation.pptx

# Or convert to markdown
pandoc presentation.pptx -o output.md
```

### Access Raw XML
```bash
# PPTX files are ZIP archives
unzip -d unpacked/ presentation.pptx

# Key paths:
# ppt/slides/slide{N}.xml     - Slide content
# ppt/theme/theme1.xml        - Colors and fonts
# ppt/notesSlides/            - Speaker notes
# ppt/comments/               - Comments
```

## Creating Presentations

### Method 1: HTML to PPTX (Recommended)

Design slides in HTML first, then convert:

```html
<!-- 16:9 aspect ratio: 720pt × 405pt -->
<div class="slide" style="width: 720pt; height: 405pt;">
  <h1>Title Here</h1>
  <ul>
    <li>Point one</li>
    <li>Point two</li>
  </ul>
</div>
```

Convert using PptxGenJS:

```javascript
import PptxGenJS from "pptxgenjs";

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_16x9";

const slide = pptx.addSlide();
slide.addText("Title Here", {
  x: 0.5, y: 0.5,
  fontSize: 36,
  bold: true
});

slide.addText([
  { text: "• Point one\n", options: { fontSize: 18 } },
  { text: "• Point two", options: { fontSize: 18 } }
], { x: 0.5, y: 1.5 });

await pptx.writeFile("output.pptx");
```

### Method 2: python-pptx

```python
from pptx import Presentation
from pptx.util import Inches, Pt

prs = Presentation()
prs.slide_width = Inches(13.333)  # 16:9
prs.slide_height = Inches(7.5)

# Add title slide
layout = prs.slide_layouts[0]
slide = prs.slides.add_slide(layout)
slide.shapes.title.text = "Presentation Title"
slide.placeholders[1].text = "Subtitle here"

# Add content slide
layout = prs.slide_layouts[1]
slide = prs.slides.add_slide(layout)
slide.shapes.title.text = "Content Slide"

body = slide.placeholders[1]
tf = body.text_frame
tf.text = "First bullet"
p = tf.add_paragraph()
p.text = "Second bullet"
p.level = 1

prs.save("output.pptx")
```

## Template-Based Editing

### Rearrange Slides
```python
from pptx import Presentation

prs = Presentation("template.pptx")

# Get slide order
slides = list(prs.slides)

# Reorder: move slide 3 to position 1
xml_slides = prs.slides._sldIdLst
slides_to_move = [xml_slides[2]]  # 0-indexed
for slide in slides_to_move:
    xml_slides.remove(slide)
xml_slides.insert(0, slide)

prs.save("reordered.pptx")
```

### Replace Text in Template
```python
from pptx import Presentation

prs = Presentation("template.pptx")

replacements = {
    "{{COMPANY}}": "Acme Corp",
    "{{DATE}}": "January 2026",
    "{{REVENUE}}": "$10M"
}

for slide in prs.slides:
    for shape in slide.shapes:
        if shape.has_text_frame:
            for para in shape.text_frame.paragraphs:
                for run in para.runs:
                    for old, new in replacements.items():
                        if old in run.text:
                            run.text = run.text.replace(old, new)

prs.save("filled.pptx")
```

## Design Guidelines

### Web-Safe Fonts Only
- Arial, Helvetica, Verdana
- Georgia, Times New Roman
- Courier New, Trebuchet MS

### Color Palettes

| Name | Primary | Secondary | Accent |
|------|---------|-----------|--------|
| Classic Blue | #1E3A5F | #4A7C9B | #E8F1F8 |
| Modern Gray | #2D3436 | #636E72 | #DFE6E9 |
| Warm Orange | #E17055 | #FDCB6E | #FFEAA7 |
| Forest Green | #27AE60 | #2ECC71 | #A9DFBF |

### Slide Dimensions
- **16:9** (default): 13.333" × 7.5" (720pt × 405pt)
- **4:3** (legacy): 10" × 7.5"

## CLI Operations

### Convert to PDF
```bash
soffice --headless --convert-to pdf presentation.pptx
```

### Convert to Images
```bash
# PDF first, then images
soffice --headless --convert-to pdf presentation.pptx
pdftoppm presentation.pdf slide -png
```

## Installation

```bash
# Python
pip install python-pptx markitdown

# Node.js
npm install pptxgenjs

# CLI tools (macOS)
brew install libreoffice poppler

# CLI tools (Ubuntu)
apt install libreoffice poppler-utils
```

## Dependencies

- python-pptx (Python manipulation)
- pptxgenjs (Node.js creation)
- markitdown (text extraction)
- LibreOffice (PDF conversion)
- Poppler (PDF to images)
