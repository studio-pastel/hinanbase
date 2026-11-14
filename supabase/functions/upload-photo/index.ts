// 投稿写真のアップロード（SPEC §4.5）。
// ログイン済みの利用者から画像を受け取り、EXIF を除去・縮小してから R2 に保存する。除去前のファイルはどこにも保存しない。
//
// 必要な秘密情報（supabase secrets set で設定。リポジトリには入れない）：
//   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / PHOTO_PUBLIC_BASE_URL
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20'
import { MAX_INPUT_BYTES, stripAndResize } from './process.ts'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://hinanbase.pages.dev,http://localhost:5173').split(',')

function cors(req: Request): HeadersInit {
  const origin = req.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'POST のみ受け付けます' })

  // ログイン済みの利用者だけ
  const authorization = req.headers.get('Authorization') ?? ''
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return json(req, 401, { error: 'ログインが必要です' })

  const declared = Number(req.headers.get('Content-Length') ?? '0')
  if (declared > MAX_INPUT_BYTES) return json(req, 413, { error: '画像が大きすぎます' })
  const input = new Uint8Array(await req.arrayBuffer())
  if (input.byteLength === 0) return json(req, 400, { error: '画像がありません' })

  let output: Uint8Array
  try {
    output = await stripAndResize(input)
  } catch (e) {
    return json(req, 400, { error: (e as Error).message })
  }

  const now = new Date()
  const key = `photos/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.jpg`
  const r2 = new AwsClient({
    accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
    service: 's3',
    region: 'auto',
  })
  const endpoint = `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${Deno.env.get('R2_BUCKET')}/${key}`
  const put = await r2.fetch(endpoint, {
    method: 'PUT',
    body: output as BodyInit,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' },
  })
  if (!put.ok) {
    console.error('R2 への保存に失敗', put.status, await put.text())
    return json(req, 502, { error: '写真を保存できませんでした' })
  }
  const base = (Deno.env.get('PHOTO_PUBLIC_BASE_URL') ?? '').replace(/\/+$/, '')
  return json(req, 200, { url: `${base}/${key}` })
})
