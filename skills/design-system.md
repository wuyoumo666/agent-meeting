# 设计系统规范 (Design System) — 审计设计 Token、组件变体/状态文档化与扩展新组件
> 来源：`C:\Users\18791\.codebuddy\plugins\marketplaces\cb_teams_marketplace\plugins\design-to-code\skills\design-system\SKILL.md`

Manage your design system — audit for consistency, document components, or design new patterns that fit the existing system.

## Components of a Design System

### Design Tokens
Atomic values that define the visual language:
- **Colors**: brand, semantic (success/warning/danger), neutral surfaces & text
- **Typography**: scale, weights, line heights
- **Spacing**: scale, component padding, pane gutters
- **Borders**: radius tiers (sm / md / lg), border hairlines
- **Shadows**: elevation levels (resting vs floating popovers/modals)
- **Motion**: durations, easings

### Components
Reusable UI elements with clearly defined:
- **Variants**: primary, secondary, ghost, danger
- **States**: default, hover, active, focus-visible, disabled, loading, error
- **Sizes**: sm, md, lg
- **Behavior**: interactions, animations
- **Accessibility**: ARIA roles, keyboard navigation

### Patterns
Common UI solutions combining components:
- Forms (input groups, validation, submission)
- Navigation (sidebar, tabs, breadcrumbs)
- Data display (tables, cards, lists)
- Feedback (banners, modals, inline messages)

## Principles

1. **Consistency over creativity** — Avoid one-off radii, colors, or ad-hoc icon styles.
2. **Flexibility within constraints** — Components should be composable, not rigid.
3. **Document everything** — Tokens and states should be explicit.
4. **Prioritize coverage** — Fix high-frequency hardcoded values and missing states first.

## Audit Checklist

1. **Naming & Token Coverage**: Find hardcoded hex colors, inconsistent border radii, arbitrary spacing, or mixed font sizes outside CSS variables.
2. **Component Completeness**: Verify every interactive component covers `default / hover / focus-visible / disabled / error / loading`.
3. **Priority Actions**: Rank fixes by visual impact and frequency across screens.
