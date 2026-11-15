# React/Tailwind 复杂交互原型 (Web Artifacts Builder) — 使用 React + Tailwind + shadcn/ui 构建带状态的现代 Web 交付物
> 来源：`C:\Users\18791\.codebuddy\plugins\marketplaces\codebuddy-plugins-official\plugins\web-artifacts-builder\SKILL.md`

用于构建需要多组件状态管理、路由或组件库支持的复杂前端交付物（简单单页可直接写纯净 HTML/CSS/JS）。

## 推荐技术栈
- React 18 + TypeScript + Vite
- Tailwind CSS + shadcn/ui（Radix UI 原语）
- 打包单文件分享时可通过 Parcel + `html-inline` 产物化为自包含 `bundle.html`

## 设计与审美红线
- **避免 "AI Slop"**：禁止无脑全屏居中、默认紫蓝渐变、千篇一律的圆角卡片堆砌、以及毫无意图地全套默认 Inter 字体。
- **依赖真实性**：写代码前务必检查当前项目的 `package.json`，确认已安装的依赖与版本，未安装前先说明安装命令。
- **可运行验收**：交付前确保构建/类型检查通过，并在需要时做页面渲染与交互走查。
