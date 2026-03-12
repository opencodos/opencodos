---
name: agent-browser
description: Browser automation for web scraping and testing. Use for form filling, screenshots, and web interactions.
---

# Agent Browser

> Browser automation via CLI for web scraping, testing, and interactions.

## Trigger

`/browser` or "automate browser" or "scrape this page" or "fill this form"

## Core Workflow

1. **Navigate** to URL with `open`
2. **Snapshot** page state with `snapshot -i`
3. **Interact** using element references (@e1, @e2)
4. **Re-snapshot** after significant changes

## Navigation

```bash
# Open URL (auto-adds https://)
agent-browser open example.com

# Browser controls
agent-browser back
agent-browser forward
agent-browser reload

# Connect to existing Chrome
agent-browser connect 9222
```

## Page Analysis

```bash
# Interactive elements only (recommended)
agent-browser snapshot -i

# Compact output
agent-browser snapshot -c

# Scope to CSS selector
agent-browser snapshot -s "#main"

# Full page
agent-browser snapshot
```

## Element Interactions

```bash
# Click by reference
agent-browser click @e1

# Clear and type
agent-browser fill @e2 "hello@example.com"

# Key presses
agent-browser press Enter
agent-browser press Tab
agent-browser press Escape

# Dropdown selection
agent-browser select @e1 "option-value"

# Drag and drop
agent-browser drag @e1 @e2

# File uploads
agent-browser upload @e1 ./document.pdf

# Hover
agent-browser hover @e1
```

## Semantic Locators

```bash
# Find by role
agent-browser find role button click --name "Submit"

# Find by label
agent-browser find label "Email" fill "user@test.com"

# Find by text
agent-browser find text "Sign In" click

# Find by placeholder
agent-browser find placeholder "Search..." fill "query"
```

## Information Retrieval

```bash
# Extract text content
agent-browser get text @e1

# Get attribute
agent-browser get attr @e1 href

# Page metadata
agent-browser get title
agent-browser get url

# State checking
agent-browser is visible @e1
agent-browser is enabled @e1
agent-browser is checked @e1
```

## Waiting

```bash
# Wait for network idle
agent-browser wait --load networkidle

# Wait for element
agent-browser wait @e1

# Wait for navigation
agent-browser wait --load domcontentloaded

# Custom timeout (ms)
agent-browser wait @e1 --timeout 10000
```

## Screenshots & PDFs

```bash
# Screenshot
agent-browser screenshot output.png

# Full page
agent-browser screenshot --full page.png

# Element only
agent-browser screenshot @e1 element.png

# PDF generation
agent-browser pdf output.pdf
```

## Video Recording

```bash
# Start recording
agent-browser record start ./demo.webm

# Stop recording
agent-browser record stop

# With options
agent-browser record start ./demo.webm --size 1280x720
```

## Browser Configuration

```bash
# Viewport size
agent-browser set viewport 1920 1080

# Device emulation
agent-browser set device "iPhone 14"
agent-browser set device "iPad Pro"
agent-browser set device "Pixel 5"

# Geolocation
agent-browser set geo 37.7749 -122.4194

# Color scheme
agent-browser set media dark
agent-browser set media light

# Offline mode
agent-browser set offline on
agent-browser set offline off

# Timezone
agent-browser set timezone "America/New_York"
```

## State Management

```bash
# Save session (cookies, localStorage)
agent-browser state save auth.json

# Load session
agent-browser state load auth.json

# Cookie operations
agent-browser cookies get
agent-browser cookies set name value
agent-browser cookies clear

# Local storage
agent-browser storage local get key
agent-browser storage local set key value
agent-browser storage local clear
```

## Network Control

```bash
# Intercept requests
agent-browser network route "*/api/*"

# Block requests
agent-browser network route "*/ads/*" --abort

# Mock responses
agent-browser network route "*/api/user" --body '{"id": 1, "name": "Test"}'

# Modify headers
agent-browser network route "*" --headers '{"X-Custom": "value"}'
```

## Multi-Context

```bash
# Parallel sessions
agent-browser --session test1 open site1.com
agent-browser --session test2 open site2.com

# New tab
agent-browser tab new
agent-browser tab new https://example.com

# Switch tabs
agent-browser tab list
agent-browser tab switch 2

# Frame switching
agent-browser frame "#iframe-id"
agent-browser frame 0  # By index
```

## Global Options

```bash
--json              # Machine-readable output
--headed            # Display browser window
--proxy <url>       # Route through proxy
--cdp <port>        # Chrome DevTools Protocol
--executable-path   # Custom browser binary
--extension <path>  # Load extensions
--timeout <ms>      # Global timeout
```

## Common Workflows

### Form Submission
```bash
agent-browser open https://example.com/signup
agent-browser snapshot -i
agent-browser fill @e1 "John Doe"
agent-browser fill @e2 "john@example.com"
agent-browser fill @e3 "password123"
agent-browser click @e4  # Submit button
agent-browser wait --load networkidle
agent-browser snapshot -i
```

### Login & Save Session
```bash
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser state save auth.json
```

### Restore Session
```bash
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
agent-browser snapshot -i
```

### Screenshot Flow
```bash
agent-browser open https://example.com
agent-browser wait --load networkidle
agent-browser set viewport 1920 1080
agent-browser screenshot --full homepage.png
```

### Scrape Table Data
```bash
agent-browser open https://example.com/data
agent-browser snapshot -s "table"
agent-browser get text @e1  # Get table contents
```

## Debugging

```bash
# Visual mode
agent-browser --headed open example.com

# Console messages
agent-browser console

# Page errors
agent-browser errors

# Highlight element
agent-browser highlight @e1

# Performance trace
agent-browser trace start
# ... actions ...
agent-browser trace stop trace.zip
```

## Installation

```bash
npx skills add https://github.com/vercel-labs/agent-browser --skill agent-browser
```

## Source

Based on Vercel Labs' agent-browser skill.
