# 公開手順（Phase 1）

Cloudflare Pages（フロント）と Cloudflare R2（静的データ）を使う。どちらも無料枠の範囲で動かす前提。**有料プランが必要になる設定は入れないこと**（CLAUDE.md 絶対ルール 11）。

2026-11-14 に実施済み。実際の構成は末尾の「現在の構成」を参照。以下は同じ環境を作り直すときの手順。

## 1. R2 バケット

1. Cloudflare ダッシュボード → R2 → バケットを作成（例：`hinanbase-data`）。
2. バケットの「設定」→ 公開アクセスを有効にする。
   - 独自ドメインが未定の間は `r2.dev` の公開 URL を使う（開発用途向けでレート制限がある。正式公開時は独自ドメインを接続する。SPEC §10-5）。
3. CORS ポリシーを設定する。PMTiles は Range リクエストを使うので、`Range` ヘッダーの許可と `Content-Range` などの公開が必要。

```json
[
  {
    "AllowedOrigins": ["https://<Pages のドメイン>", "http://localhost:5173"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Range"],
    "ExposeHeaders": ["Content-Range", "Content-Length", "ETag", "Accept-Ranges"],
    "MaxAgeSeconds": 86400
  }
]
```

4. R2 の API トークン（対象バケットへの「オブジェクトの読み取りと書き込み」）を作成する。

## 2. データのアップロード

`.env.local` に次を入れる（**コミットしない。`.gitignore` 済み**）。

```
CLOUDFLARE_ACCOUNT_ID=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=hinanbase-data
```

```bash
npm run data:build
node --env-file=.env.local node_modules/.bin/tsx scripts/upload-r2.ts
```

- アップロードするのは `tiles/`、`facilities/`、`summary/`、`meta.json` だけ。`intermediate/` と `merge_candidates.json` は上げない。
- 同期はアップロードのみで、R2 側のファイルは削除しない。
- 変更のないファイルは飛ばす（MD5 で比較）。初回は約 1,730 ファイル・約 170MB。

## 3. Cloudflare Pages

1. GitHub にリポジトリを作り、push する。
2. Cloudflare ダッシュボード → Workers & Pages → Pages → Git に接続。
3. ビルド設定：

| 項目 | 値 |
|---|---|
| ビルドコマンド | `npm run build` |
| 出力ディレクトリ | `dist` |
| 環境変数 `VITE_DATA_BASE_URL` | R2 の公開 URL（末尾のスラッシュなし） |
| 環境変数 `NODE_VERSION` | `26` |

- `public/_redirects` により、`/f/…` や `/list/…` を直接開いても `index.html` が返る。
- Pages のビルドに R2 や Supabase の秘密情報を入れないこと。フロントが使う環境変数は `VITE_DATA_BASE_URL` だけ。

## 4. 公開後の確認（Phase 1 の完了条件）

1. 公開 URL を開き、全国の施設がグレーの印で表示される。
2. 拡大して任意の施設を選び、詳細ページが開く。
3. ヘッダーの掲載施設数が `meta.json` の `facility_count` と一致する。
4. `meta.json` の `source_rows` が元データの行数（DATA_NOTES 1章）と一致する。
5. 全ページ最上部にバナー、地図右下とフッターに出典が出ている。

## 現在の構成（2026-11-14）

| | 値 |
|---|---|
| Pages プロジェクト | `hinanbase`（https://hinanbase.pages.dev/） |
| R2 バケット | `hinanbase-data`（ロケーション APAC、Standard） |
| データの配信元 | バケットの `r2.dev` 公開 URL（`wrangler r2 bucket dev-url get hinanbase-data` で確認できる） |
| CORS | `config/r2-cors.json` の内容を設定済み |
| フロントの公開方法 | wrangler からの直接アップロード（GitHub 連携ではない） |

### 実際に使ったコマンド

Cloudflare のアカウントを事業ごとに分けているため、wrangler のログイン情報はこのプロジェクトのフォルダ内（`.wrangler/auth/`、Git 管理外）に保存している。コマンドの前に `XDG_CONFIG_HOME` を付けると、そのログインが使われる。

```bash
# ログイン（初回のみ。ブラウザで承認する）
XDG_CONFIG_HOME="$PWD/.wrangler/auth" npx wrangler login

# データの同期（wrangler のログインで上げる。S3 の認証情報は不要）
npm run data:build
R2_BUCKET=hinanbase-data npm run data:upload

# フロントのビルドとデプロイ
VITE_DATA_BASE_URL="<r2.dev の公開 URL>" npm run build
XDG_CONFIG_HOME="$PWD/.wrangler/auth" npx wrangler pages deploy dist --project-name hinanbase --branch main

# CORS を変えたとき
XDG_CONFIG_HOME="$PWD/.wrangler/auth" npx wrangler r2 bucket cors set hinanbase-data --file config/r2-cors.json
```

### 注意

- `data:upload` は、S3 の認証情報（`R2_ACCESS_KEY_ID` など）がなければ wrangler 経由で上げる。上げ終えたファイルの記録を `data/build/.upload-manifest.<バケット名>.json` に持ち、次回は変更のあったファイルだけ上げる。この記録を消すと全ファイルを上げ直す。
- `r2.dev` の URL は開発用途向けでレート制限がある。正式公開の前に独自ドメインを接続し、`VITE_DATA_BASE_URL` と CORS の許可元を差し替える（SPEC §10-5）。
- Pages プロジェクトは、wrangler の新しい既定（Workers への統合）ではなく従来の Cloudflare Pages として作成した（仕様 §5.2 が Cloudflare Pages を指定しているため）。

---

# Phase 2 の設定（Supabase・Google ログイン・写真）

## 現在の構成（2026-11-14）

| | 値 |
|---|---|
| Supabase プロジェクト | `hinan-base`（ref `zzfqppypnmrxhzhistpj`、リージョン ap-southeast-1、無料プラン） |
| スキーマ | `supabase/migrations/20261114000000_phase2.sql` を反映済み |
| 施設索引 | `npm run data:sync` で同期済み（139,244 件） |
| GitHub のリポジトリ変数 | `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`（どちらも公開してよい値。定期アクセス用） |

`.env.local` に入っているもの（Git 管理外）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（公開用キー）、`SUPABASE_SERVICE_ROLE_KEY`（**秘密。フロントのビルドに含めない**）。

## スキーマの反映と検証

```bash
supabase link --project-ref zzfqppypnmrxhzhistpj
supabase db query --linked -f supabase/migrations/20261114000000_phase2.sql   # 初回のみ
supabase db query --linked -f supabase/tests/phase2_functions.sql            # 検証（最後にロールバックする）
npm run data:sync                                                            # 施設索引と設備項目の同期
```

`npm run data:sync` は元データを取り込み直すたびに実行する。公的データから消えた施設は削除されず、`deprecated_at` が付く。

## Google ログイン（実施済み）

1. Google Cloud コンソールでプロジェクトを作り、「OAuth 同意画面」を設定する（公開ステータスは「本番」にしないと、テストユーザー以外はログインできない）。
2. 「認証情報」→「OAuth クライアント ID」→ 種類は「ウェブ アプリケーション」。
   - 承認済みのリダイレクト URI：`https://zzfqppypnmrxhzhistpj.supabase.co/auth/v1/callback`
   - 承認済みの JavaScript 生成元：`https://hinanbase.pages.dev`、`http://localhost:5173`
3. Supabase ダッシュボード → Authentication → Sign In / Providers → Google を有効にし、クライアント ID とシークレットを入力する（シークレットはここにだけ入れる）。
4. Authentication → URL Configuration
   - Site URL：`https://hinanbase.pages.dev`
   - Redirect URLs：`https://hinanbase.pages.dev/**`、`http://localhost:5173/**`

## 最初のモデレーターの登録（実施済み）

運営者本人が一度ログインしたあと、その利用者に役割を付ける。`<メールアドレス>` はログインに使った Google アカウント。

```bash
supabase db query --linked "update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{\"role\":\"admin\"}'::jsonb where email = '<メールアドレス>'"
```

役割はログインし直すと反映される。

## 写真アップロード（実施済み）

1. Cloudflare ダッシュボード → R2 →「API トークンを管理」で、バケット `hinanbase-data` に限定した「オブジェクトの読み取りと書き込み」のトークンを作る。アクセスキー ID とシークレットアクセスキーが表示される。
2. Edge Function の秘密情報を設定する（値はターミナルで入力し、リポジトリには入れない）。

```bash
supabase secrets set R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=hinanbase-data PHOTO_PUBLIC_BASE_URL=<r2.dev の公開 URL>
supabase functions deploy upload-photo
supabase db query --linked "update private.settings set value = to_jsonb('<r2.dev の公開 URL>/photos/'::text) where key = 'photo_base_url'"
```

3. フロントを `VITE_PHOTO_UPLOAD_ENABLED=true` を付けてビルドし直す。

`photo_base_url` を設定すると、その URL で始まる写真だけが投稿に添付できる（外部の画像 URL は拒否される）。

## フロントのビルド（Phase 2 以降）

```bash
VITE_DATA_BASE_URL="<r2.dev の公開 URL>" \
VITE_SUPABASE_URL="https://zzfqppypnmrxhzhistpj.supabase.co" \
VITE_SUPABASE_ANON_KEY="<公開用キー>" \
npm run build
XDG_CONFIG_HOME="$PWD/.wrangler/auth" npx wrangler pages deploy dist --project-name hinanbase --branch main
```

`VITE_SUPABASE_*` を付けずにビルドすると、投稿機能のない Phase 1 相当の画面になる。

## 日次ビルド（実施済み）

`.github/workflows/daily-build.yml`。毎日 04:00（日本時間）に、公開済みの施設データへ Supabase の確定設備値を載せ直し、変わったファイルだけ R2 に上げる。手動実行は GitHub の Actions 画面、または次のコマンド。

```bash
gh workflow run "Daily build" -R studio-pastel/hinanbase
```

| 種類 | 名前 |
|---|---|
| リポジトリ変数 | `DAILY_BUILD_ENABLED`（`true` で有効）、`DATA_BASE_URL`、`R2_BUCKET`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` |
| シークレット | `CLOUDFLARE_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` |

止めたいときは `DAILY_BUILD_ENABLED` を `false` にする。国土地理院のデータを取り込み直したときは、手元で `npm run data:build` と `npm run data:upload`、`npm run data:sync` を実行する（日次ビルドは元の CSV を使わない）。
