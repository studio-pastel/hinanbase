// data/build/ をローカルで配信する。PMTiles のために HTTP Range に対応する（SPEC §5.5）
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { BUILD_DIR } from './lib/paths.ts'

const PORT = Number(process.env.DATA_PORT ?? 8787)
const TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.pmtiles': 'application/octet-stream',
}

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Range')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, ETag')
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  const file = normalize(join(BUILD_DIR, pathname))
  if (!file.startsWith(BUILD_DIR + sep) || pathname.startsWith('/intermediate') || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found')
    return
  }
  const { size, mtimeMs } = statSync(file)
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('ETag', `"${size}-${Math.round(mtimeMs)}"`)
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (m && (m[1] !== '' || m[2] !== '')) {
    const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1])
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
    if (req.method === 'HEAD') { res.end(); return }
    createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Length': size })
  if (req.method === 'HEAD') { res.end(); return }
  createReadStream(file).pipe(res)
}).listen(PORT, () => console.log(`data/build を http://localhost:${PORT} で配信中`))
