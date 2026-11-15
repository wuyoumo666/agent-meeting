# HTML 演示文稿设计 (Frontend Slides) — 制作单文件、无依赖、不溢出视口的动画 HTML 幻灯片
> 来源：`C:\Users\18791\.zcode\cli\plugins\cache\zcode-plugins-official\design\0.7.2\skills\design\design-resources\skills\frontend-slides\SKILL.md`

Create zero-dependency, animation-rich HTML presentations that run entirely in the browser.

## Core Principles

1. **Zero Dependencies** — Single self-contained HTML file with inline CSS/JS. No npm, no build tools.
2. **Show, Don't Tell** — When direction is open, offer 2-3 visual preview styles or concrete aesthetic presets rather than abstract questionnaires.
3. **Distinctive Design** — Avoid generic AI aesthetics (Inter/Roboto/Arial, purple gradients on white, identical card grids).
4. **Viewport Fitting (NON-NEGOTIABLE)** — Every slide MUST fit cleanly inside `100vh / 100dvh` with **no scrolling within a slide**. If content overflows, split across multiple slides.

## Mandatory Viewport & Layout Rules
- Every `.slide`: `height: 100vh; height: 100dvh; overflow: hidden;`
- All font sizes and spacing use `clamp(min, preferred, max)` — never rigid oversized px that clips on 13" laptops.
- Images constrained with `max-height: min(50vh, 400px)`.
- Include responsive height breakpoints (`700px`, `600px`, `500px`) and `@media (prefers-reduced-motion: reduce)`.
- Provide keyboard/click navigation (Arrow keys, Space, click nav dots).

## Content Density Limits Per Slide

| Slide Type | Maximum Content |
|---|---|
| Title slide | 1 heading + 1 subtitle + optional tagline |
| Content slide | 1 heading + 4–6 concise bullets OR 2 short paragraphs |
| Feature grid | 1 heading + max 6 cards (2x3 or 3x2) |
| Code slide | 1 heading + 8–10 lines of code |
| Quote slide | 1 quote (max 3 lines) + attribution |
| Image slide | 1 heading + 1 image (max 60vh height) |

## Style Presets for Reference
- **Impressed / Confident**: Bold Signal, Electric Studio, Dark Botanical
- **Excited / Energized**: Creative Voltage, Neon Cyber, Split Pastel
- **Calm / Focused**: Notebook Tabs, Paper & Ink, Swiss Modern
- **Inspired / Moved**: Dark Botanical, Vintage Editorial, Pastel Geometry
