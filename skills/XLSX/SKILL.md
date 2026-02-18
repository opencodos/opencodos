---
name: xlsx
description: Create, edit, and analyze Excel spreadsheets. Use for data, financial models, and spreadsheet automation.
---

# XLSX Processing

> Create, edit, and analyze Excel spreadsheets with proper formulas.

## Trigger

`/xlsx [task]` or "create spreadsheet" or "edit this Excel file"

## Quick Reference

| Task | Tool | Method |
|------|------|--------|
| Read data | pandas | `pd.read_excel()` |
| Write data | pandas | `df.to_excel()` |
| Complex formatting | openpyxl | Workbook/Worksheet API |
| Add formulas | openpyxl | Cell formula assignment |
| Recalculate | LibreOffice | `recalc.py` script |

## Critical Rules

### 1. Zero Formula Errors
Every spreadsheet must be error-free. Check for:
- `#REF!` — Invalid reference
- `#DIV/0!` — Division by zero
- `#VALUE!` — Wrong value type
- `#N/A` — Value not available
- `#NAME?` — Unrecognized formula

### 2. Use Formulas, Not Hardcoded Values
```python
# BAD: Computing in Python
total = sum(values)
ws['B10'] = total

# GOOD: Excel formula
ws['B10'] = '=SUM(B2:B9)'
```

### 3. Preserve Template Formatting
When editing existing files, match the original style exactly.

## Reading Excel Files

### With pandas
```python
import pandas as pd

# Read entire sheet
df = pd.read_excel("data.xlsx")

# Read specific sheet
df = pd.read_excel("data.xlsx", sheet_name="Sheet2")

# Read specific columns
df = pd.read_excel("data.xlsx", usecols=["A", "B", "C"])

# Skip rows
df = pd.read_excel("data.xlsx", skiprows=2)
```

### With openpyxl
```python
from openpyxl import load_workbook

wb = load_workbook("data.xlsx")
ws = wb.active

# Read cell
value = ws['A1'].value

# Read range
for row in ws.iter_rows(min_row=1, max_row=10, min_col=1, max_col=3):
    for cell in row:
        print(cell.value)
```

## Creating Spreadsheets

### Basic with pandas
```python
import pandas as pd

data = {
    "Product": ["A", "B", "C"],
    "Q1": [100, 200, 150],
    "Q2": [120, 180, 160]
}
df = pd.DataFrame(data)
df.to_excel("output.xlsx", index=False)
```

### With Formatting (openpyxl)
```python
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
from openpyxl.utils import get_column_letter

wb = Workbook()
ws = wb.active
ws.title = "Revenue Model"

# Headers
headers = ["Product", "Q1", "Q2", "Q3", "Q4", "Total"]
for col, header in enumerate(headers, 1):
    cell = ws.cell(row=1, column=col, value=header)
    cell.font = Font(bold=True)
    cell.fill = PatternFill("solid", fgColor="4472C4")
    cell.font = Font(bold=True, color="FFFFFF")

# Data rows with formulas
data = [
    ["Product A", 100, 120, 140, 160],
    ["Product B", 200, 180, 220, 240],
    ["Product C", 150, 160, 170, 180],
]

for row_idx, row_data in enumerate(data, 2):
    for col_idx, value in enumerate(row_data, 1):
        ws.cell(row=row_idx, column=col_idx, value=value)
    # Total formula
    ws.cell(row=row_idx, column=6, value=f"=SUM(B{row_idx}:E{row_idx})")

# Column widths
for col in range(1, 7):
    ws.column_dimensions[get_column_letter(col)].width = 12

wb.save("output.xlsx")
```

## Financial Model Standards

### Color Coding
| Color | Usage |
|-------|-------|
| Blue text | Hardcoded inputs (user can change) |
| Black text | Formulas and calculations |
| Green text | Links within worksheet |
| Red text | External file links |
| Yellow fill | Key assumptions |

```python
from openpyxl.styles import Font, PatternFill

# Input cell (blue)
cell.font = Font(color="0000FF")

# Formula cell (black)
cell.font = Font(color="000000")

# Key assumption (yellow)
cell.fill = PatternFill("solid", fgColor="FFFF00")
```

### Number Formats
```python
# Currency
cell.number_format = '$#,##0'

# Percentage
cell.number_format = '0.0%'

# Multiples
cell.number_format = '0.0x'

# Negative in parentheses
cell.number_format = '$#,##0_);($#,##0)'

# Zeros as dash
cell.number_format = '$#,##0;($#,##0);"-"'
```

## Common Formulas

```python
# Sum
ws['B10'] = '=SUM(B2:B9)'

# Average
ws['B11'] = '=AVERAGE(B2:B9)'

# VLOOKUP
ws['C2'] = '=VLOOKUP(A2,Data!A:B,2,FALSE)'

# IF statement
ws['D2'] = '=IF(C2>100,"High","Low")'

# Compound growth
ws['B3'] = '=B2*(1+$C$1)'

# NPV
ws['B15'] = '=NPV(B1,B3:B12)+B2'
```

## Recalculate Formulas

Use LibreOffice to recalculate and check for errors:

```python
import subprocess
import json

def recalculate(filepath):
    """Recalculate Excel file and check for errors."""
    result = subprocess.run([
        "soffice", "--headless", "--calc",
        "--accept=socket,host=localhost,port=2002;urp;",
        filepath
    ], capture_output=True)

    # Then scan for errors
    from openpyxl import load_workbook
    wb = load_workbook(filepath)
    errors = []
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if isinstance(cell.value, str) and cell.value.startswith('#'):
                    errors.append({
                        "sheet": ws.title,
                        "cell": cell.coordinate,
                        "error": cell.value
                    })
    return errors
```

## Installation

```bash
# Python
pip install pandas openpyxl xlsxwriter

# For recalculation
brew install libreoffice  # macOS
apt install libreoffice-calc  # Ubuntu
```

## Dependencies

- pandas (data manipulation)
- openpyxl (Excel read/write with formatting)
- xlsxwriter (alternative writer with charts)
- LibreOffice (formula recalculation)
