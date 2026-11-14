// 実行：deno test supabase/functions/upload-photo/process_test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { decode, Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'
import { hasMetadataSegments, MAX_EDGE, stripAndResize } from './process.ts'

/** GPS を含むことを模した Exif セグメント（APP1）を、JPEG の先頭に差し込む */
function withExif(jpeg: Uint8Array): Uint8Array {
  const payload = new TextEncoder().encode('Exif\0\0GPSLatitude=35.6812;GPSLongitude=139.7671;Model=TestPhone')
  const len = payload.length + 2
  const app1 = new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...payload])
  return new Uint8Array([...jpeg.slice(0, 2), ...app1, ...jpeg.slice(2)])
}
const contains = (bytes: Uint8Array, text: string) => new TextDecoder('latin1').decode(bytes).includes(text)

Deno.test('EXIF 付きの写真から、メタデータがすべて落ちる', async () => {
  const src = withExif(await new Image(800, 600).fill(0x3366ccff).encodeJPEG(90))
  assert(hasMetadataSegments(src), '入力に EXIF が入っていること')
  assert(contains(src, 'GPSLatitude'))

  const out = await stripAndResize(src)
  assertEquals([out[0], out[1]], [0xff, 0xd8], 'JPEG であること')
  assert(!hasMetadataSegments(out), '出力にメタデータ用のセグメントがないこと')
  assert(!contains(out, 'GPSLatitude') && !contains(out, 'Exif') && !contains(out, 'TestPhone'))
  const img = await decode(out) as Image
  assertEquals([img.width, img.height], [800, 600])
})

Deno.test('大きな写真は長辺 1600px に縮小する', async () => {
  const out = await stripAndResize(await new Image(3200, 1200).fill(0xffffffff).encodeJPEG(90))
  const img = await decode(out) as Image
  assertEquals([img.width, img.height], [MAX_EDGE, 600])
})

Deno.test('PNG も JPEG にして返す', async () => {
  const out = await stripAndResize(await new Image(100, 50).fill(0x00ff00ff).encode())
  assertEquals([out[0], out[1]], [0xff, 0xd8])
})

Deno.test('画像でないものは拒否する', async () => {
  let failed = false
  try { await stripAndResize(new TextEncoder().encode('not an image')) } catch { failed = true }
  assert(failed)
})
