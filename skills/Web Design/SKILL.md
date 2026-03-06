---
name: web-design
description: Review files for web interface guideline compliance. Use when checking UI code quality or design consistency.
---

# Web Design Guidelines

> Review files for compliance with Web Interface Guidelines.

## Trigger

`/web-design [files]` or "review this UI" or "check design compliance"

## Execution Steps

### 1. Fetch Current Guidelines

```bash
# Guidelines are maintained at:
curl https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

### 2. Read Target Files

If files specified, read them. Otherwise ask user which files to review.

### 3. Validate Against Rules

Check each file against all guidelines.

### 4. Output Findings

Format: `file:line - [RULE] description`

## Core Guidelines

### Typography

- Use system font stacks or well-optimized web fonts
- Establish clear type hierarchy (heading, body, caption)
- Line height: 1.4-1.6 for body text
- Max line length: 65-75 characters

```css
/* Good font stack */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI',
  Roboto, Oxygen, Ubuntu, sans-serif;
```

### Color & Contrast

- WCAG AA minimum: 4.5:1 for normal text, 3:1 for large
- Define semantic color tokens (primary, secondary, error)
- Support dark mode via CSS custom properties

```css
:root {
  --color-text: #1a1a1a;
  --color-bg: #ffffff;
  --color-primary: #0066cc;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-text: #f0f0f0;
    --color-bg: #1a1a1a;
  }
}
```

### Spacing & Layout

- Use consistent spacing scale (4px, 8px, 16px, 24px, 32px, 48px)
- Apply CSS Grid/Flexbox for layouts
- Responsive breakpoints: 640px, 768px, 1024px, 1280px

```css
/* Spacing tokens */
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 1rem;     /* 16px */
--space-4: 1.5rem;   /* 24px */
--space-5: 2rem;     /* 32px */
--space-6: 3rem;     /* 48px */
```

### Interactive Elements

- Buttons: min 44x44px touch target
- Focus states: visible outline for keyboard nav
- Hover/active states for all interactive elements
- Loading states for async actions

```css
button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

button:active {
  transform: scale(0.98);
}
```

### Motion & Animation

- Respect prefers-reduced-motion
- Duration: 150-300ms for micro-interactions
- Use ease-out for entering, ease-in for exiting

```css
@media (prefers-reduced-motion: no-preference) {
  .element {
    transition: transform 200ms ease-out;
  }
}

@media (prefers-reduced-motion: reduce) {
  .element {
    transition: none;
  }
}
```

### Forms

- Labels above or beside inputs (not placeholder-only)
- Visible error states with helpful messages
- Disabled states clearly distinguished
- Proper input types (email, tel, number)

```html
<label for="email">Email</label>
<input
  type="email"
  id="email"
  aria-describedby="email-error"
  aria-invalid="true"
/>
<span id="email-error" role="alert">
  Please enter a valid email
</span>
```

### Accessibility

- Semantic HTML elements (nav, main, article, aside)
- ARIA labels where semantic HTML insufficient
- Skip links for keyboard navigation
- Alt text for meaningful images

```html
<a href="#main-content" class="skip-link">
  Skip to main content
</a>

<main id="main-content" tabindex="-1">
  <!-- content -->
</main>
```

### Performance

- Images: next/image or srcset for responsive
- Lazy load below-fold content
- Critical CSS inlined
- Fonts: font-display: swap

```html
<img
  src="hero.jpg"
  srcset="hero-400.jpg 400w, hero-800.jpg 800w"
  sizes="(max-width: 600px) 400px, 800px"
  loading="lazy"
  alt="Hero image"
/>
```

## Checklist

- [ ] Typography hierarchy established
- [ ] Color contrast meets WCAG AA
- [ ] Spacing uses consistent scale
- [ ] Touch targets ≥ 44px
- [ ] Focus states visible
- [ ] Motion respects preferences
- [ ] Forms properly labeled
- [ ] Semantic HTML used
- [ ] Images optimized/lazy-loaded

## Source

Based on Vercel Labs' web-interface-guidelines.
