# 无限画布设计交付 (Infinite Canvas) — 用三层架构 HTML 无限画布交付项目上下文、设计系统与页面设计稿
> 精编自：`C:\Users\18791\.zcode\cli\plugins\cache\zcode-plugins-official\design\0.7.2\skills\design\design-resources\skills\infinite-canvas\SKILL.md`

将设计产出以三层「无限画布」HTML 交付（语言与用户对话语言一致，`machine fields` 保留英文）。

## 三层架构
1. **Row 1: Project Context（项目介绍）**：大标题 + 一句话定位 + 关键词标签 + 核心流程图/卡片，让人一眼看懂是什么、给谁用、解决什么问题。不要求全塞进卡片，追求设计看板感。
2. **Row 2: Design System（设计系统）**：必须包含「色板」「字体排版」「组件样例」卡片（横排 3–4 张，间距 20–40px），可选间距/状态/图标卡片。所有 Token 与样式必须真实一致，不编造。
3. **Row 3: Design Deliverables（设计稿）**：按用户实际操作流程从左到右排列所有页面。

## 画面洁净与防重叠规则
- **页面内部洁净度**：不使用 emoji 当图标/头像/占位图，统一用 SVG 线性图标；不在页面稿上叠加画布特效或额外 UI；使用标准分辨率（如 `375x812`、`390x844`、`1280x800`）。
- **禁止硬编码猜高度**：元素定位应基于实际渲染高度链式排布（`below(el, gap)` / `rightOf(el, gap)` / `maxY(els, gap)`），Row 间距建议 60–100px，同行元素间距 16–32px。
- **排版审美**：避免默认 Inter/Roboto/Space Grotesk；保留清晰字阶对比、行高呼吸感与背景氛围纹理。
