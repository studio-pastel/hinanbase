// ログインの行き帰りで使う URL の扱い。ブラウザに依存しない形にして、テストできるようにしている
type LocationLike = Pick<Location, 'origin' | 'pathname' | 'search' | 'hash'>
type HistoryLike = Pick<History, 'state' | 'replaceState'>

const AUTH_ERROR_PARAMS = ['error', 'error_code', 'error_description']

/**
 * ログインに失敗すると、認証側は戻り先の URL にエラーの説明を付けて返す。それを読み取り、URL からは取り除く。
 * 取り除かないと、その URL のまま再びログインしたときにエラー情報が戻り先に引き継がれ、
 * 成功したログインまで失敗として扱われてしまう。
 */
export function takeAuthErrorFromUrl(loc: LocationLike = window.location, history: HistoryLike = window.history): string | null {
  const hash = new URLSearchParams(loc.hash.replace(/^#/, ''))
  const search = new URLSearchParams(loc.search)
  const description =
    hash.get('error_description') ?? search.get('error_description') ?? hash.get('error') ?? search.get('error')
  if (!description) return null
  for (const k of AUTH_ERROR_PARAMS) search.delete(k)
  const hashHasError = AUTH_ERROR_PARAMS.some((k) => hash.has(k))
  const query = search.toString()
  history.replaceState(history.state, '', loc.pathname + (query ? `?${query}` : '') + (hashHasError ? '' : loc.hash))
  // 二重にエンコードされて返ることがある。認証コードの断片（コロン以降）は表示しない
  let text = description.replace(/\+/g, ' ')
  try { text = decodeURIComponent(text) } catch { /* そのまま使う */ }
  return text.split(':')[0]!.trim()
}

/** ログイン後の戻り先。クエリとハッシュは付けない（古い認証情報やエラー情報を引き継がないため） */
export function signInRedirectUrl(loc: LocationLike = window.location): string {
  return loc.origin + loc.pathname
}
