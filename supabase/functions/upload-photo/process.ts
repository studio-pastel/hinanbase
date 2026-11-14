// 投稿写真の加工：画素だけを取り出して JPEG に再エンコードする。
// EXIF（位置情報・撮影日時・機種など）を含むメタデータは、この過程で必ず落ちる（CLAUDE.md 絶対ルール 9）。
import { decode, Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts'

export const MAX_EDGE = 1600
export const MAX_INPUT_BYTES = 8 * 1024 * 1024

export async function stripAndResize(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength > MAX_INPUT_BYTES) throw new Error('画像が大きすぎます')
  const decoded = await decode(input)
  if (!(decoded instanceof Image)) throw new Error('対応していない画像形式です')
  const scale = Math.min(1, MAX_EDGE / Math.max(decoded.width, decoded.height))
  const image = scale < 1 ? decoded.resize(Math.round(decoded.width * scale), Math.round(decoded.height * scale)) : decoded
  return await image.encodeJPEG(82)
}

/** JPEG に APP1（Exif / XMP）などのメタデータ用セグメントが残っていないか */
export function hasMetadataSegments(jpeg: Uint8Array): boolean {
  let i = 2
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1]
    if (marker === 0xda) break // 画像データの開始
    // APP1〜APP15（APP0 は JFIF ヘッダーなので除く）とコメント
    if ((marker >= 0xe1 && marker <= 0xef) || marker === 0xfe) return true
    i += 2 + ((jpeg[i + 2] << 8) | jpeg[i + 3])
  }
  return false
}
