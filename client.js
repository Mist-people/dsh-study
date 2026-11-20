/**
 * Browser half of the study-mode bundle.
 *
 * Two contributions to the page:
 *
 * 1. A `pdf` document implementation for the right sidebar's document tab.
 *    The shipped document owner reads the file, keeps the tab, and hands this
 *    renderer the complete bytes; this module renders them with the PDF.js
 *    runtime served by the Host half, adds a selectable text layer, and adds a
 *    region-capture tool that drops the crop into the conversation composer.
 * 2. A "study mode" start page (a right-sidebar page type, listed in the
 *    sidebar guide beside Files and Terminal) that picks which file to read:
 *    the system file dialog, or a supported file already in the workspace.
 *    PDFs open in the reader above; Markdown and Word files open through the
 *    shipped Markdown and Office previews the document tab selects by suffix.
 *
 * Nothing here imports a Harness Client package: the only module request is
 * `react` from the shared module table, and PDF.js arrives through a dynamic
 * import of the Host route.
 */
window.__ModuleLoader__.load({
  id: 'dsh-study',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React

    /** This implementation's identity: the document slot key it renders under. */
    const IMPL_ID = 'dsh-study/pdf'
    /** The start page's tab implementation identity: body and title register under it. */
    const LAUNCHER_ID = 'dsh-study/launcher'
    /** The start page's kind, what `openTab` names. */
    const LAUNCHER_KIND = 'study-mode'
    /** Host route prefix owned by this bundle. */
    const ROUTE = '/dsh-study-mode'
    /** Where the Host half accepts one picked PDF. */
    const UPLOAD_PATH = ROUTE + '/upload'
    /** Where the Host half serves the vendored PDF.js runtime. */
    const ASSET_BASE = ROUTE + '/assets/pdfjs/'
    /** Locale namespace registered by this plugin. */
    const NS = 'studyMode'
    /** Hard cap on one cropped image, keeping the Host image pipeline comfortable. */
    const MAX_CROP_PIXELS = 4000000
    /** Horizontal room around a page inside the scroll area. */
    const PAGE_GUTTER = 18

    const ZH = {
      implLabel: '学习模式（PDF）',
      openPanel: '学习模式',
      guideDescription: '阅读 PDF / Markdown / Word / PPT，截图和选字都能放进对话',
      launcherTitle: '学习模式',
      launcherHint: '选择一个文件开始阅读（PDF / Markdown / Word / PowerPoint）；框选截图或选中文字都能放进左侧对话。',
      pickFromFinder: '从访达选择 PDF…',
      pickHint: '支持 .pdf、.md、.docx、.doc、.pptx、.ppt。',
      opening: '正在打开…',
      uploadFailed: '没能打开这个文件',
      workspaceTitle: '工作区里的文件',
      root: '工作区根目录',
      up: '上一级',
      emptyDir: '这个目录里没有可打开的文件。',
      loadingDir: '正在读取目录…',
      dirFailed: '读取目录失败',
      loading: '正在读取文件…',
      loadFailed: '面板加载失败',
      encrypted: '这个 PDF 已加密，需要密码才能打开。',
      retry: '重试',
      prevPage: '上一页',
      nextPage: '下一页',
      zoomOut: '缩小',
      zoomIn: '放大',
      resetZoom: '恢复到适应宽度',
      capture: '框选截图',
      captureHint: '点一下，然后在页面上拖出一个矩形',
      captured: '已截图，图片和「路径 + 页码」引用放进左侧输入框了。',
      referenceLine: '> {path} · 第 {page} 页',
      captureNotReady: '这一页还没渲染好，等它显示出来再框选。',
      composerBusy: '输入框正忙，暂时放不进去，请稍后再框选。',
      attachFailed: '截图没能放进输入框。',
      unsupportedContent: '这个面板没有拿到文件内容，无法显示。',
      crashHint: '如果刚更新过插件，请硬刷新页面（⌘⇧R）后重试。',
      addSelection: '加入对话',
      notSupported: '只支持 .pdf、.md、.markdown、.docx、.doc、.pptx、.ppt 文件。',
    }

    const EN = {
      implLabel: 'Study mode (PDF)',
      openPanel: 'Study mode',
      guideDescription: 'Read PDF, Markdown, Word or PowerPoint; captures and selections go to the chat',
      launcherTitle: 'Study mode',
      launcherHint: 'Open a file to read (PDF, Markdown, Word, PowerPoint); a drag-capture or a text selection goes to the chat on the left.',
      pickFromFinder: 'Choose a PDF…',
      pickHint: 'Supports .pdf, .md, .docx, .doc, .pptx and .ppt.',
      opening: 'Opening…',
      uploadFailed: 'The file could not be opened',
      workspaceTitle: 'Files in the workspace',
      root: 'Workspace root',
      up: 'Parent folder',
      emptyDir: 'No openable files in this folder.',
      loadingDir: 'Reading the folder…',
      dirFailed: 'The folder could not be read',
      loading: 'Reading the file…',
      loadFailed: 'The panel failed to load',
      encrypted: 'This PDF is encrypted and needs a password.',
      retry: 'Retry',
      prevPage: 'Previous page',
      nextPage: 'Next page',
      zoomOut: 'Zoom out',
      zoomIn: 'Zoom in',
      resetZoom: 'Reset to fit width',
      capture: 'Capture',
      captureHint: 'Click, then drag a rectangle on the page',
      captured: 'Captured — the crop and a path/page reference are in the composer on the left.',
      referenceLine: '> {path} · page {page}',
      captureNotReady: 'This page is not rendered yet — wait for it, then capture.',
      composerBusy: 'The composer is busy; nothing could be added. Try again in a moment.',
      attachFailed: 'The capture could not reach the composer.',
      unsupportedContent: 'This panel received no document content, so it cannot render the file.',
      crashHint: 'If the plugin was just updated, hard-reload the page (⌘⇧R) and retry.',
      addSelection: 'Add to chat',
      notSupported: 'Only .pdf, .md, .markdown, .docx, .doc, .pptx and .ppt files are supported.',
    }

    const CSS = [
      '.dsm-root{height:100%;min-height:0;display:flex;flex-direction:column;position:relative;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45}',
      '.dsm-toolbar{flex:none;display:flex;align-items:center;gap:2px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}',
      '.dsm-grow{flex:1 1 auto}',
      '.dsm-sep{width:1px;height:16px;margin:0 4px;background:var(--dsw-alias-border-l1)}',
      '.dsm-icon,.dsm-zoom,.dsm-capture{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;padding:0 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer}',
      '.dsm-icon{width:26px;padding:0}',
      '.dsm-icon:hover:not(:disabled),.dsm-zoom:hover,.dsm-capture:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.dsm-icon:disabled,.dsm-capture:disabled{opacity:.45;cursor:default}',
      '.dsm-zoom{min-width:46px;font-variant-numeric:tabular-nums}',
      '.dsm-capture.dsm-active{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}',
      '.dsm-page-label{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;padding:0 2px;white-space:nowrap}',
      '.dsm-scroll{flex:1 1 auto;min-height:0;overflow:auto;position:relative;padding-bottom:14px}',
      '.dsm-page{position:relative;margin:14px auto;background:var(--dsw-alias-bg-layer-1);box-shadow:0 0 0 1px var(--dsw-alias-border-l1);border-radius:2px;overflow:hidden}',
      '.dsm-canvas{display:block;position:relative;z-index:0}',
      '.dsm-textlayer{position:absolute;inset:0;z-index:1;overflow:clip;line-height:1;text-align:initial;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;user-select:text}',
      '.dsm-textlayer span,.dsm-textlayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0 0}',
      '.dsm-textlayer ::selection{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 32%,transparent)}',
      '.dsm-scrollwrap{flex:1 1 auto;min-height:0;position:relative;display:flex;flex-direction:column}',
      '.dsm-capturelayer{position:absolute;inset:0;z-index:6;overflow:hidden;cursor:crosshair;touch-action:none}',
      '.dsm-capturebox{position:absolute;box-sizing:border-box;border:2px solid var(--dsw-alias-brand-primary);border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);pointer-events:none}',
      '.dsm-capturehint{position:absolute;top:8px;left:50%;transform:translateX(-50%);max-width:86%;padding:4px 10px;border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap;box-shadow:0 0 0 1px var(--dsw-alias-border-l1);pointer-events:none}',
      '.dsm-selpop{position:absolute;z-index:20;transform:translateX(-50%);display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer;box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}',
      '.dsm-selpop:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsm-toast{position:absolute;z-index:4;left:50%;bottom:14px;transform:translateX(-50%);max-width:80%;padding:6px 12px;border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}',
      '.dsm-toast.dsm-error{color:var(--dsw-alias-state-error-primary)}',
      '.dsm-center{flex:1 1 auto;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-error{flex:1 1 auto;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:8px;padding:24px;color:var(--dsw-alias-label-primary)}',
      '.dsm-error-title{font-size:13px;font-weight:600}',
      '.dsm-error-body{margin:0;max-width:100%;max-height:160px;overflow:auto;font-size:11px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}',
      '.dsm-button{flex:none;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-brand-primary);background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer}',
      '.dsm-button:disabled{opacity:.45;cursor:default}',
      '.dsm-launcher{height:100%;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45}',
      '.dsm-h1{font-size:14px;font-weight:600;margin:0}',
      '.dsm-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-pick{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.dsm-group{display:flex;flex-direction:column;gap:4px}',
      '.dsm-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-crumb{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary);min-width:0}',
      '.dsm-crumb-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsm-list{display:flex;flex-direction:column;gap:1px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden}',
      '.dsm-item{display:flex;align-items:center;gap:8px;min-height:32px;padding:0 10px;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '.dsm-item:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.dsm-item-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsm-item-meta{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dsm-item-icon{flex:none;display:inline-flex;color:var(--dsw-alias-label-secondary)}',
      '.dsm-empty{padding:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dsm-line{font-size:12px;color:var(--dsw-alias-state-error-primary)}',
    ].join('')

    /** Custom-scheme address for a path, matching the Host's grammar (relative or absolute). */
    function fileAddressOf(sessionId, filePath) {
      const segments = String(filePath)
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/')
      return 'dsh-resource://file/session/' + encodeURIComponent(sessionId) + '/' + segments
    }

    /** Clamp a number into a closed range. */
    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), max)
    }

    /** Effective failure text for a thrown error or a Remote failure. */
    function describeFailure(failure) {
      if (!failure) return 'unknown error'
      if (typeof failure === 'string') return failure
      const code = failure.code ? String(failure.code) + ': ' : ''
      const message = failure.message ? String(failure.message) : String(failure)
      const name = failure.name && failure.name !== 'Error' ? String(failure.name) + ': ' : ''
      return code + name + message
    }

    /** Human byte size for a listing row. */
    function formatBytes(bytes) {
      const value = Number(bytes)
      if (!Number.isFinite(value) || value <= 0) return ''
      if (value < 1024) return value + ' B'
      if (value < 1024 * 1024) return Math.round(value / 1024) + ' KB'
      return (value / (1024 * 1024)).toFixed(1) + ' MB'
    }

    /** File kinds the study panel opens; the document tab picks the renderer. */
    const SUPPORTED_PATTERN = /\.(pdf|md|markdown|doc|docx|ppt|pptx)$/i

    /** Whether one file name is something the study panel accepts. */
    function isSupportedFile(name) {
      return SUPPORTED_PATTERN.test(String(name || ''))
    }

    /** The readable file path behind a `dsh-resource://file/…` address. */
    function pathOfAddress(address) {
      const raw = String(address || '')
      const marker = '/session/'
      const at = raw.indexOf(marker)
      let rest = ''
      if (at >= 0) {
        const after = raw.slice(at + marker.length)
        const slash = after.indexOf('/')
        rest = slash >= 0 ? after.slice(slash) : ''
        // An absolute path keeps its leading slash; a workspace-relative one drops it.
        rest = rest.startsWith('//') ? rest.slice(1) : rest.replace(/^\//, '')
      }
      let decoded = rest
      try {
        decoded = rest
          .split('/')
          .map(segment => decodeURIComponent(segment))
          .join('/')
      } catch {
        decoded = rest
      }
      return decoded || raw
    }

    /** The page element under one viewport point. */
    function pageElementAt(x, y) {
      if (typeof document.elementsFromPoint !== 'function') return null
      for (const element of document.elementsFromPoint(x, y)) {
        const page = element && element.closest ? element.closest('[data-dsm-page]') : null
        if (page) return page
      }
      return null
    }

    /** The overlay box and the page-local rectangle for one drag. */
    function captureBoxOf(drag) {
      const { pageRect, overlayRect } = drag
      const left = clamp(Math.min(drag.x0, drag.x1), pageRect.left, pageRect.right)
      const right = clamp(Math.max(drag.x0, drag.x1), pageRect.left, pageRect.right)
      const top = clamp(Math.min(drag.y0, drag.y1), pageRect.top, pageRect.bottom)
      const bottom = clamp(Math.max(drag.y0, drag.y1), pageRect.top, pageRect.bottom)
      return {
        left: left - overlayRect.left,
        top: top - overlayRect.top,
        width: right - left,
        height: bottom - top,
        local: { x: left - pageRect.left, y: top - pageRect.top, w: right - left, h: bottom - top },
      }
    }

    /** Small stroke icon set drawn from `currentColor`. */
    const ICONS = {
      left: 'M10 3 5 8l5 5',
      right: 'M6 3l5 5-5 5',
      up: 'M8 12.5V3.5M3.5 8 8 3.5 12.5 8',
      minus: 'M3.5 8h9',
      plus: 'M8 3.5v9M3.5 8h9',
      crop: 'M2.5 5.5V2.5h3M13.5 5.5V2.5h-3M2.5 10.5v3h3M13.5 10.5v3h-3M8 5.8v4.4M5.8 8h4.4',
      folder: 'M2 4.5h4l1.2 1.5H14v6.5H2z',
      file: 'M4 1.5h6.5L13 4v10.5H4zM10.5 1.5V4H13M6 7h5M6 9.5h5',
    }

    function Icon(props) {
      return h(
        'svg',
        {
          width: props.size || 14,
          height: props.size || 14,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: ICONS[props.name] || '' }),
      )
    }

    function StyleTag() {
      return h('style', null, CSS)
    }

    /**
     * Build the components once, closing over the plugin context and copy.
     * @param ctx - the client plugin context.
     * @param t - the namespace-bound translate function.
     * @returns the registered component set.
     */
    function buildUi(ctx, t) {
      /** Hand the keyboard back to the Session composer, caret where it was. */
      function focusComposer(sessionId) {
        try {
          const sessions = ctx.sessions
          const scope = sessions && typeof sessions.scope === 'function' ? sessions.scope(sessionId) : undefined
          if (!scope) return
          const input = ctx.conversation && ctx.conversation.input
          if (input && typeof input.for === 'function') input.for(scope).focus()
        } catch (error) {
          console.error('[study-mode] could not focus the composer', error)
        }
      }

      /** Re-render on a locale change so translated copy follows the preference. */
      function useLocaleTick() {
        const [, force] = React.useReducer(value => value + 1, 0)
        useEffect(() => ctx.locale.subscribe(force), [])
      }

      /** Failure card that never blanks the slot entry. */
      function FailureCard(props) {
        const error = props.error
        const encrypted = error && error.name === 'PasswordException'
        return h(
          'div',
          { className: 'dsm-root' },
          h(StyleTag),
          h(
            'div',
            { className: 'dsm-error' },
            h('div', { className: 'dsm-error-title' }, props.title || t('loadFailed')),
            encrypted ? h('div', { className: 'dsm-line' }, t('encrypted')) : null,
            h('pre', { className: 'dsm-error-body' }, describeFailure(error)),
            props.hint ? h('div', { className: 'dsm-hint' }, props.hint) : null,
            props.onRetry ? h('button', { className: 'dsm-button', type: 'button', onClick: props.onRetry }, t('retry')) : null,
          ),
        )
      }

      /** Keeps a rendering exception inside the panel instead of blanking the tab. */
      class Boundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { error: null }
          this.retry = () => this.setState({ error: null })
        }
        static getDerivedStateFromError(error) {
          return { error }
        }
        componentDidCatch(error) {
          console.error('[study-mode] panel crashed', error)
        }
        render() {
          if (this.state.error) {
            return h(FailureCard, { error: this.state.error, onRetry: this.retry, hint: t('crashHint') })
          }
          return this.props.children
        }
      }

      /**
       * One page placeholder: renders its canvas and a selectable text layer
       * only while near the viewport.
       */
      function PdfPage(props) {
        const { doc, index, scale, baseSize, registerCanvas } = props
        const wrapRef = useRef(null)
        const canvasRef = useRef(null)
        const layerRef = useRef(null)
        const [visible, setVisible] = useState(false)
        const [natural, setNatural] = useState(null)

        useEffect(() => {
          const element = wrapRef.current
          if (!element) return undefined
          const observer = new IntersectionObserver(
            entries => {
              for (const entry of entries) setVisible(entry.isIntersecting)
            },
            { rootMargin: '700px 0px' },
          )
          observer.observe(element)
          return () => observer.disconnect()
        }, [])

        useEffect(() => {
          if (!visible) return undefined
          let alive = true
          let task = null
          const canvas = canvasRef.current
          const layer = layerRef.current
          // A drag-resize changes the scale on every frame; only the resting
          // scale needs a fresh bitmap.
          const timer = setTimeout(() => {
            void (async () => {
              const page = await doc.getPage(index)
              if (!alive || !canvas) return
              const ratio = Math.min(window.devicePixelRatio || 1, 2)
              const naturalViewport = page.getViewport({ scale: 1 })
              const cssViewport = page.getViewport({ scale })
              const renderViewport = page.getViewport({ scale: scale * ratio })
              canvas.width = Math.max(1, Math.floor(renderViewport.width))
              canvas.height = Math.max(1, Math.floor(renderViewport.height))
              canvas.style.width = Math.floor(cssViewport.width) + 'px'
              canvas.style.height = Math.floor(cssViewport.height) + 'px'
              setNatural({ width: naturalViewport.width, height: naturalViewport.height })
              registerCanvas(index, { canvas, page, ratio })
              task = page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport, canvas })
              await task.promise
              if (!alive || !layer) return
              const lib = await loadPdfjs()
              if (!alive) return
              await buildTextLayer(lib, page, layer, scale)
            })().catch(error => {
              if (error && error.name === 'RenderingCancelledException') return
              console.error('[study-mode] page render failed', index, error)
            })
          }, 120)
          return () => {
            alive = false
            clearTimeout(timer)
            if (task) {
              try {
                task.cancel()
              } catch {}
            }
            if (layer) layer.textContent = ''
            if (canvas) {
              canvas.width = 0
              canvas.height = 0
            }
          }
        }, [visible, scale, doc, index, registerCanvas])

        const width = (natural ? natural.width : baseSize.width) * scale
        const height = (natural ? natural.height : baseSize.height) * scale
        return h(
          'div',
          {
            ref: wrapRef,
            className: 'dsm-page',
            'data-dsm-page': index,
            style: { width: Math.round(width) + 'px', height: Math.round(height) + 'px' },
          },
          h('canvas', { ref: canvasRef, className: 'dsm-canvas' }),
          h('div', { ref: layerRef, className: 'dsm-textlayer' }),
        )
      }

      /** The right-sidebar PDF reader: page canvas, text layer, zoom, capture. */
      function StudyPanel(props) {
        useLocaleTick()
        const address = props.resourceAddress || 'study-mode'
        const content = props.content
        const sessionId = props.sessionId
        const inputActions = props.inputActions
        const stored = positionOf(address) || {}

        const [status, setStatus] = useState('loading')
        const [failure, setFailure] = useState(null)
        const [attempt, setAttempt] = useState(0)
        const [doc, setDoc] = useState(null)
        const [numPages, setNumPages] = useState(0)
        const [baseSize, setBaseSize] = useState({ width: 612, height: 792 })
        const [zoom, setZoom] = useState(typeof stored.zoom === 'number' ? stored.zoom : 1)
        const [currentPage, setCurrentPage] = useState(stored.page || 1)
        const [roomWidth, setRoomWidth] = useState(0)
        const [captureMode, setCaptureMode] = useState(false)
        const [capturing, setCapturing] = useState(false)
        const [captureBox, setCaptureBox] = useState(null)
        const [toast, setToast] = useState(null)
        const [selectionPop, setSelectionPop] = useState(null)

        const rootRef = useRef(null)
        const scrollRef = useRef(null)
        const overlayRef = useRef(null)
        const canvasesRef = useRef(new Map())
        const captureRef = useRef(null)
        const captureTimerRef = useRef(0)
        const dataRef = useRef(null)
        const restoredRef = useRef('')
        const pendingRestoreRef = useRef(false)
        const currentPageRef = useRef(currentPage)
        const captureModeRef = useRef(captureMode)

        currentPageRef.current = currentPage
        captureModeRef.current = captureMode

        const registerCanvas = useCallback((index, entry) => {
          canvasesRef.current.set(index, entry)
        }, [])

        useEffect(() => {
          // The document owner hands the body `undefined` until the complete
          // file has arrived, so an absent value is a loading state, not an
          // unsupported one.
          if (!content) {
            setStatus(current => (current === 'ready' ? current : 'loading'))
            return undefined
          }
          if (content.kind !== 'bytes') {
            setStatus('unsupported')
            return undefined
          }
          const data = content.data
          if (dataRef.current === data) return undefined
          dataRef.current = data
          let alive = true
          let task = null
          canvasesRef.current.clear()
          setStatus('loading')
          setFailure(null)
          setDoc(null)
          setNumPages(0)
          ;(async () => {
            try {
              const lib = await loadPdfjs()
              const copy = new Uint8Array(data.byteLength)
              copy.set(data)
              task = lib.getDocument({
                data: copy,
                cMapUrl: ASSET_BASE + 'cmaps/',
                cMapPacked: true,
                standardFontDataUrl: ASSET_BASE + 'standard_fonts/',
                wasmUrl: ASSET_BASE + 'wasm/',
                isEvalSupported: false,
              })
              const created = await task.promise
              const first = await created.getPage(1)
              const viewport = first.getViewport({ scale: 1 })
              if (!alive) return
              setBaseSize({ width: viewport.width, height: viewport.height })
              setNumPages(created.numPages)
              setDoc(created)
              setStatus('ready')
            } catch (error) {
              if (!alive) return
              console.error('[study-mode] PDF load failed', error)
              setFailure(error)
              setStatus('error')
            }
          })()
          return () => {
            alive = false
            if (task) {
              try {
                task.destroy()
              } catch {}
            }
          }
        }, [content, attempt])

        useEffect(() => {
          const element = scrollRef.current
          if (!element) return undefined
          setRoomWidth(element.clientWidth)
          const observer = new ResizeObserver(entries => {
            for (const entry of entries) setRoomWidth(Math.floor(entry.contentRect.width))
          })
          observer.observe(element)
          return () => observer.disconnect()
        }, [status])

        useEffect(() => {
          if (pendingRestoreRef.current) return
          rememberPosition(address, { page: currentPage, zoom })
        }, [address, currentPage, zoom])

        useEffect(() => {
          if (!toast) return undefined
          const timer = setTimeout(() => setToast(null), 3200)
          return () => clearTimeout(timer)
        }, [toast])

        useEffect(
          () => () => {
            if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
          },
          [],
        )

        const fitScale = roomWidth > 0 ? (roomWidth - PAGE_GUTTER * 2) / baseSize.width : 1
        const scale = Math.max(0.1, fitScale * zoom)
        const scaleRef = useRef(scale)
        const anchorRef = useRef({ page: 1, ratio: 0 })

        const goToPage = useCallback(
          target => {
            const element = scrollRef.current
            const page = clamp(Math.round(target), 1, Math.max(numPages, 1))
            setCurrentPage(page)
            if (!element) return
            const child = element.querySelector('[data-dsm-page="' + page + '"]')
            if (child) element.scrollTo({ top: child.offsetTop - PAGE_GUTTER / 2, behavior: 'smooth' })
          },
          [numPages],
        )

        useEffect(() => {
          const element = scrollRef.current
          if (!element || status !== 'ready') return undefined
          let frame = 0
          const read = () => {
            frame = 0
            const middle = element.scrollTop + element.clientHeight / 2
            const top = element.scrollTop + 1
            const pages = element.querySelectorAll('[data-dsm-page]')
            let page = 1
            let anchorPage = 1
            let anchorRatio = 0
            if (pages.length > 0) {
              // The first page's top margin gives a negative ratio, so a
              // restore at the very top lands back at scrollTop 0.
              anchorRatio = (top - pages[0].offsetTop) / (pages[0].offsetHeight || 1)
              for (let index = 0; index < pages.length; index += 1) {
                const node = pages[index]
                const start = node.offsetTop
                const height = node.offsetHeight || 1
                if (start <= middle) page = index + 1
                if (start <= top) {
                  anchorPage = index + 1
                  anchorRatio = (top - start) / height
                }
                if (start > middle) break
              }
            }
            anchorRef.current = { page: anchorPage, ratio: anchorRatio }
            setCurrentPage(page)
          }
          const onScroll = () => {
            if (frame) return
            frame = requestAnimationFrame(read)
          }
          element.addEventListener('scroll', onScroll, { passive: true })
          read()
          return () => {
            element.removeEventListener('scroll', onScroll)
            if (frame) cancelAnimationFrame(frame)
          }
        }, [status, numPages])

        useLayoutEffect(() => {
          const previous = scaleRef.current
          scaleRef.current = scale
          if (previous === scale || status !== 'ready') return
          const element = scrollRef.current
          if (!element) return
          const anchor = anchorRef.current
          const node = element.querySelector('[data-dsm-page="' + anchor.page + '"]')
          if (!node) return
          element.scrollTop = Math.max(0, node.offsetTop + anchor.ratio * (node.offsetHeight || 0))
        }, [scale, status])

        useEffect(() => {
          if (status !== 'ready') return undefined
          if (restoredRef.current === address) return undefined
          restoredRef.current = address
          const target = positionOf(address)
          if (!target || !(target.page > 1)) return undefined
          pendingRestoreRef.current = true
          let cancelled = false
          const jump = () => {
            const element = scrollRef.current
            if (cancelled || !element) return
            const child = element.querySelector('[data-dsm-page="' + target.page + '"]')
            if (!child) return
            element.scrollTop = Math.max(0, child.offsetTop - PAGE_GUTTER / 2)
            setCurrentPage(target.page)
          }
          const frame = requestAnimationFrame(jump)
          // Pages above the target settle to their real height after the first
          // paint, so correct the offset once that has happened.
          const timer = setTimeout(() => {
            jump()
            pendingRestoreRef.current = false
          }, 320)
          return () => {
            cancelled = true
            cancelAnimationFrame(frame)
            clearTimeout(timer)
            pendingRestoreRef.current = false
          }
        }, [status, address])

        /** Register one captured image as a draft attachment of this Session. */
        const attachImage = useCallback(
          file => {
            const conversation = ctx.conversation
            if (!conversation || typeof conversation.createDrafts !== 'function' || !inputActions) return []
            const add = uploads => {
              const drafts = conversation.createDrafts(sessionId, [file], uploads)
              const ids = drafts.map(draft => draft.id)
              if (ids.length > 0 && !inputActions.addAttachments(ids)) return []
              return ids
            }
            try {
              return add(true)
            } catch (error) {
              console.error('[study-mode] draft attachment failed', error)
              try {
                return add(false)
              } catch (inner) {
                console.error('[study-mode] draft attachment retry failed', inner)
                return []
              }
            }
          },
          [sessionId, inputActions],
        )

        /** Insert the file path and page of the capture as a quoted reference line. */
        const insertReference = useCallback(
          page => {
            if (!inputActions || typeof inputActions.insertText !== 'function') return
            const snippet = t('referenceLine', { path: pathOfAddress(address), page }) + '\n'
            try {
              const span = inputActions.captureInsertion()
              inputActions.insertText(snippet, span)
            } catch (error) {
              console.error('[study-mode] reference insertion failed', error)
            }
          },
          [address, inputActions],
        )

        /** Start one drag on the capture overlay; it has to begin over a page. */
        const startCapture = useCallback(event => {
          if (event.button !== undefined && event.button !== 0) return
          const overlay = overlayRef.current
          if (!overlay) return
          const page = pageElementAt(event.clientX, event.clientY)
          if (!page) return
          if (captureTimerRef.current) {
            clearTimeout(captureTimerRef.current)
            captureTimerRef.current = 0
          }
          event.preventDefault()
          const drag = {
            pageIndex: Number(page.getAttribute('data-dsm-page')),
            pageRect: page.getBoundingClientRect(),
            overlayRect: overlay.getBoundingClientRect(),
            x0: event.clientX,
            y0: event.clientY,
            x1: event.clientX,
            y1: event.clientY,
          }
          captureRef.current = drag
          setCaptureBox(captureBoxOf(drag))
          setCapturing(true)
        }, [])

        const captureRegion = useCallback(
          async (pageIndex, rect) => {
            const entry = canvasesRef.current.get(pageIndex)
            if (!entry || !entry.canvas || !entry.canvas.width || !entry.canvas.height) {
              setToast({ text: t('captureNotReady'), level: 'error' })
              return
            }
            const canvas = entry.canvas
            const cssWidth = parseFloat(canvas.style.width) || canvas.width
            const ratio = entry.ratio || canvas.width / cssWidth
            const sx = clamp(rect.x * ratio, 0, canvas.width - 1)
            const sy = clamp(rect.y * ratio, 0, canvas.height - 1)
            const sw = clamp(rect.w * ratio, 1, canvas.width - sx)
            const sh = clamp(rect.h * ratio, 1, canvas.height - sy)
            let outWidth = Math.max(1, Math.round(sw))
            let outHeight = Math.max(1, Math.round(sh))
            const pixels = outWidth * outHeight
            if (pixels > MAX_CROP_PIXELS) {
              const shrink = Math.sqrt(MAX_CROP_PIXELS / pixels)
              outWidth = Math.max(1, Math.round(outWidth * shrink))
              outHeight = Math.max(1, Math.round(outHeight * shrink))
            }
            const output = document.createElement('canvas')
            output.width = outWidth
            output.height = outHeight
            const context = output.getContext('2d')
            if (!context) {
              setToast({ text: t('attachFailed'), level: 'error' })
              return
            }
            context.drawImage(canvas, sx, sy, sw, sh, 0, 0, outWidth, outHeight)
            const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'))
            if (!blob) {
              setToast({ text: t('attachFailed'), level: 'error' })
              return
            }
            const file = new File([blob], 'pdf-p' + pageIndex + '.png', { type: 'image/png' })
            setCaptureMode(false)
            const ids = attachImage(file)
            insertReference(pageIndex)
            focusComposer(sessionId)
            setToast(
              ids.length > 0
                ? { text: t('captured'), level: 'info' }
                : { text: t('composerBusy'), level: 'error' },
            )
          },
          [attachImage, insertReference, sessionId],
        )

        useEffect(() => {
          if (!capturing) return undefined
          const onMove = event => {
            const drag = captureRef.current
            if (!drag) return
            drag.x1 = event.clientX
            drag.y1 = event.clientY
            setCaptureBox(captureBoxOf(drag))
          }
          const onUp = event => {
            const drag = captureRef.current
            captureRef.current = null
            setCapturing(false)
            if (!drag) {
              setCaptureBox(null)
              return
            }
            drag.x1 = event.clientX
            drag.y1 = event.clientY
            const box = captureBoxOf(drag)
            if (!box || box.local.w < 8 || box.local.h < 8) {
              setCaptureBox(null)
              return
            }
            void captureRegion(drag.pageIndex, box.local)
            // Keep the frame on screen briefly so the captured region stays obvious.
            setCaptureBox(box)
            if (captureTimerRef.current) clearTimeout(captureTimerRef.current)
            captureTimerRef.current = setTimeout(() => {
              captureTimerRef.current = 0
              setCaptureBox(null)
            }, 1200)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', onUp)
          return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
          }
        }, [capturing, captureRegion])

        useEffect(() => {
          if (!captureMode) return undefined
          const onKey = event => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            captureRef.current = null
            setCapturing(false)
            setCaptureBox(null)
            setCaptureMode(false)
          }
          window.addEventListener('keydown', onKey)
          return () => window.removeEventListener('keydown', onKey)
        }, [captureMode])

        useEffect(() => {
          const root = rootRef.current
          if (!root) return undefined
          let frame = 0
          const read = () => {
            frame = 0
            if (captureModeRef.current) {
              setSelectionPop(null)
              return
            }
            const selection = document.getSelection()
            if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
              setSelectionPop(null)
              return
            }
            const range = selection.getRangeAt(0)
            if (!root.contains(range.commonAncestorContainer)) {
              setSelectionPop(null)
              return
            }
            const text = String(selection.toString() || '').trim()
            if (text.length < 2) {
              setSelectionPop(null)
              return
            }
            const rect = range.getBoundingClientRect()
            if (!rect || (rect.width === 0 && rect.height === 0)) {
              setSelectionPop(null)
              return
            }
            const rootRect = root.getBoundingClientRect()
            const anchor = range.startContainer
            const element = anchor && anchor.nodeType === 1 ? anchor : anchor && anchor.parentElement
            const pageElement = element && element.closest ? element.closest('[data-dsm-page]') : null
            const page = pageElement ? Number(pageElement.getAttribute('data-dsm-page')) : currentPageRef.current
            const above = rect.top - rootRect.top - 36
            setSelectionPop({
              left: rect.left + rect.width / 2 - rootRect.left,
              top: above >= 6 ? above : rect.bottom - rootRect.top + 8,
              text,
              page,
            })
          }
          const schedule = () => {
            if (frame) return
            frame = requestAnimationFrame(read)
          }
          const clear = () => setSelectionPop(null)
          document.addEventListener('selectionchange', schedule)
          const scroller = scrollRef.current
          if (scroller) scroller.addEventListener('scroll', clear, { passive: true })
          return () => {
            document.removeEventListener('selectionchange', schedule)
            if (scroller) scroller.removeEventListener('scroll', clear)
            if (frame) cancelAnimationFrame(frame)
          }
        }, [])

        /** Quote the selected text into the composer, with its file and page. */
        const addSelection = useCallback(() => {
          const current = selectionPop
          if (!current) return
          try {
            if (inputActions && typeof inputActions.insertText === 'function') {
              const reference = t('referenceLine', { path: pathOfAddress(address), page: current.page }) + '\n'
              inputActions.insertText(reference, inputActions.captureInsertion())
            }
            if (inputActions && typeof inputActions.insertQuote === 'function') {
              inputActions.insertQuote(current.text)
            }
          } catch (error) {
            console.error('[study-mode] selection insert failed', error)
          }
          setSelectionPop(null)
          const selection = document.getSelection()
          if (selection) selection.removeAllRanges()
          focusComposer(sessionId)
        }, [selectionPop, address, inputActions, sessionId])

        const pages = []
        if (status === 'ready' && doc) {
          for (let index = 1; index <= numPages; index += 1) {
            pages.push(
              h(PdfPage, {
                key: index,
                doc,
                index,
                scale,
                baseSize,
                registerCanvas,
              }),
            )
          }
        }

        if (status === 'error') {
          return h(FailureCard, {
            error: failure,
            onRetry: () => {
              dataRef.current = null
              setAttempt(value => value + 1)
            },
          })
        }

        return h(
          'div',
          { className: 'dsm-root', ref: rootRef },
          h(StyleTag),
          h(
            'div',
            { className: 'dsm-toolbar' },
            h(
              'button',
              { className: 'dsm-icon', type: 'button', title: t('prevPage'), disabled: currentPage <= 1, onClick: () => goToPage(currentPage - 1) },
              h(Icon, { name: 'left' }),
            ),
            h('span', { className: 'dsm-page-label' }, status === 'ready' ? currentPage + ' / ' + numPages : '–'),
            h(
              'button',
              { className: 'dsm-icon', type: 'button', title: t('nextPage'), disabled: status !== 'ready' || currentPage >= numPages, onClick: () => goToPage(currentPage + 1) },
              h(Icon, { name: 'right' }),
            ),
            h('span', { className: 'dsm-sep' }),
            h('button', { className: 'dsm-icon', type: 'button', title: t('zoomOut'), onClick: () => setZoom(value => clamp(value - 0.1, 0.5, 3)) }, h(Icon, { name: 'minus' })),
            h('button', { className: 'dsm-zoom', type: 'button', title: t('resetZoom'), onClick: () => setZoom(1) }, Math.round(zoom * 100) + '%'),
            h('button', { className: 'dsm-icon', type: 'button', title: t('zoomIn'), onClick: () => setZoom(value => clamp(value + 0.1, 0.5, 3)) }, h(Icon, { name: 'plus' })),
            h('span', { className: 'dsm-grow' }),
            h(
              'button',
              {
                className: 'dsm-capture' + (captureMode ? ' dsm-active' : ''),
                type: 'button',
                title: t('captureHint'),
                disabled: status !== 'ready',
                onClick: () => {
                  const next = !captureMode
                  setCaptureMode(next)
                  if (!next) {
                    captureRef.current = null
                    setCapturing(false)
                    setCaptureBox(null)
                  }
                },
              },
              h(Icon, { name: 'crop' }),
              h('span', null, t('capture')),
            ),
          ),
          h(
            'div',
            { className: 'dsm-scrollwrap' },
            h(
              'div',
              { className: 'dsm-scroll', ref: scrollRef },
              status === 'ready' ? pages : h('div', { className: 'dsm-center' }, status === 'unsupported' ? t('unsupportedContent') : t('loading')),
            ),
            captureMode
              ? h(
                  'div',
                  {
                    ref: overlayRef,
                    className: 'dsm-capturelayer',
                    onPointerDown: startCapture,
                    onWheel: event => {
                      // Forward scrolling from the overlay; never move the page
                      // under an in-flight selection.
                      if (capturing) return
                      const element = scrollRef.current
                      if (element) element.scrollTop += event.deltaY
                    },
                  },
                  captureBox
                    ? h('div', {
                        className: 'dsm-capturebox',
                        style: {
                          left: captureBox.left + 'px',
                          top: captureBox.top + 'px',
                          width: captureBox.width + 'px',
                          height: captureBox.height + 'px',
                        },
                      })
                    : null,
                  h('div', { className: 'dsm-capturehint' }, t('captureHint')),
                )
              : null,
          ),
          selectionPop
            ? h(
                'button',
                {
                  className: 'dsm-selpop',
                  type: 'button',
                  style: { left: selectionPop.left + 'px', top: selectionPop.top + 'px' },
                  onMouseDown: event => event.preventDefault(),
                  onClick: addSelection,
                },
                h(Icon, { name: 'crop' }),
                h('span', null, t('addSelection')),
              )
            : null,
          toast ? h('div', { className: 'dsm-toast' + (toast.level === 'error' ? ' dsm-error' : '') }, toast.text) : null,
        )
      }

      /**
       * The study-mode start page: pick a PDF in the system dialog, or open one
       * already in the workspace. Picking hands the address to this tab's own
       * pane and closes the start page.
       */
      function Launcher(props) {
        useLocaleTick()
        const sessionId = props.sessionId
        const tabInfo = typeof props.useTabInfo === 'function' ? props.useTabInfo() : undefined
        const [listing, setListing] = useState({ path: '', entries: [] })
        const [folder, setFolder] = useState('')
        const [status, setStatus] = useState('loading')
        const [failure, setFailure] = useState(null)
        const [reload, setReload] = useState(0)
        const [busy, setBusy] = useState(false)
        const [notice, setNotice] = useState(null)
        const fileInputRef = useRef(null)

        const openPath = useCallback(
          rawPath => {
            const target = String(rawPath || '').trim()
            if (!target) return
            const address = fileAddressOf(sessionId, target)
            const actions = tabInfo && tabInfo.tab && tabInfo.tab.actions
            try {
              if (actions && typeof actions.openResource === 'function') {
                actions.openResource(address)
                actions.close()
                return
              }
              const sidebar = ctx.sidebarRight
              if (sidebar && typeof sidebar.openResourceIn === 'function') sidebar.openResourceIn(sessionId, address)
              else if (sidebar) sidebar.openResource(address)
            } catch (error) {
              console.error('[study-mode] could not open the PDF', error)
              setNotice(describeFailure(error))
            }
          },
          [sessionId, tabInfo],
        )

        useEffect(() => {
          let alive = true
          const controller = new AbortController()
          setStatus('loading')
          setFailure(null)
          ;(async () => {
            try {
              const remote = ctx.remote
              if (!remote || !remote.workspaceFiles) throw new Error('workspaceFiles remote unavailable')
              const result = await remote.workspaceFiles.list(sessionId, folder === '' ? '.' : folder, controller.signal)
              if (!alive) return
              if (!result.ok) {
                setFailure(result.error)
                setStatus('error')
                return
              }
              setListing({ path: result.value.path, entries: result.value.entries })
              setStatus('ready')
            } catch (error) {
              if (!alive) return
              if (error && error.name === 'AbortError') return
              console.error('[study-mode] directory listing failed', error)
              setFailure(error)
              setStatus('error')
            }
          })()
          return () => {
            alive = false
            controller.abort()
          }
        }, [sessionId, folder, reload])

        /** Stage one picked file through the Host, then open the returned path. */
        const openPickedFile = useCallback(
          async file => {
            setBusy(true)
            setNotice(null)
            try {
              const response = await fetch(UPLOAD_PATH, {
                method: 'POST',
                headers: {
                  'content-type': 'application/pdf',
                  'x-dsm-filename': encodeURIComponent(file.name || 'document.pdf'),
                },
                body: file,
              })
              const body = response.ok ? await response.json() : null
              if (!body || typeof body.path !== 'string') {
                throw new Error((body && body.error) || 'HTTP ' + response.status)
              }
              openPath(body.path)
            } catch (error) {
              console.error('[study-mode] upload failed', error)
              setNotice(t('uploadFailed') + '：' + describeFailure(error))
            } finally {
              setBusy(false)
            }
          },
          [openPath],
        )

        const onPick = useCallback(
          event => {
            const input = event.currentTarget
            const file = input.files && input.files[0]
            input.value = ''
            if (!file) return
            if (!isSupportedFile(file.name || '')) {
              setNotice(t('notSupported'))
              return
            }
            void openPickedFile(file)
          },
          [openPickedFile],
        )

        const rows = useMemo(() => {
          const directories = listing.entries
            .filter(entry => entry.type === 'directory')
            .sort((a, b) => a.name.localeCompare(b.name))
          const files = listing.entries
            .filter(entry => entry.type === 'file' && isSupportedFile(entry.name))
            .sort((a, b) => a.name.localeCompare(b.name))
          return directories.concat(files)
        }, [listing])

        const join = name => (listing.path ? listing.path + '/' + name : name)
        const parent = listing.path.includes('/') ? listing.path.slice(0, listing.path.lastIndexOf('/')) : ''

        return h(
          'div',
          { className: 'dsm-launcher' },
          h(StyleTag),
          h('h2', { className: 'dsm-h1' }, t('launcherTitle')),
          h('p', { className: 'dsm-hint' }, t('launcherHint')),
          h(
            'div',
            { className: 'dsm-pick' },
            h('input', {
              ref: fileInputRef,
              type: 'file',
              accept: '.pdf,.md,.markdown,.doc,.docx,.ppt,.pptx,application/pdf,text/markdown',
              style: { display: 'none' },
              onChange: onPick,
            }),
            h(
              'button',
              {
                className: 'dsm-button',
                type: 'button',
                disabled: busy,
                onClick: () => {
                  if (fileInputRef.current) fileInputRef.current.click()
                },
              },
              busy ? t('opening') : t('pickFromFinder'),
            ),
            h('span', { className: 'dsm-hint' }, t('pickHint')),
          ),
          notice ? h('div', { className: 'dsm-line' }, notice) : null,
          h(
            'div',
            { className: 'dsm-group' },
            h('span', { className: 'dsm-label' }, t('workspaceTitle')),
            h(
              'div',
              { className: 'dsm-crumb' },
              listing.path === ''
                ? null
                : h(
                    'button',
                    { className: 'dsm-icon', type: 'button', title: t('up'), onClick: () => setFolder(parent) },
                    h(Icon, { name: 'up' }),
                  ),
              h('span', { className: 'dsm-crumb-text' }, '/' + (listing.path || '')),
              h('button', { className: 'dsm-icon', type: 'button', title: t('loadingDir'), onClick: () => setReload(value => value + 1) }, h(Icon, { name: 'file' })),
            ),
            h(
              'div',
              { className: 'dsm-list' },
              status === 'loading' ? h('div', { className: 'dsm-empty' }, t('loadingDir')) : null,
              status === 'error' ? h('div', { className: 'dsm-empty' }, t('dirFailed') + '：' + describeFailure(failure)) : null,
              status === 'ready' && rows.length === 0 ? h('div', { className: 'dsm-empty' }, t('emptyDir')) : null,
              status === 'ready'
                ? rows.map(entry => {
                    const isDirectory = entry.type === 'directory'
                    return h(
                      'button',
                      {
                        key: (isDirectory ? 'd:' : 'f:') + entry.name,
                        className: 'dsm-item',
                        type: 'button',
                        title: join(entry.name),
                        onClick: () => (isDirectory ? setFolder(join(entry.name)) : openPath(join(entry.name))),
                      },
                      h('span', { className: 'dsm-item-icon' }, h(Icon, { name: isDirectory ? 'folder' : 'file' })),
                      h('span', { className: 'dsm-item-name' }, entry.name),
                      h('span', { className: 'dsm-item-meta' }, isDirectory ? '' : formatBytes(entry.size)),
                    )
                  })
                : null,
            ),
          ),
        )
      }

      /** Body registered under the document implementation id. */
      function StudyPanelBoundary(props) {
        return h(Boundary, null, h(StudyPanel, props))
      }

      /** Body registered under the start page's id. */
      function LauncherBoundary(props) {
        return h(Boundary, null, h(Launcher, props))
      }

      return { StudyPanel: StudyPanelBoundary, Launcher: LauncherBoundary }
    }

    let pdfjsPromise = null

    /** Load the vendored PDF.js runtime served by the Host half, once. */
    function loadPdfjs() {
      if (!pdfjsPromise) {
        pdfjsPromise = (async () => {
          const lib = await import(ASSET_BASE + 'build/pdf.min.mjs')
          lib.GlobalWorkerOptions.workerSrc = ASSET_BASE + 'build/pdf.worker.min.mjs'
          return lib
        })().catch(error => {
          pdfjsPromise = null
          throw error
        })
      }
      return pdfjsPromise
    }

    /** Reading positions survive reloads; addresses are stable per file content. */
    const POSITION_KEY = 'dsh.study-mode.positions.v1'
    /** Oldest addresses are dropped once the store grows past this. */
    const POSITION_LIMIT = 300
    /** Parsed store, read once from localStorage. */
    let positionStore = null
    /** Pending debounced write of the store. */
    let positionFlush = 0

    function readPositions() {
      if (positionStore) return positionStore
      positionStore = {}
      try {
        const raw = window.localStorage.getItem(POSITION_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) positionStore = parsed
      } catch (error) {
        console.error('[study-mode] reading positions unreadable', error)
      }
      return positionStore
    }

    /** Last page and zoom recorded for one document address. */
    function positionOf(address) {
      const value = readPositions()[address]
      return value && typeof value === 'object' ? value : null
    }

    /** Record one document's position, writing the store out shortly after. */
    function rememberPosition(address, value) {
      const store = readPositions()
      store[address] = value
      const keys = Object.keys(store)
      for (const key of keys.slice(0, Math.max(0, keys.length - POSITION_LIMIT))) delete store[key]
      if (positionFlush) return
      positionFlush = setTimeout(() => {
        positionFlush = 0
        try {
          window.localStorage.setItem(POSITION_KEY, JSON.stringify(store))
        } catch (error) {
          console.error('[study-mode] reading positions unwritable', error)
        }
      }, 400)
    }

    /**
     * Paint the page's text items as transparent, selectable spans over the
     * canvas. Each span is scaled horizontally to the width the PDF records, so
     * a selection rectangle lands where the glyphs are.
     * @param lib - the loaded PDF.js module.
     * @param page - one page proxy.
     * @param container - the layer element for this page.
     * @param scale - CSS pixels per PDF point.
     */
    async function buildTextLayer(lib, page, container, scale) {
      container.textContent = ''
      const textContent = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })
      const spans = []
      for (const item of textContent.items) {
        if (!item || typeof item.str !== 'string' || item.str.trim() === '') continue
        const matrix = lib.Util.transform(viewport.transform, item.transform)
        const fontHeight = Math.hypot(matrix[2], matrix[3])
        if (!(fontHeight > 0)) continue
        const span = document.createElement('span')
        span.textContent = item.str
        span.style.left = matrix[4] * scale + 'px'
        span.style.top = (matrix[5] - fontHeight) * scale + 'px'
        span.style.fontSize = fontHeight * scale + 'px'
        container.appendChild(span)
        spans.push({ span, width: (item.width || 0) * scale })
      }
      if (spans.length === 0) return
      const measured = spans.map(entry => entry.span.getBoundingClientRect().width)
      for (let index = 0; index < spans.length; index += 1) {
        const target = spans[index].width
        const natural = measured[index]
        if (natural > 0 && target > 0) spans[index].span.style.transform = 'scaleX(' + (target / natural).toFixed(4) + ')'
      }
    }

    return {
      inject: [
        'slots',
        'locale',
        'documentPreviews',
        'conversation',
        'sidebarRight',
        'sidebarRightTabs',
        'remote',
        'remote.workspaceFiles',
        'sessions',
      ],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'study-mode: copy')
        const t = ctx.locale.bind(NS)
        const ui = buildUi(ctx, t)

        ctx.effect(
          () =>
            ctx.documentPreviews.register({
              id: IMPL_ID,
              extensions: ['pdf'],
              binaryExtensions: ['pdf'],
              priority: 'extension',
              title: () => t('implLabel'),
              loading: 'bytes-complete',
            }),
          'study-mode: PDF document implementation',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.tab.document', () =>
              ctx.slots.register({ name: 'sidebar.right.tab.document', key: IMPL_ID }, ui.StudyPanel),
            ),
          'study-mode: PDF panel body',
        )

        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: LAUNCHER_ID,
              kind: LAUNCHER_KIND,
              title: () => t('openPanel'),
              guide: [
                {
                  id: 'study-mode',
                  order: 30,
                  title: () => t('openPanel'),
                  description: () => t('guideDescription'),
                },
              ],
            }),
          'study-mode: start page type',
        )

        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register({ name: 'sidebar.right.pane.tab', key: LAUNCHER_ID }, ui.Launcher),
            ),
          'study-mode: start page body',
        )
      },
    }
  },
})
