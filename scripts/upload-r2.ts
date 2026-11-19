// data/build/ の公開用ファイルを Cloudflare R2 に同期する（SPEC §5.6）
//
// 認証は2通り。どちらもリポジトリやフロントのビルドには含めない。
//   1) R2 の S3 互換 API：環境変数 CLOUDFLARE_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY がある場合
//   2) wrangler のログイン：上記がない場合。プロジェクト内の .wrangler/auth にログイン情報があればそれを使う
//
// 同期はアップロードのみ。R2 側のファイルは削除しない（同じバケットに投稿写真を置く予定のため）。
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { BUILD_DIR, ROOT } from './lib/paths.ts'

const bucket = process.env.R2_BUCKET
if (!bucket) throw new Error('環境変数 R2_BUCKET が未設定です（.env.example を参照）')

/** 公開するのはこれらと meta.json だけ。intermediate/ と merge_candidates.json は上げない */
const PUBLIC_DIRS = ['tiles', 'facilities', 'summary', 'points', 'geocode']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}
// 日次ビルドでは geocode/ を作らない（元データが手元にしかない）。ないフォルダは飛ばし、R2 側の既存のファイルを残す
const files = [...PUBLIC_DIRS.filter((d) => existsSync(join(BUILD_DIR, d))).flatMap((d) => walk(join(BUILD_DIR, d))), join(BUILD_DIR, 'meta.json')]

const contentType = (p: string) => (p.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream')
// 施設データと集計は日次で変わるので短め
const CACHE_CONTROL = 'public, max-age=300'
const keyOf = (file: string) => relative(BUILD_DIR, file).split(sep).join('/')
const md5Of = (file: string) => createHash('md5').update(readFileSync(file)).digest('hex')

let uploaded = 0
let skipped = 0
const failed: string[] = []

async function runPool(worker: (file: string) => Promise<void>, concurrency: number) {
  const queue = [...files]
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let file = queue.pop(); file; file = queue.pop()) {
        try {
          await worker(file)
        } catch (e) {
          failed.push(`${keyOf(file)}: ${(e as Error).message.split('\n')[0]}`)
        }
        const done = uploaded + skipped + failed.length
        if (done % 200 === 0) console.log(`  ${done} / ${files.length}`)
      }
    }),
  )
}

const s3Keys = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const
if (s3Keys.every((k) => process.env[k])) {
  console.log(`S3 互換 API で ${bucket} に同期します（${files.length} ファイル）`)
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  })
  await runPool(async (file) => {
    const key = keyOf(file)
    const body = readFileSync(file)
    const md5 = createHash('md5').update(body).digest('hex')
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      if (head.ETag === `"${md5}"`) { skipped++; return }
    } catch (e) {
      if ((e as { name?: string }).name !== 'NotFound') throw e
    }
    await client.send(new PutObjectCommand({
      Bucket: bucket, Key: key, Body: body, ContentType: contentType(file), CacheControl: CACHE_CONTROL,
    }))
    uploaded++
  }, 8)
} else {
  // wrangler 経由。R2 側の状態を安く調べる手段がないので、上げ終えたファイルの MD5 を手元に記録して差分だけ上げる
  console.log(`wrangler で ${bucket} に同期します（${files.length} ファイル）`)
  const run = promisify(execFile)
  const wrangler = join(ROOT, 'node_modules', '.bin', 'wrangler')
  const authDir = join(ROOT, '.wrangler', 'auth')
  const env = existsSync(authDir) ? { ...process.env, XDG_CONFIG_HOME: authDir } : process.env
  const manifestPath = join(BUILD_DIR, `.upload-manifest.${bucket}.json`)
  const manifest: Record<string, string> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest))
  try {
    await runPool(async (file) => {
      const key = keyOf(file)
      const md5 = md5Of(file)
      if (manifest[key] === md5) { skipped++; return }
      await run(
        wrangler,
        ['r2', 'object', 'put', `${bucket}/${key}`, '--file', file, '--remote', '--content-type', contentType(file), '--cache-control', CACHE_CONTROL],
        { env, maxBuffer: 16 * 1024 * 1024 },
      )
      manifest[key] = md5
      uploaded++
      if (uploaded % 50 === 0) save()
    }, 8)
  } finally {
    save()
  }
}

console.log(`R2 へ同期: アップロード ${uploaded} 件 / 変更なし ${skipped} 件 / 失敗 ${failed.length} 件`)
if (failed.length > 0) {
  console.error(failed.slice(0, 10).join('\n'))
  process.exit(1)
}
