# 品牌视觉规范 (Brand Guidelines) — 应用统一的暖调编辑风配色与标题/正文字体排版体系
> 来源：`C:\Users\18791\.zcode\cli\plugins\cache\zcode-plugins-official\design\0.7.2\skills\design\design-resources\skills\brand-guidelines\SKILL.md`

Applies a cohesive editorial brand identity (colors and typography) to artifacts, slides, or documents.

## Brand Palette

**Main Colors:**
- Dark: `#141413` — Primary text and dark backgrounds
- Light: `#faf9f5` — Light backgrounds and text on dark
- Mid Gray: `#b0aea5` — Secondary elements and muted captions
- Light Gray: `#e8e6dc` — Subtle surfaces and dividers

**Accent Colors:**
- Orange: `#d97757` — Primary accent
- Blue: `#6a9bcc` — Secondary accent
- Green: `#788c5d` — Tertiary accent

## Typography
- **Headings (24pt+)**: Poppins (with Arial / HarmonyOS Sans fallback)
- **Body Text**: Lora (with Georgia / serif fallback)

## Usage Guidelines
- Use smart contrast selection based on background (`#141413` on `#faf9f5`, `#faf9f5` on `#141413`).
- Cycle non-text shapes/charts cleanly through `#d97757`, `#6a9bcc`, `#788c5d` rather than introducing unrelated bright colors.
- Maintain consistent RGB values across HTML/CSS and `python-pptx` RGBColor outputs.
