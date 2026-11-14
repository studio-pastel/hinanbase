// Supabase は認証・市民投稿・異議申し立てだけに使う（CLAUDE.md）。
// 地図と詳細表示は Supabase が止まっていても成立すること。
// ここで使うのは公開してよいキーだけ。service role key はフロントに含めない。
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { takeAuthErrorFromUrl } from './authUrl.ts'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

/** ログインから戻ったときに認証側が返したエラー。クライアントが URL を読む前に取り出して、URL からは消しておく */
export const initialAuthError = takeAuthErrorFromUrl()

/** 環境変数が未設定なら null（投稿機能なしで動く） */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

/** 写真アップロード用の Edge Function が配備済みか */
export const PHOTO_UPLOAD_ENABLED = import.meta.env.VITE_PHOTO_UPLOAD_ENABLED === 'true'
