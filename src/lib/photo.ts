// 投稿写真のアップロード。EXIF の除去はサーバー側（Edge Function）で必ず行う（CLAUDE.md 絶対ルール 9）。
// ここでの縮小は通信量を減らすためのもので、EXIF 除去の代わりではない。
import { supabase } from './supabase.ts'

const MAX_EDGE = 1600

async function downscale(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), 'image/jpeg', 0.85),
  )
}

/** 写真を1枚送り、公開 URL を受け取る */
export async function uploadPhoto(file: File): Promise<string> {
  const body = await downscale(file)
  const { data, error } = await supabase!.functions.invoke('upload-photo', {
    body,
    headers: { 'Content-Type': 'image/jpeg' },
  })
  if (error) throw new Error(error.message)
  const url = (data as { url?: string } | null)?.url
  if (!url) throw new Error('写真の URL を受け取れませんでした')
  return url
}
