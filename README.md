# dsh-study

**Study mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh web)** — read a PDF in the right sidebar, capture a region into the chat, and ask the model about it without leaving the page.

> 一个给 DSH Web 用的「学习模式」插件：右侧边栏读文档，框选截图或选中文字直接进左侧对话。

---

## 功能

- **右侧边栏阅读面板**：整份 PDF 由插件自带的 PDF.js 渲染，支持页码跳转、缩放、适应宽度、大文档按页虚拟化。
- **文字层可选**：canvas 上覆盖透明文字层，可拖选、双击选词、⌘C 复制。
- **框选截图**：点「框选截图」后在页面上拖一个矩形，裁剪出的图片自动进入左侧输入框的附件栏，并插入一行 `> <文件路径> · 第 N 页` 引用。
- **选字入对话**：选中文字后选区上方浮出「加入对话」，点击即把「路径 + 页码」和引用块插入输入框，并把光标交还输入框。
- **阅读位置记忆**：按文件地址把页码与缩放存进 `localStorage`，重新打开（含刷新页面）自动回到上次的位置。
- **多种文件类型**：起始页可从系统文件对话框选文件，也可从工作区里挑；支持 `.pdf`、`.md`、`.markdown`、`.docx`、`.doc`、`.pptx`、`.ppt`。PDF 用本插件的阅读器；Markdown / Word / PowerPoint 交给 DSH 内置预览（Office 会在宿主机上转成 PDF 再显示）。
- **入口**：右侧边栏「+」的引导页里多一项「学习模式」，与会话布局一起持久化。

## 兼容性

| 项目 | 要求 |
|---|---|
| DSH | web profile，`0.2.2-rc.1` 上验证（依赖 `documentPreviews`、`sidebarRightTabs`、`conversation` 等客户端服务） |
| 浏览器 | 现代 Chromium（PDF.js 6 的要求） |
| 平台 | macOS / Linux / Windows 均可运行；上传落点使用 `os.tmpdir()` |

插件本身不含任何平台相关二进制；Word/PowerPoint 的转换依赖 DSH 自带的 LibreOffice 套件与 `@deepseek-ai/dsh-office-to-pdf` 行（web-app 组合中已启用）。

## 安装

1. 克隆或下载本仓库到任意目录：

   ```bash
   git clone https://github.com/Mist-people/dsh-study.git
   ```

2. 让 DSH 把该目录装成 profile bundle。两种方式任选：

   - **让 Agent 装**（推荐）：把仓库绝对路径告诉 Agent，它会用插件管理工具执行
     `plugin_manager install_bundle`，`target` 为该目录的绝对路径；
   - **在界面里装**：设置 → 插件 → 添加/安装本地包，选这个目录。

   安装会把目录以 `link:` 方式写入当前 profile 的依赖，并在 `dsh.profile.bundles` 里选中它。

3. 刷新页面。宿主半（`index.js`）改动后需要重启 `dsh web` 才生效。

## 使用

1. 右侧边栏点「+」，在引导页里选「学习模式」；
2. 「从访达选择…」选一个文件（或从「工作区里的文件」里点一个）；
3. 阅读定位：`<` `>` 翻页、`−` / `+` 缩放、点中间百分比复位；
4. 「框选截图」→ 在页面上拖框 → 图片进左侧输入框；
5. 选中文字 → 上方「加入对话」→ 引用进输入框；
6. 直接在输入框里补问题回车即可。

## 实现概要

```
dsh-study/
├── package.json          dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      插入一行 Loader entry（id: study-mode）
├── index.js              宿主半：静态资源路由 + 上传路由
├── client.js             浏览器半：文档实现、阅读器、起始页
├── locale/{zh,en}.json   插件管理页显示名与描述
├── icon.svg              插件图标
└── vendor/pdfjs/         PDF.js 6.3.289 运行资源（build/wasm/字体/cMap）
```

- **阅读器**以 `documentPreviews.register({ extensions: ['pdf'], priority: 'extension' })` 注册，并把自己的 body 注册到 `sidebar.right.tab.document` 的同名 key 上；所以任何 PDF（对话里的链接、文件树、本插件起始页）都会用这个阅读器打开，文档工具栏的下拉框仍可切回内置渲染器。
- **起始页**是 `sidebarRightTabs.register({ kind: 'study-mode', guide: [...] })` 的页面型标签，body 注册在 `sidebar.right.pane.tab`。
- **浏览器插件不能 import npm 包**，因此 PDF.js 以 vendor 形式随包分发，由宿主半的 `/dsh-study-mode` 前缀路由提供；客户端用 `import()` 动态加载，worker 指向同一路由。
- **上传**：浏览器能拿到 File 但没有路径，而阅读器按路径读文件，所以宿主半把字节按内容寻址写到 `os.tmpdir()/dsh-study-mode/<content-hash>/<原文件名>` 并返回路径。同一个文件永远得到同一路径，这是阅读位置能跨会话恢复的前提。
- 框选裁剪直接从当前页的渲染 canvas 取像素（按 devicePixelRatio 还原），并限制最大像素数；文字层按 PDF 文字项的坐标与宽度缩放生成 span。

## 已知限制

- 「框选截图」「加入对话」只对 PDF 阅读器生效；Markdown / Word / PowerPoint 使用 DSH 内置预览，没有这两个动作。
- 单文件上传上限 64 MiB。
- 上传文件位于系统临时目录，可能被系统清理；清理后重新选择会生成新路径，阅读位置按新地址重新记录。
- 旋转过的 PDF 页面没有做文字层旋转处理。
- Office 转换在宿主机进行，首次打开较慢。

## 卸载

在插件管理里移除 `dsh-study` bundle。可选清理：删除系统临时目录下的 `dsh-study-mode/`，以及浏览器 `localStorage` 里的 `dsh.study-mode.positions.v1`。

## 第三方资源

- [PDF.js](https://github.com/mozilla/pdf.js) `pdfjs-dist@6.3.289`：Apache-2.0，许可见 `vendor/pdfjs/LICENSE`；其中的 wasm 解码器、标准字体、cMap 各自附带许可证文件（`vendor/pdfjs/wasm/LICENSE_*`、`vendor/pdfjs/standard_fonts/LICENSE_*`）。

本插件代码以 MIT 许可发布，见 `LICENSE`。

---

## English summary

A DSH web bundle that adds a **study mode**: a right-sidebar PDF reader (vendored PDF.js) with a selectable text layer, drag-to-capture into the conversation composer, "add selection to chat", remembered reading position per file, and a start page that opens PDF / Markdown / Word / PowerPoint files either from the system file dialog or from the workspace. Install the repository directory as a DSH profile bundle (`plugin_manager` `install_bundle`, or Settings → Plugins → add local package), then reload the page. Markdown/Word/PowerPoint render through DSH's built-in previews; capture and selection actions apply to PDFs.
