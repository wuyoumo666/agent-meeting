# 设计评审与视觉走查 (Design Critique) — 对 UI 截图、原型或界面代码做可用性、层级与一致性评审
> 来源：`C:\Users\18791\.codebuddy\plugins\marketplaces\cb_teams_marketplace\plugins\design-to-code\skills\design-critique\SKILL.md`

Get structured design feedback across multiple dimensions at any stage from exploration to final polish.

## Critique Framework

### 1. First Impression (2 seconds)
- What draws the eye first? Is that the intended primary element?
- What is the emotional/aesthetic reaction?
- Is the purpose immediately clear?

### 2. Usability
- Can the user accomplish their goal without friction?
- Is the navigation intuitive?
- Are interactive elements obvious (affordance)?
- Are there unnecessary clicks, steps, or duplicated controls?

### 3. Visual Hierarchy
- Is there a clear reading order?
- Are the right elements emphasized while secondary info recedes?
- Is whitespace used effectively to group and separate?
- Does typography (size, weight, contrast) create clear hierarchy?

### 4. Consistency
- Does it follow a unified design system (tokens, radii, icon style)?
- Are spacing, colors, and typography consistent across panes?
- Do similar elements behave similarly?

### 5. Accessibility
- Color contrast ratios
- Touch / click target sizes
- Text readability and line height
- Alternative text & keyboard navigation

## How to Give Feedback

- **Be specific**: Point to the exact element/pattern ("The CTA competes with the top navigation") rather than vague feelings.
- **Explain why**: Connect feedback to design principles or user needs.
- **Suggest concrete alternatives**: Don't just identify problems — propose specific layout/color/copy fixes.
- **Acknowledge what works**: Include positive observations.
- **Match the stage**: Early exploration gets structural feedback; final polish gets spacing/detail feedback.

## Output Template

```markdown
## Design Critique: [Design Name]

### Overall Impression
[1-2 sentence first reaction — what works, what's the biggest opportunity]

### Usability & Hierarchy
| Finding | Severity | Recommendation |
|---------|----------|----------------|
| [Issue] | Critical / Moderate / Minor | [Fix] |

### Consistency & Accessibility
- **Typography / spacing / color**: [Inconsistency & fix]
- **Contrast / targets / readability**: [Check result]

### What Works Well
- [Positive observation]

### Priority Recommendations
1. **[Most impactful change]** — [Why and how]
2. **[Second priority]** — [Why and how]
3. **[Third priority]** — [Why and how]
```
