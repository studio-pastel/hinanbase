import { describe, expect, it } from 'vitest'
import { signInRedirectUrl, takeAuthErrorFromUrl } from '../src/lib/authUrl.ts'

function fake(url: string) {
  const u = new URL(url)
  const loc = { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash }
  const replaced: string[] = []
  const history = { state: null, replaceState: (_s: unknown, _t: string, to?: string | URL | null) => { replaced.push(String(to)) } }
  return { loc, history, replaced }
}

describe('ログインの戻り先 URL', () => {
  it('クエリとハッシュを付けない（前回のエラー情報や認証コードを引き継がない）', () => {
    const { loc } = fake('http://localhost:5173/f/99999/TEST/report?code=old#error=server_error&error_description=x')
    expect(signInRedirectUrl(loc)).toBe('http://localhost:5173/f/99999/TEST/report')
  })
})

describe('URL に残った認証エラーの取り出し', () => {
  it('ハッシュのエラーを読み取り、URL から消す', () => {
    const { loc, history, replaced } = fake(
      'http://localhost:5173/f/1/2/report#error=server_error&error_code=unexpected_failure&error_description=Unable+to+exchange+external+code%253A+4%252F0A',
    )
    expect(takeAuthErrorFromUrl(loc, history)).toBe('Unable to exchange external code')
    expect(replaced).toEqual(['/f/1/2/report'])
  })

  it('クエリのエラーも消すが、ほかのクエリは残す', () => {
    const { loc, history, replaced } = fake('http://localhost:5173/removal-request?facility=E01&error=access_denied&error_description=denied')
    expect(takeAuthErrorFromUrl(loc, history)).toBe('denied')
    expect(replaced).toEqual(['/removal-request?facility=E01'])
  })

  it('エラーがなければ何もしない（ログイン成功時の情報には触れない）', () => {
    const { loc, history, replaced } = fake('http://localhost:5173/f/1/2/report#access_token=abc&refresh_token=def')
    expect(takeAuthErrorFromUrl(loc, history)).toBeNull()
    expect(replaced).toEqual([])
  })
})

describe('日付の表示', () => {
  it('日時を日本時間の日付にする（UTC では前日になる時刻でも）', async () => {
    const { jstDate } = await import('../src/i18n/ja.ts')
    expect(jstDate('2026-11-14T17:10:45.000Z')).toBe('2026-11-15')
    expect(jstDate('2026-11-14T14:59:59.000Z')).toBe('2026-11-14')
  })
})
