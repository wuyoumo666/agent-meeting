# PPT 演示文稿设计与视觉验收 (PPT Design) — 用 Python 生成可编辑 PPTX 并经 PNG 视觉审查交付
> 精编自：`C:\Users\18791\.agents\skills\ppt-design-skill\SKILL.md`（需要脚本/模板时可查看原目录）

## Designer Mindset
- **Audience first**: Decide what the audience must understand, remember, feel, or do before picking a layout.
- **Restraint over decoration**: One clear accent system beats random decorative shapes; every element must earn its place.
- **Systematic thinking**: Lock margins, spacing rhythm, typography, color roles, corner treatment, and chart language across the whole deck.
- **Intentional variation**: Change page architecture and density when the narrative changes, not for random variety.

## Three Dials (1–10)
- **Variance**: Low (consistent grid), Medium (2–3 strategies), High (section dividers & distinct page structures).
- **Motion**: Low (none/fade), Medium (section transitions), High (only when presentation context calls for it).
- **Density**: Low (generous whitespace, 1–2 focal elements), Medium (narrative + data), High (tables/dashboards).

## Delivery Workflow (Brief → Build → Visual Verify)
1. **Brief Acceptance Contract**: Clarify topic, audience, language, purpose, page count, brand/template constraints, editability requirements, and classify conditions (`MUST` / `SHOULD` / `NICE_TO_HAVE`).
2. **Visual Quality Target & Theme Lock**: Define mood, palette intent, typography, grid, and forbidden patterns before writing Python code.
3. **Choose Mode**:
   - **Build Mode**: Blank-canvas Python script with exact element placement (`Presentation()` / `pptx_designer`) for highest composition control.
   - **FreeStyle Mode**: Fast exploratory draft.
   - **VI Build Mode**: Preserve supplied enterprise `.pptx` template DNA.
4. **Non-negotiable Verification (`PPTX → PDF → PNG`)**:
   - A script that runs without error is NOT complete until slides are exported to PNG and visually inspected!
   - **Gate 1 (Visual Effect)**: Does each slide look client-ready at a glance with clear focal point, whitespace, and rhythm?
   - **Gate 2 (Serious Defects)**: Check text overflow, overlap, clipping, unreadable contrast, missing citations, and broken editability.
   - Fix root causes (composition or density) for layout failures and re-verify PNGs before final delivery.
