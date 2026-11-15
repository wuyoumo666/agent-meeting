# 设计工作流 (Design Workflow) — 制作 HTML 设计稿、可交互原型或 HTML 演示稿时的全局规范与执行路由
> 来源：`C:\Users\18791\.zcode\cli\plugins\cache\zcode-plugins-official\design\0.7.2\skills\design\SKILL.md`

## Hard rules

1. No emoji as icons, avatars, image placeholders, navigation or decoration; use 1.6–1.8px monoline SVG with `currentColor`.
2. No AI tells: default Tailwind indigo/violet accent; two-stop purple/blue hero gradient; hardcoded sans display when the system binds a serif; rounded card with a colored left border; invented metrics; filler copy (lorem, "feature one / two / three").
3. Never say a file is delivered, previewed or checked unless it was written and its render actually viewed.
4. Delivered HTML should open cleanly from `file://` as a standalone deliverable.

## Route

- Page, UI, prototype, app, website, deck, design system or redesign → classify by final goal:
  - **CREATE**, nothing existing to carry forward → define visual direction, typography, palette and layout architecture before coding.
  - **REDESIGN**, an existing design to reference or carry forward → audit existing code/assets first, preserve brand equity and working structure, fix hierarchy/noise/consistency systematically.
  - Unclear from request, materials or context → ask focused clarifying questions once before guessing.
- Advice only (no deliverable): answer without creating designs. Review only: inspect and report issues without modifying files.

## Evidence

- Images, including your own renders: if the model takes image input and actually receives a readable one, use native vision; mark unclear text uncertain; if unreadable, state the gap.
- URLs, web pages and Figma links count only after a tool actually read them. Do not promise editable Figma layers or exports.
- The user's latest request defines the goal; code defines the current state. Keep facts, inferences and unknowns apart.
- Tell the user observable progress, results, files and checks; do not narrate internal steps unless asked.
