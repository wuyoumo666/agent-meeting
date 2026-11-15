# 无障碍审查 (Accessibility Review) — 按 WCAG 2.1 AA 标准检查对比度、键盘导航、焦点管理与语义标签
> 来源：`C:\Users\18791\.codebuddy\plugins\marketplaces\cb_teams_marketplace\plugins\design-to-code\skills\accessibility-review\SKILL.md`

Audit a design or page for WCAG 2.1 AA accessibility compliance.

## WCAG 2.1 AA Quick Reference

### Perceivable
- **1.1.1** Non-text content has descriptive alt text (decorative icons use `aria-hidden="true"`)
- **1.3.1** Info and structure conveyed semantically (`header`, `nav`, `main`, `section`, headings in order)
- **1.4.3** Contrast ratio >= 4.5:1 (normal text), >= 3:1 (large text >= 18pt or 14pt bold)
- **1.4.11** Non-text contrast >= 3:1 (inputs, borders, active indicators, icons)

### Operable
- **2.1.1** All functionality available via keyboard (no click-only `div`s without button/role)
- **2.4.3** Logical focus order (restore focus to opener when closing dialogs/popovers)
- **2.4.7** Visible focus indicator (`:focus-visible` outline never removed without replacement)
- **2.5.5** Interactive target >= 44x44 CSS pixels on touch / comfortable hit area on desktop

### Understandable
- **3.2.1** Predictable on focus (no unexpected navigation/state shifts)
- **3.3.1** Error identification (`role="alert"`, describe what went wrong & how to fix)
- **3.3.2** Labels or `aria-label` for all inputs and icon-only buttons

### Robust
- **4.1.2** Name, role, state/value (`aria-expanded`, `aria-pressed`, `aria-selected`, `aria-current`)

## Common Issues to Check First
1. Insufficient color contrast (light gray text on light background)
2. Missing form labels or icon-only button `aria-label`
3. Missing keyboard escape (`Escape` closes popovers/modals) & focus traps in dialogs
4. Missing `prefers-reduced-motion` fallback
5. Layout breaking at narrow widths or 200% zoom
