/**
 * Host half of the study-mode bundle.
 *
 * It owns the two things the browser cannot do on its own:
 *
 * 1. The PDF.js runtime the Client half imports dynamically. A browser plugin
 *    bundle cannot `import` an npm package, and the shipped PDF renderer is
 *    bundled inside its own chunk, so this bundle vendors the same release and
 *    serves it from a plain prefix route.
 * 2. One upload endpoint for a document picked in the system file dialog: the
 *    browser has the bytes but no path, and the viewer reads files by path, so
 *    the bytes are staged under the OS temporary directory and the path comes
 *    back in the response. The staging directory is derived from the file's
 *    content, so picking the same PDF again returns the same path — the reading
 *    position the viewer stores for that path keeps matching.
 *
 * Reads are served from this package's own directory only: an unknown path, a
 * malformed escape, or one that resolves outside `vendor/pdfjs` answers 404.
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The route prefix this bundle owns; no other plugin registers under it. */
const ROUTE = '/dsh-study-mode'
/** Exact route that accepts one picked PDF. */
const UPLOAD_PATH = ROUTE + '/upload'
/** Files the browser half may load, relative to this package. */
const ASSET_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor', 'pdfjs')
/** Asset URL prefix inside {@link ROUTE}. */
const ASSET_PREFIX = '/assets/pdfjs/'
/** Largest picked document this endpoint accepts. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024

/** Document kinds the study panel can open through the document tab. */
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.md', '.markdown', '.doc', '.docx', '.ppt', '.pptx'])

/** Media type per served extension; PDF.js asks for every suffix it ships. */
const MEDIA_TYPES = {
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/**
 * Service this plugin cannot work without: the HTTP carrier it registers its
 * routes on. The bundle is inactive in a profile that has no web server.
 */
export const inject = ['webServer']

/**
 * One 404 with a plain body; every refusal in the asset route looks the same.
 * @returns the response.
 */
function notFound() {
  return new Response('not found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Answer `GET`/`HEAD` for one PDF.js asset.
 * @param request - the Fetch request the route resource receives.
 * @returns the response.
 */
async function answerAsset(request) {
  const pathname = new URL(request.url).pathname
  if (!pathname.startsWith(ROUTE)) return notFound()
  const rest = pathname.slice(ROUTE.length)
  if (!rest.startsWith(ASSET_PREFIX)) return notFound()
  let segments
  try {
    segments = rest
      .slice(ASSET_PREFIX.length)
      .split('/')
      .map(segment => decodeURIComponent(segment))
  } catch {
    return notFound()
  }
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes('\0')) {
      return notFound()
    }
  }
  const absolute = path.join(ASSET_ROOT, ...segments)
  if (!absolute.startsWith(ASSET_ROOT + path.sep)) return notFound()
  let data
  try {
    data = await fs.readFile(absolute)
  } catch {
    return notFound()
  }
  return new Response(data, {
    headers: {
      'content-type': MEDIA_TYPES[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    },
  })
}

/**
 * Keep a picked file name usable as a path segment: no separators, no control
 * characters, no reserved punctuation, extension preserved.
 * @param raw - the percent-encoded name the browser sent.
 * @returns one safe file name.
 */
function safeFileName(raw) {
  let name = ''
  try {
    name = decodeURIComponent(String(raw ?? ''))
  } catch {
    name = ''
  }
  name = name.replace(/\\/g, '/')
  name = name.slice(name.lastIndexOf('/') + 1)
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>:"|?*]/g, '_').trim()
  if (name === '' || name === '.' || name === '..') name = 'document.pdf'
  return name.slice(-120)
}

/**
 * Refuse content that cannot be what its own extension claims.
 * @param bytes - the uploaded body.
 * @param name - the sanitized file name.
 * @returns a failure code, or `undefined` when the upload is acceptable.
 */
function rejectContent(bytes, name) {
  const extension = path.extname(name).toLowerCase()
  const head = bytes.subarray(0, 4)
  if (bytes.length === 0) return 'empty'
  if (extension === '.pdf' && head.toString('latin1') !== '%PDF') return 'not-a-pdf'
  if (extension === '.docx' && !(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return 'not-a-docx'
  if (extension === '.doc' && !(head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)) return 'not-a-doc'
  if (extension === '.pptx' && !(head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04)) return 'not-a-pptx'
  if (extension === '.ppt' && !(head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0)) return 'not-a-ppt'
  if ((extension === '.md' || extension === '.markdown') && bytes.includes(0)) return 'not-text'
  return undefined
}

/**
 * Stage one uploaded PDF under the OS temporary directory and return its path.
 * The viewer reads it back through the workspace-files service, which accepts
 * absolute paths outside the Session workspace.
 * @param request - the incoming request.
 * @param response - the raw response to write.
 */
function upload(request, response) {
  const reply = (status, body) => {
    const text = JSON.stringify(body)
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    })
    response.end(text)
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end('method not allowed')
    return
  }
  const name = safeFileName(request.headers['x-dsm-filename'])
  if (!SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    reply(400, { error: 'unsupported-type' })
    request.resume()
    return
  }
  const chunks = []
  let size = 0
  let done = false
  request.on('data', chunk => {
    if (done) return
    size += chunk.length
    if (size > MAX_UPLOAD_BYTES) {
      done = true
      reply(413, { error: 'too-large' })
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('error', () => {
    if (done) return
    done = true
    reply(400, { error: 'read-failed' })
  })
  request.on('end', () => {
    void (async () => {
      if (done) return
      done = true
      try {
        const bytes = Buffer.concat(chunks)
        const rejected = rejectContent(bytes, name)
        if (rejected !== undefined) {
          reply(400, { error: rejected })
          return
        }
        const digest = createHash('sha1').update(bytes).digest('hex').slice(0, 20)
        const directory = path.join(os.tmpdir(), 'dsh-study-mode', digest)
        const target = path.join(directory, name)
        try {
          const existing = await fs.stat(target)
          if (existing.size === bytes.length) {
            reply(200, { path: target })
            return
          }
        } catch {}
        await fs.mkdir(directory, { recursive: true })
        const temporary = target + '.' + Date.now() + '.part'
        await fs.writeFile(temporary, bytes)
        await fs.rename(temporary, target)
        reply(200, { path: target })
      } catch (error) {
        console.error('study-mode: upload failed', error)
        reply(500, { error: 'write-failed' })
      }
    })()
  })
}

/**
 * Register both routes for this bundle's lifetime.
 * @param ctx - the plugin context, carrying the web server.
 */
export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE, resource: request => answerAsset(request) }),
    'study-mode: PDF.js assets',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: UPLOAD_PATH, handler: upload }),
    'study-mode: picked PDF upload',
  )
}
