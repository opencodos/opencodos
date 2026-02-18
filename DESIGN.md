# Atlas Design System

> Design language for Atlas — AI Operating System for digital workers.

## Direction: Boldness & Clarity

**Rationale:** Atlas is a power-user tool for founders and operators. The design must:
- Feel premium and trustworthy (enterprise-grade)
- Be information-dense without feeling cluttered
- Use bold accent to signal action and AI activity
- Dark-first for reduced eye strain during long sessions

---

## Typography

### Font Stack (Implemented)

```css
:root {
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-body: 'Plus Jakarta Sans Variable', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono Variable', 'SF Mono', monospace;
}
```

| Role | Font | Package |
|------|------|---------|
| Display (h1-h6) | Space Grotesk | `@fontsource/space-grotesk` |
| Body | Plus Jakarta Sans | `@fontsource-variable/plus-jakarta-sans` |
| Mono (code) | JetBrains Mono | `@fontsource-variable/jetbrains-mono` |

### Type Scale

| Name | Size | Weight | Use |
|------|------|--------|-----|
| display-xl | 48px / 3rem | 600 | Hero headings |
| display-lg | 36px / 2.25rem | 600 | Page titles |
| display-md | 24px / 1.5rem | 600 | Section headers |
| heading | 18px / 1.125rem | 600 | Card titles |
| body | 14px / 0.875rem | 400 | Default text |
| small | 12px / 0.75rem | 400 | Labels, captions |
| tiny | 10px / 0.625rem | 500 | Badges, tags |

---

## Color Palette

### Core Colors (Dark Theme)

```css
:root {
  /* Backgrounds */
  --color-bg: #000000;              /* Pure black - main bg */
  --color-surface: #0a0a0a;          /* Elevated surface */
  --color-surface-raised: #141414;   /* Cards, modals */
  --color-surface-hover: #1a1a1a;    /* Hover states */

  /* Text */
  --color-text: #fafafa;             /* Primary text */
  --color-text-secondary: #a3a3a3;   /* Secondary text */
  --color-text-muted: #737373;       /* Muted, placeholders */
  --color-text-disabled: #525252;    /* Disabled states */

  /* Atlas Orange (Primary Accent) - Tailwind orange-500/400 */
  --color-accent: #f97316;           /* orange-500 - Primary */
  --color-accent-light: #fb923c;     /* orange-400 - Text on dark */
  --color-accent-hover: #ea580c;     /* orange-600 - Hover state */
  --color-accent-muted: rgba(249, 115, 22, 0.2);  /* orange-500/20 - Backgrounds */
  --color-accent-border: rgba(249, 115, 22, 0.3); /* orange-500/30 - Borders */
  --color-accent-subtle: rgba(249, 115, 22, 0.1); /* orange-500/10 - Hover bg */

  /* Semantic Colors */
  --color-success: #22c55e;
  --color-success-muted: rgba(34, 197, 94, 0.1);
  --color-warning: #f59e0b;
  --color-warning-muted: rgba(245, 158, 11, 0.1);
  --color-error: #ef4444;
  --color-error-muted: rgba(239, 68, 68, 0.1);
  --color-info: #3b82f6;
  --color-info-muted: rgba(59, 130, 246, 0.1);

  /* Borders */
  --color-border: rgba(255, 255, 255, 0.1);
  --color-border-subtle: rgba(255, 255, 255, 0.05);
  --color-border-strong: rgba(255, 255, 255, 0.2);
}
```

### Agent Colors

Each agent type has a distinctive color for quick recognition:

| Agent | Color | Hex |
|-------|-------|-----|
| Atlas (Main) | Orange | #ff5722 |
| Engineer | Blue | #3b82f6 |
| Researcher | Purple | #8b5cf6 |
| HR | Green | #22c55e |
| Designer | Pink | #ec4899 |
| Custom | Gray | #737373 |

---

## Spacing Scale (4px Grid)

```css
:root {
  --space-0: 0;
  --space-1: 4px;     /* 0.25rem - tight padding */
  --space-2: 8px;     /* 0.5rem - inline spacing */
  --space-3: 12px;    /* 0.75rem - compact padding */
  --space-4: 16px;    /* 1rem - standard padding */
  --space-5: 20px;    /* 1.25rem - comfortable */
  --space-6: 24px;    /* 1.5rem - card padding */
  --space-8: 32px;    /* 2rem - section gap */
  --space-10: 40px;   /* 2.5rem - large gap */
  --space-12: 48px;   /* 3rem - section padding */
  --space-16: 64px;   /* 4rem - major sections */
  --space-20: 80px;   /* 5rem - page margins */
  --space-24: 96px;   /* 6rem - hero spacing */
}
```

### Usage Guidelines

| Context | Spacing |
|---------|---------|
| Icon + text gap | space-2 (8px) |
| Button padding | space-2 × space-4 (8px × 16px) |
| Card padding | space-4 (16px) |
| Section gap | space-8 (32px) |
| Sidebar items | space-1 vertical (4px) |

---

## Component Patterns

### Buttons

**Two primary button styles exist in the codebase:**

| Variant | Use Case | Style |
|---------|----------|-------|
| **White Primary** | Wizard navigation, onboarding flows | `bg-white text-black` |
| **Orange Primary** | In-app actions, chat send, agent interactions | `bg-orange-500 text-white` |

```css
/* Base button */
.btn {
  padding: 8px 16px;
  border-radius: 6px;  /* rounded-lg in wizard: 8px */
  font-size: 14px;
  font-weight: 500;
  transition: all 0.15s ease;
  cursor: pointer;
}

/* Primary White - Setup/Onboarding contexts */
.btn-primary-white {
  background: white;
  color: black;
  border: none;
}
.btn-primary-white:hover {
  background: #e5e5e5;  /* gray-200 */
}

/* Primary Orange - In-app actions */
.btn-primary-orange {
  background: #f97316;  /* orange-500 */
  color: white;
  border: none;
}
.btn-primary-orange:hover {
  background: #ea580c;  /* orange-600 */
}

/* Secondary - ghost style */
.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: white;
  border: none;
}
.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* Ghost - minimal */
.btn-ghost {
  background: transparent;
  color: var(--color-text-secondary);
  border: none;
}
.btn-ghost:hover {
  background: rgba(255, 255, 255, 0.05);
  color: white;
}

/* Sizes */
.btn-sm { padding: 4px 12px; font-size: 12px; }
.btn-lg { padding: 12px 24px; font-size: 16px; }
```

### Cards

```css
.card {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 16px;
}

.card-interactive {
  transition: all 0.15s ease;
}
.card-interactive:hover {
  background: var(--color-surface-hover);
  border-color: var(--color-border-strong);
}

/* Card with accent border (selected/active) */
.card-selected {
  border-color: var(--color-accent-border);
  background: var(--color-accent-muted);
}
```

### Inputs

```css
.input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--color-text);
  font-size: 14px;
  transition: border-color 0.15s ease;
}

.input::placeholder {
  color: var(--color-text-muted);
}

.input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.input:disabled {
  background: var(--color-surface);
  color: var(--color-text-disabled);
  cursor: not-allowed;
}
```

### Badges / Tags

```css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.025em;
}

.badge-default {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text-secondary);
}

.badge-success {
  background: var(--color-success-muted);
  color: var(--color-success);
}

.badge-warning {
  background: var(--color-warning-muted);
  color: var(--color-warning);
}

.badge-error {
  background: var(--color-error-muted);
  color: var(--color-error);
}

.badge-accent {
  background: var(--color-accent-muted);
  color: var(--color-accent);
}
```

---

## Animation Principles

### Timing

| Type | Duration | Easing |
|------|----------|--------|
| Micro (hover, focus) | 150ms | ease |
| Small (expand, collapse) | 200ms | ease-out |
| Medium (modal, drawer) | 300ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Large (page transition) | 400ms | cubic-bezier(0.16, 1, 0.3, 1) |

### Motion Patterns

```css
/* Fade in */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Slide up (for modals, toasts) */
@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Scale in (for popovers) */
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* Pulse (for loading, AI activity) */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

### AI Activity Indicators

When Atlas or agents are working, use subtle animations:

```css
/* Orange pulse for active AI */
.ai-active {
  animation: pulse 2s ease-in-out infinite;
  box-shadow: 0 0 0 0 var(--color-accent-muted);
}

/* Typing indicator dots */
.typing-indicator span {
  animation: bounce 1.4s infinite ease-in-out;
}
.typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
.typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
```

---

## Layout Patterns

### Sidebar + Main + Panel (Dashboard)

```
┌────────────────────────────────────────────────────────────┐
│ Header (56px)                                    [Actions] │
├──────────┬────────────────────────────────┬────────────────┤
│ Sidebar  │                                │ Context Panel  │
│ (240px)  │     Main Content Area          │ (320px)        │
│          │                                │ (collapsible)  │
│          │                                │                │
└──────────┴────────────────────────────────┴────────────────┘
```

### Chat Layout

- Messages left-aligned
- AI responses have subtle accent border-left
- Tool calls shown inline with collapsible details
- Input fixed at bottom with @mention support

---

## Brand Identity

### Logo

- **Icon:** Stylized "A" in rounded square
- **Gradient:** `linear-gradient(135deg, #ff5722 0%, #ff8a65 100%)`
- **Sizes:** 24px (nav), 32px (header), 48px (landing)

### Voice & Tone

| Context | Tone |
|---------|------|
| Errors | Direct, helpful, no blame |
| Success | Brief confirmation, next action |
| Loading | Informative but not annoying |
| Empty states | Encouraging, actionable |

### Copy Guidelines

- Use active voice
- Be concise (shorter is better)
- No jargon — "agents" not "autonomous AI entities"
- Contractions OK (it's, you'll, we're)

---

## Border Radius (Tailwind Classes)

| Element | Class | Value |
|---------|-------|-------|
| Cards, modals | `rounded-2xl` | 16px |
| Inputs | `rounded-xl` | 12px |
| Buttons, small cards | `rounded-lg` | 8px |
| Icon containers | `rounded-md` | 6px |
| Badges, pills | `rounded-full` | 9999px |

---

## Checklist for New Components

- [ ] Uses spacing scale (no arbitrary values)
- [ ] Colors from token system (orange-500/400 for accents)
- [ ] Border-radius from table above
- [ ] Hover/focus states defined
- [ ] Dark theme tested (bg-black base)
- [ ] Animation follows timing guidelines
- [ ] Accessible (contrast, focus visible)

---

## Current State Notes

The codebase has some intentional variations:
- **Wizard navigation** uses white primary buttons (onboarding feel)
- **In-app actions** use orange primary buttons (brand actions)

### Design System Features (Implemented)

| Feature | Class | Description |
|---------|-------|-------------|
| **AI Activity Pulse** | `.ai-active` | Orange glow animation on active agents |
| **Page Load Animation** | `.reveal`, `.reveal-delay-1/2/3` | Staggered entrance animations |
| **Background Depth** | `.bg-mesh` | Subtle orange gradient mesh |
| **Surprise Hovers** | `.card-hover` | Cards lift + rotate on hover |
| **Typography** | CSS vars | Space Grotesk + Plus Jakarta Sans + JetBrains Mono |

---

*Last updated: 2026-01-27 — Design system improvements implemented*
