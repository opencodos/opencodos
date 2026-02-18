---
name: frontend-design
description: Create distinctive, production-grade UIs with persistent design memory. Maintains consistency across sessions.
---

# Frontend Design

> Create distinctive, production-grade interfaces that reject generic "AI slop" aesthetics.
> **Make design choices once. Apply them consistently.**

## Trigger

`/frontend-design` or "design this UI" or "make this look distinctive"

## Sub-Commands

| Command | Description |
|---------|-------------|
| `/frontend-design` | Default — design with current system |
| `/frontend-design:init` | Initialize project design system, choose direction |
| `/frontend-design:status` | Display current design system |
| `/frontend-design:audit <path>` | Verify code against established patterns |
| `/frontend-design:extract` | Extract patterns from existing code |

---

## Design Memory

Design decisions persist in `.frontend-design/system.md` at project root.

### How It Works

1. **On session start:** Check for `.frontend-design/system.md`
   - If exists → Load as design context
   - If not → Suggest running `/frontend-design:init`

2. **When designing:** State choices before building each component
   - Reference established patterns
   - Explain deviations

3. **After new decisions:** Offer to save to system.md

### System File Structure

```markdown
# Design System

## Direction
[Chosen direction name and rationale]

## Typography
- Display: [font]
- Body: [font]
- Mono: [font]
- Scale: [sizes]

## Color Tokens
- Background: [value]
- Surface: [value]
- Text: [value]
- Muted: [value]
- Accent: [value]
- Secondary: [value]

## Spacing Scale
[4px grid values]

## Component Patterns
[Buttons, cards, inputs specs]

## Animation Principles
[Motion guidelines]
```

---

## Design Directions

Choose ONE direction and commit. Each has distinct personality:

### 1. Precision & Density
*For: Dashboards, admin tools, power-user interfaces*
- Compact spacing, information-dense layouts
- Monospace accents, subtle borders
- Muted colors, high contrast text
- **Font:** JetBrains Mono + Inter
- **Accent:** Subtle blue or neutral

### 2. Warmth & Approachability
*For: Collaborative apps, consumer products*
- Generous whitespace, rounded corners (12-16px)
- Soft shadows, warm neutrals
- Friendly illustrations, subtle animations
- **Font:** Satoshi + General Sans
- **Accent:** Warm coral or amber

### 3. Sophistication & Trust
*For: Enterprise, finance, legal*
- Elegant typography, restrained palette
- Sharp corners, precise alignment
- Deep navy/charcoal backgrounds
- **Font:** Clash Display + Switzer
- **Accent:** Gold or deep teal

### 4. Boldness & Clarity
*For: Data-heavy apps, statements*
- High contrast, bold type
- Asymmetric layouts, unexpected grids
- Strong accent color (ONE)
- **Font:** Space Grotesk + Cabinet Grotesk
- **Accent:** Bright orange or electric blue

### 5. Utility & Function
*For: Developer tools, GitHub-style*
- Dense, scannable layouts
- Minimal chrome, content-first
- Monochrome with status colors
- **Font:** SF Mono + SF Pro
- **Accent:** Green (success) / Red (error)

### 6. Data & Analysis
*For: Analytics, visualization platforms*
- Clear data hierarchy, chart-optimized
- Muted UI, vibrant data colors
- Grid-based, mathematical spacing
- **Font:** IBM Plex Sans + IBM Plex Mono
- **Accent:** Data-viz palette

---

## Token Management

### Spacing Scale (4px base)

```css
:root {
  --space-0: 0;
  --space-1: 4px;    /* 0.25rem */
  --space-2: 8px;    /* 0.5rem */
  --space-3: 12px;   /* 0.75rem */
  --space-4: 16px;   /* 1rem */
  --space-5: 20px;   /* 1.25rem */
  --space-6: 24px;   /* 1.5rem */
  --space-8: 32px;   /* 2rem */
  --space-10: 40px;  /* 2.5rem */
  --space-12: 48px;  /* 3rem */
  --space-16: 64px;  /* 4rem */
  --space-20: 80px;  /* 5rem */
  --space-24: 96px;  /* 6rem */
}
```

### Color Token Template

```css
:root {
  /* Backgrounds */
  --color-bg: #0a0a0a;
  --color-surface: #141414;
  --color-surface-raised: #1f1f1f;

  /* Text */
  --color-text: #fafafa;
  --color-text-secondary: #a3a3a3;
  --color-text-muted: #737373;

  /* Accent (ONE primary) */
  --color-accent: #ff3e00;
  --color-accent-hover: #ff5722;
  --color-accent-muted: rgba(255, 62, 0, 0.1);

  /* Semantic */
  --color-success: #22c55e;
  --color-warning: #f59e0b;
  --color-error: #ef4444;
  --color-info: #3b82f6;

  /* Borders */
  --color-border: #262626;
  --color-border-subtle: #1a1a1a;
}
```

### Component Specs Template

```css
/* Buttons */
.btn {
  padding: var(--space-2) var(--space-4);
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-primary {
  background: var(--color-accent);
  color: white;
}

.btn-secondary {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
}

/* Cards */
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: var(--space-4);
}

/* Inputs */
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text);
}

.input:focus {
  border-color: var(--color-accent);
  outline: none;
}
```

---

## Design Thinking (Before Code)

### 1. Define Purpose
- What problem does this solve?
- Who is the target audience?
- What action should users take?

### 2. Choose a Tone
Pick a distinctive style and commit:

| Style | Characteristics |
|-------|-----------------|
| Minimalist | Whitespace, restraint, precision |
| Maximalist | Rich, layered, elaborate |
| Brutalist | Raw, honest, unconventional |
| Retro-futuristic | Nostalgic tech, neon, CRT vibes |
| Art Deco | Geometric, luxurious, bold |
| Organic | Flowing shapes, natural colors |

### 3. Define the Memorable Element
What makes this unforgettable? A hero animation? Unique navigation? Distinctive color?

> "Bold maximalism and refined minimalism both work—the key is intentionality, not intensity."

## Typography

### Avoid Generic Fonts
**NEVER use:** Arial, Inter, Roboto, Open Sans (unless intentionally ironic)

**DO use distinctive fonts:**
```css
/* Display fonts */
font-family: 'Space Grotesk', sans-serif;
font-family: 'Clash Display', sans-serif;
font-family: 'Cabinet Grotesk', sans-serif;

/* Body fonts */
font-family: 'Satoshi', sans-serif;
font-family: 'General Sans', sans-serif;
font-family: 'Switzer', sans-serif;
```

### Font Pairing Strategy
```css
:root {
  --font-display: 'Clash Display', sans-serif;
  --font-body: 'Satoshi', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

h1, h2, h3 { font-family: var(--font-display); }
body { font-family: var(--font-body); }
code { font-family: var(--font-mono); }
```

## Color & Theme

### Commit to Cohesive Aesthetics

**BAD:** Timid, evenly-distributed palettes
**GOOD:** Dominant colors with sharp accents

```css
/* Avoid the purple AI gradient cliché */
/* background: linear-gradient(to right, #6366f1, #8b5cf6); */

/* Bold monochromatic with accent */
:root {
  --color-bg: #0a0a0a;
  --color-surface: #141414;
  --color-text: #fafafa;
  --color-muted: #737373;
  --color-accent: #ff3e00;  /* ONE bold accent */
}

/* Or warm sophisticated palette */
:root {
  --color-bg: #f5f0eb;
  --color-surface: #ffffff;
  --color-text: #1a1614;
  --color-accent: #c45d3a;
  --color-secondary: #3d5a5b;
}
```

### Theme Implementation
```css
[data-theme="dark"] {
  --color-bg: #0a0a0a;
  --color-text: #fafafa;
}

[data-theme="light"] {
  --color-bg: #fafafa;
  --color-text: #0a0a0a;
}
```

## Motion & Animation

### One Well-Orchestrated Page Load
Better than scattered micro-interactions:

```css
/* Staggered reveal on load */
@keyframes reveal {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.hero { animation: reveal 0.6s ease-out forwards; }
.hero-subtitle { animation: reveal 0.6s ease-out 0.1s forwards; opacity: 0; }
.hero-cta { animation: reveal 0.6s ease-out 0.2s forwards; opacity: 0; }
.hero-image { animation: reveal 0.6s ease-out 0.3s forwards; opacity: 0; }
```

### Surprising Hover States
```css
.card {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.card:hover {
  transform: translateY(-8px) rotate(-1deg);
}

/* Or more dramatic */
.card:hover {
  transform: scale(1.02);
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    0 0 0 1px var(--color-accent);
}
```

### Scroll-Triggered Animation
```css
.reveal-on-scroll {
  opacity: 0;
  transform: translateY(40px);
  transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.reveal-on-scroll.visible {
  opacity: 1;
  transform: translateY(0);
}
```

```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal-on-scroll').forEach(el => {
  observer.observe(el);
});
```

## Spatial Composition

### Break the Grid
```css
/* Asymmetric hero layout */
.hero {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 4rem;
}

/* Overlapping elements */
.feature-image {
  position: relative;
  margin-left: -4rem;
  z-index: 1;
}

.feature-text {
  position: relative;
  margin-top: 3rem;
  z-index: 2;
}

/* Diagonal flow */
.diagonal-section {
  transform: skewY(-3deg);
  margin: 6rem 0;
}

.diagonal-section > * {
  transform: skewY(3deg);  /* Counter-rotate content */
}
```

## Backgrounds & Visual Details

### Gradient Meshes
```css
.mesh-bg {
  background:
    radial-gradient(at 40% 20%, #ff3e0020 0px, transparent 50%),
    radial-gradient(at 80% 0%, #ff8c0015 0px, transparent 50%),
    radial-gradient(at 0% 50%, #ff3e0010 0px, transparent 50%),
    var(--color-bg);
}
```

### Noise Texture
```css
.noise-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.03;
  pointer-events: none;
}
```

### Dramatic Shadows
```css
.elevated-card {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.05),
    0 4px 8px rgba(0, 0, 0, 0.05),
    0 16px 32px rgba(0, 0, 0, 0.1),
    0 32px 64px rgba(0, 0, 0, 0.1);
}
```

### Decorative Borders
```css
.accent-border {
  border-left: 3px solid var(--color-accent);
  padding-left: 1.5rem;
}

.gradient-border {
  border: 1px solid transparent;
  background:
    linear-gradient(var(--color-surface), var(--color-surface)) padding-box,
    linear-gradient(135deg, var(--color-accent), transparent) border-box;
}
```

## Avoid These (AI Slop)

- Purple/blue gradients (the Stripe clone look)
- Generic blob backgrounds
- Overused "glassmorphism"
- Inter + default Tailwind colors
- Centered everything
- Three-card layouts with icons
- "Hero → Features → Testimonials → CTA" template

## Checklist

- [ ] Distinctive font chosen (not Inter/Roboto)
- [ ] Color palette is intentional, not default
- [ ] One memorable visual element defined
- [ ] Page load animation orchestrated
- [ ] Hover states are surprising
- [ ] Layout breaks the grid somewhere
- [ ] Background has depth (texture/gradient)
- [ ] Design matches stated tone/style

---

## Command Workflows

### `/frontend-design:init`

Initialize a new design system for the project.

**Steps:**
1. Check if `.frontend-design/system.md` exists
   - If exists → Show current system, ask to override or extend
2. Analyze project context:
   - Read existing UI code if any
   - Check for existing design files (tailwind.config, global.css)
3. Present Design Directions (6 options) with brief descriptions
4. User selects direction
5. Generate `system.md` with:
   - Direction + rationale
   - Typography choices
   - Color tokens
   - Spacing scale
   - Component specs
6. Create `.frontend-design/system.md`
7. Suggest adding to `.gitignore` if desired (personal preference)

**Output:** `"Design system initialized with [Direction]. Saved to .frontend-design/system.md"`

---

### `/frontend-design:status`

Display the current design system.

**Steps:**
1. Read `.frontend-design/system.md`
   - If not found → Suggest running `:init`
2. Display formatted summary:
   - Direction name
   - Typography stack
   - Color tokens (visual swatches in terminal)
   - Spacing scale
   - Component count
3. Show last modified date

**Output:** Formatted design system overview

---

### `/frontend-design:audit <path>`

Check code against established design patterns.

**Steps:**
1. Load `.frontend-design/system.md`
   - If not found → Error, suggest `:init`
2. Read file(s) at `<path>` (glob supported)
3. Analyze for violations:
   - Off-system colors (hardcoded hex not in tokens)
   - Wrong font families
   - Non-standard spacing values
   - Missing hover states
   - Inconsistent border-radius
   - Generic patterns (Inter, purple gradients)
4. Output report:

```
## Audit: src/components/Button.tsx

✅ Passes
- Uses --color-accent correctly
- Spacing follows 4px grid

⚠️ Warnings
- Line 23: Hardcoded color #333 → use --color-text-secondary
- Line 45: font-family: Inter → use --font-body

❌ Violations
- Line 67: 15px padding → not on spacing scale (use 16px)
```

**Output:** Audit report with line-specific feedback

---

### `/frontend-design:extract`

Extract design patterns from existing code into system.md.

**Steps:**
1. Scan common locations:
   - `tailwind.config.js/ts`
   - `globals.css`, `styles/`, `app.css`
   - Component files for patterns
2. Extract:
   - Colors → Map to semantic tokens
   - Fonts → Identify display/body/mono
   - Spacing → Detect scale
   - Border-radius values
   - Shadow definitions
3. Generate `system.md` from extracted patterns
4. Show diff if system.md already exists
5. Confirm before saving

**Output:** `"Extracted design patterns from [N] files. Review and save?"`

---

## DESIGN.md Integration

If project has a `DESIGN.md` file at root, load it as additional context alongside `.frontend-design/system.md`.

**Priority:** DESIGN.md (project-specific) > system.md (generated)

---

## Source

Based on Anthropic's frontend-design skill + Dammyjay93/interface-design memory system.
