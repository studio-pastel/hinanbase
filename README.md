# HinanBase（全国避難所リスク可視化サービス）

全国の指定緊急避難場所・指定避難所について、公的データが持っている情報と、避難生活に必要な情報とのギャップを可視化する Web アプリケーションです。

- 平常時の課題の可視化を目的としています。**災害時は必ずお住まいの自治体の公式情報に従ってください。**
- 特定の施設を「危険」と判定するものではありません。情報が欠けている項目は「未確認」「未評価」と表示します。

仕様は [docs/SPEC.md](docs/SPEC.md)、データに関する調査結果と決定事項は [docs/DATA_NOTES.md](docs/DATA_NOTES.md)、公開手順は [docs/DEPLOY.md](docs/DEPLOY.md) にあります。

## 現在の状態

Phase 1（地図に全国の避難所が出る）は公開済みです（ https://hinanbase.pages.dev/ ）。設備情報はまだ1件もないため、全施設が「未確認」として表示されます。

Phase 2（市民投稿）と Phase 3（軸C の点数、表示状態の色分け、「冷房なし」の絞り込み）も公開済みです。写真アップロードと日次ビルドの自動実行は、認証情報の設定待ちです（[docs/DATA_NOTES.md](docs/DATA_NOTES.md) の 10 章・11 章）。

## 必要なもの

- Node.js（開発時は v26）
- [tippecanoe](https://github.com/felt/tippecanoe)（`brew install tippecanoe`）

## データの準備

元データはリポジトリに含めていません。

1. 国土地理院の[指定緊急避難場所・指定避難所データ ダウンロードサイト](https://hinanmap.gsi.go.jp/index.html)で「ご利用上の注意」に同意し、全国分の2つ（指定避難所・指定緊急避難場所）をダウンロードする。
2. 展開したフォルダ `mergeFromCity_1/`・`mergeFromCity_2/` を、ダウンロードした日付のフォルダに置く。

```
data/raw/2026-11-11/mergeFromCity_1/mergeFromCity_1.csv   指定避難所
data/raw/2026-11-11/mergeFromCity_2/mergeFromCity_2.csv   指定緊急避難場所
```

ビルドは `data/raw/` の中で最も新しい日付のフォルダを使います。

## 使い方

```bash
npm install
cp .env.example .env.local     # VITE_DATA_BASE_URL=http://localhost:8787 のままでよい
npm run data:build             # data/build/ に PMTiles と JSON を生成（1分弱）
npm run data:serve             # data/build/ を http://localhost:8787 で配信（Range 対応）
npm run dev                    # 別のターミナルで。http://localhost:5173
```

| コマンド | 内容 |
|---|---|
| `npm run data:facilities` | CSV 2本を読み、施設に統合して市区町村ごとの JSON を作る。`data/registry/facility-ids.csv` を更新する |
| `npm run data:rescore` | Supabase の確定設備値を市区町村 JSON に載せ、4 軸の点数を算出し直す |
| `npm run data:tiles` | tippecanoe で `tiles/shelters.pmtiles` を作る |
| `npm run data:summaries` | 全国集計・市区町村の索引・`meta.json` を作る |
| `npm run data:sync` | 施設索引と設備項目マスタを Supabase に同期する（要 service role key） |
| `npm run data:upload` | `data/build/` の公開用ファイルを Cloudflare R2 に同期する（要認証情報） |
| `npm run lint` / `npm run typecheck` / `npm test` | Lint、型チェック、テスト |
| `npm run build` | フロントエンドの本番ビルド（`dist/`） |

## `data/registry/facility-ids.csv` について

国土地理院の共通ID と、このサービスの `facility_id` の対応表です。**Git で管理し、手で編集しないでください。** 元データを取り込み直しても施設の ID が変わらないようにするためのもので、市民投稿（Phase 2〜）はこの ID に紐づきます。`npm run data:facilities` を実行すると更新されるので、元データを更新したときは一緒にコミットします。

## 構成

```
config/amenity-defs.json   設備項目マスタ（唯一の正。画面はここから構築する）
shared/                    スクリプトとフロントで共有する型
scripts/                   ビルドスクリプト（TypeScript）
src/                       フロントエンド（React + Vite）
src/lib/map/               地図の実装（MapAdapter 経由で使う）
src/i18n/ja.ts             UI の文言（すべてここに置く）
tests/                     テスト
data/raw/                  元データ（Git 管理外）
data/build/                生成物（Git 管理外）
data/registry/             facility_id の対応表（Git 管理）
supabase/migrations/       テーブル定義・権限・投稿処理の SQL
supabase/functions/        Edge Function（写真の EXIF 除去と R2 への保存）
supabase/tests/            データベースの検証用 SQL
```

## 出典

- 国土地理院「指定緊急避難場所・指定避難所データ」（ https://hinanmap.gsi.go.jp/ ）を加工して作成
- 背景地図：[地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)

このデータは最新でない場合や、未掲載の施設がある場合があります。最新かつ詳細の状況は当該市町村にご確認ください。指定緊急避難場所と指定避難所は別の指定であり、指定緊急避難場所は災害の種類ごとに指定されています。

## ライセンス

本サービスが生成する集計データは CC BY 4.0 で提供します。ソースコードのライセンスは未定です。
