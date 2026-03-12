---
name: pricing-strategy
description: SaaS pricing and monetization strategy. Use when setting prices, designing tiers, or optimizing conversion.
---

# Pricing Strategy

> Value-based pricing for SaaS: capture value, drive growth, align with willingness to pay.

## Trigger

`/pricing` or "how should I price this" or "pricing strategy"

## Core Framework: Three Pricing Axes

Every pricing decision involves:

1. **Packaging** — Features, limits, support per tier
2. **Pricing Metric** — What you charge for
3. **Price Point** — Actual dollar amounts

## Value-Based Pricing

```
Cost (floor) ← Your Price → Customer Perceived Value (ceiling)
                    ↑
            Next Best Alternative
```

Price between the alternative and perceived value. Cost is a floor, not a foundation.

## Research Methods

### Van Westendorp Price Sensitivity

Ask four questions:
1. "At what price is this too expensive to consider?"
2. "At what price is this so cheap you'd question quality?"
3. "At what price does this start to seem expensive?"
4. "At what price is this a great bargain?"

**Results reveal:**
- Point of Marginal Cheapness
- Optimal Price Point
- Indifference Point
- Point of Marginal Expensiveness

### MaxDiff Analysis

Rank features through best-worst comparisons to inform tier differentiation.

## Value Metrics

| Metric | Best For | Example |
|--------|----------|---------|
| Per user/seat | Collaboration tools | Slack, Notion |
| Per usage | Infrastructure | AWS, Twilio |
| Per contact/record | Data platforms | HubSpot |
| Per transaction | Payments | Stripe |
| Flat fee | Simple products | Basecamp |
| Revenue share | Outcome-based | Shopify apps |

**Choose metrics that:**
- Scale with customer value
- Are easy to understand
- Create natural upgrade paths

## Tier Architecture

### Good-Better-Best Model

| Tier | Purpose | Features |
|------|---------|----------|
| Good | Entry barrier removal | Core features, limited usage |
| Better | Primary revenue | Full features, reasonable limits |
| Best | Premium capture | Advanced features, high limits |

### Differentiation Levers

- Feature gating (analytics, integrations)
- Usage limits (seats, API calls, storage)
- Support levels (community → email → dedicated)
- Access controls (SSO, audit logs, admin)

## Freemium vs. Free Trial

### Freemium Works When:
- Strong network effects
- Low marginal costs
- Clear upgrade triggers
- Viral growth potential

### Free Trial Works When:
- Product requires onboarding time
- B2B buying committees involved
- Complex implementation
- Value takes time to realize

**Credit card upfront:**
- With CC: 40-50% conversion
- Without CC: 15-25% conversion

## Price Increase Signals

### Market Signals
- Competitors raising prices
- Your pricing significantly below alternatives
- Prospects not flinching at price

### Business Signals
- Conversion rates > 40%
- Monthly churn < 3%
- Customers extracting more value than they pay

## Pricing Page Psychology

### Anchoring
Show expensive tier first (left side) to make others seem reasonable.

### Decoy Effect
Add option to make target tier look better:

```
Basic: $10
Plus: $22  ← Bad value (decoy)
Pro: $25   ← Obviously best choice
```

### Charm Pricing
- $99 feels significantly less than $100
- Use for consumer products
- Avoid for luxury/premium positioning

### Rule of 100
- Under $100: Use percentage ("20% off")
- Over $100: Use absolute ("$50 off")

### Annual Discount
- Show 17-20% savings
- Display as "2 months free"

## Communication Template (Price Increase)

```
Subject: Updates to [Product] pricing

Hi [Name],

[Context: why pricing is changing]

Starting [date], our pricing will be:
- [New pricing details]

For you specifically:
- [Exactly what changes for this customer]
- [Any grandfathering or grace period]

[Action required and deadline]

Thanks for being a customer.
```

## Enterprise Pricing

Add "Contact Sales" when:
- Deals exceed $10K+ ARR
- Custom contracts required
- Implementation support needed
- Security/compliance requirements

### Enterprise Features
- SSO/SAML
- Audit logs
- Admin controls
- SLA uptime guarantee
- Security certifications (SOC2, HIPAA)
- Dedicated support
- Custom onboarding

## Discovery Questions

Before pricing, answer:

1. What pricing research have you conducted?
2. Current ARPU and conversion rate?
3. How do you define your primary value metric?
4. Who are your pricing personas by size/use case?
5. Go-to-market model (self-serve, sales-led, hybrid)?
6. What pricing changes are you considering?

## Quick Reference

| Goal | Tactic |
|------|--------|
| Increase ARPU | Add premium tier, raise prices |
| Increase conversion | Lower entry tier, add freemium |
| Reduce churn | Annual plans, switching costs |
| Capture enterprise | Add Contact Sales, security features |
| Test pricing | A/B test on new visitors only |

## Anti-Patterns

- Pricing based on costs, not value
- Too many tiers (3-4 is optimal)
- Hidden pricing (kills trust)
- Identical features across tiers
- No clear "recommended" tier
- Complicated usage-based pricing

## Source

Based on coreyhaines31/marketingskills pricing-strategy skill.
