---
name: signup-flow-cro
description: Optimize signup flows for higher conversion. Use when improving registration, onboarding, or trial signup.
---

# Signup Flow CRO

> Reduce friction and increase completion rates in signup flows.

## Trigger

`/signup-cro` or "optimize signup flow" or "improve registration conversion"

## Four Foundational Principles

### 1. Minimize Required Fields
Every field is a conversion barrier.

| Priority | Fields | When to Ask |
|----------|--------|-------------|
| Essential | Email, password | Always |
| Often needed | Name | If used immediately |
| Deferrable | Company, role, team size, phone | Progressive profiling |

**Question:** Can you collect this later?

### 2. Show Value Before Commitment
Present product value BEFORE requesting account creation.

```
Traditional: Landing → Signup → Product
Better: Landing → Product Preview → Signup
```

### 3. Reduce Perceived Effort
- Progress indicators for multi-step
- Group related fields
- Smart defaults
- Pre-fill when possible

### 4. Remove Uncertainty
- Set expectations ("Takes 30 seconds")
- Preview what happens next
- Eliminate surprises

## Field-by-Field Optimization

### Email
```
✅ Single field
✅ Inline format validation
✅ Common typo detection (gmial → gmail)
✅ Clear error messages
```

### Password
```
✅ Show/hide toggle
✅ Requirements shown upfront
✅ Real-time strength indicator
✅ Allow paste functionality
❌ "Retype password" (use show toggle instead)
```

### Name
- Test full-name vs first/last split
- Make optional unless immediately used
- Placeholder: "How should we call you?"

### Social Auth
```
Position: Prominent, above email form
B2C priority: Google > Apple > Facebook
B2B priority: Google > Microsoft > SSO

Copy: "Continue with Google" (not "Sign in with")
```

### Phone
- Defer unless essential for product
- If required, explain why
- Auto-format as typing
- Country code detection

### Company/Role
- Defer to onboarding when possible
- Use auto-suggest for company
- Infer from email domain

## Flow Architecture

### Single-Step Flow
**Best for:**
- 3 or fewer fields
- Simple B2C products
- High-intent visitors (from ads, referrals)

```
┌─────────────────────────┐
│  Email                  │
│  Password               │
│  [Create Account]       │
│                         │
│  — or continue with —   │
│  [Google] [Apple]       │
└─────────────────────────┘
```

### Multi-Step Flow
**Best for:**
- 4+ required fields
- Complex B2B segmentation
- Need progressive profiling

```
Step 1: Email + Password (easy start)
Step 2: Name + Company (after commitment)
Step 3: Role + Use case (personalization)
```

**Rules:**
- Show progress indicator
- Start with easiest questions
- Place harder questions later (commitment bias)
- Allow back navigation
- Save progress between steps

## Trust & Friction Reduction

### Trust Signals
```
"No credit card required"
"14-day free trial"
"Cancel anytime"
"Used by 10,000+ teams"
[Security badges]
[Customer logos]
```

### Error Handling
```
❌ "Invalid input"
✅ "Please enter a valid email address (e.g., you@company.com)"

❌ "Error"
✅ "This email is already registered. Log in instead?"
```

### Mobile Optimization
- 44px+ touch targets
- Appropriate keyboard types (email, tel, number)
- Autofill support
- Sticky CTA button
- Minimal scrolling

## Post-Submit Experience

### Confirmation
```
✅ Clear success message
✅ Immediate next step
✅ What to expect
❌ Dead-end "Thanks" page
```

### Email Verification
```
Best practices:
- Explain why verification needed
- Easy resend option
- Check spam reminder
- Allow product exploration during verification
- Consider magic links over codes
```

## Flow Patterns by Business Type

### B2B SaaS
```
Step 1: Email + Password (or SSO)
Step 2: Name + Company
Step 3: → Onboarding
```

### B2C App
```
Social auth OR Email → Product → Profile later
```

### Waitlist
```
Email only → Optional: Role/Use case → Confirmation + position
```

### E-commerce
```
Guest checkout (default) → Optional account post-purchase
```

## Measurement Framework

### Core Metrics
| Metric | Target |
|--------|--------|
| Form start rate | 30-50% of page visitors |
| Completion rate | 60-80% of starters |
| Time to complete | <60 seconds |
| Error rate | <5% of submissions |

### Field-Level Analysis
Track for each field:
- Drop-off rate
- Time spent
- Error frequency
- Correction rate

## High-Impact Experiments

### Layout
- Single vs multi-step
- Social auth prominence
- Field order

### Copy
- Button text ("Create Account" vs "Start Free Trial")
- Field labels
- Error messages
- Trust signals

### Friction
- Field count reduction
- Optional vs required
- Email verification timing
- Credit card requirement

### Design
- Progress indicators
- Form width
- Mobile vs desktop
- Button color/size

## Optimization Checklist

- [ ] Can any fields be removed?
- [ ] Can any fields be deferred?
- [ ] Is social auth prominent?
- [ ] Are error messages helpful?
- [ ] Is mobile experience smooth?
- [ ] Is progress clear (if multi-step)?
- [ ] Does post-submit guide next action?
- [ ] Are trust signals visible?
- [ ] Is the CTA benefit-focused?
- [ ] Can users preview value before signup?

## Quick Wins

1. Remove one field (biggest impact)
2. Add "Continue with Google"
3. Change CTA to benefit-focused
4. Add "No credit card required"
5. Show password toggle
6. Fix error messages to be specific

## Source

Based on coreyhaines31/marketingskills signup-flow-cro skill.
