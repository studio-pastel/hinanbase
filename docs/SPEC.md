# 全国避難所リスク可視化サービス 仕様書 v0.2

v0.1 からの主な変更：読み取り系データを Supabase から外し、Cloudflare R2 上の静的ファイル（PMTiles / JSON）配信に変更。固定費ゼロ（ドメイン代を除く）で運用する。

---

## 0. 設計思想（実装判断の拠り所。削らないこと）

### 0.1 このサービスが可視化するもの

このサービスは「どの避難所が危険か」を判定するものではない。可視化するのは次の2つ。

1. 公的データが持っている情報と、避難生活に必要な情報とのギャップ
2. そのギャップを埋めた結果として見えてくる、平時の整備不足

したがって **「未確認（unknown）」を第一級の状態として扱う。** 情報が欠けている避難所を灰色で大量に表示すること自体が、このサービスの最も強いメッセージになる。欠損値を推定値で埋めて地図を「きれいに」してはならない。

### 0.2 訴求の根拠となる実データ

- 公立小中学校の普通教室の空調設置率：99.6%
- 同じ学校の体育館等の空調設置率：31.7%（文部科学省、令和8年5月1日現在調査、2026年7月30日公表）
- 政府は第1次国土強靱化実施中期計画で、避難所となる体育館等の空調設置率を2035年度までに100%とする目標を掲げている

「授業を受ける教室にはエアコンがあるが、被災者が寝泊まりする同じ学校の体育館にはない」。この非対称性がコアメッセージ。

### 0.3 法的・倫理的な制約（必ず守る）

- 特定の避難所を「危険」と断定表示しない。表示するのは観測された事実と、その事実が示す不足。文言は「未確認」「要確認」を使う。
- 平常時の啓発ツールであり、災害時の避難誘導には使わせない。全ページ最上部に公式情報への誘導バナーを出す（§6.6）。
- 自治体名指しのランキングは作らない。集計は都道府県単位まで。
- 市民投稿には施設管理者からの訂正・削除要請フローを用意する（§4.5）。

---

## 1. プロダクト定義

| 項目 | 内容 |
|---|---|
| 仮称 | HinanBase（リポジトリ名。正式名称は別途） |
| 形態 | 公開Webアプリケーション（PC / スマートフォン） |
| 主要ユーザー | 一般市民 / 報道・研究者 / 自治体・議員 |
| コア機能 | 全国の避難所の地図表示 / 設備情報の集約 / 4軸のスコア表示 / 市民による情報投稿と相互検証 |
| コスト制約 | **固定費ゼロ（ドメイン代を除く）。有料サービス・有料プランを追加する変更は必ず事前に確認を取る** |

### スコープ外

- 現在の開設状況のリアルタイム表示
- D1 に載っていない福祉避難所の個別公開（自治体が非公開としている場合が多い）。D1 に含まれる受入対象者を限定した避難所は掲載する（§10-2）
- ネイティブアプリ
- 多言語対応（ただし文言は i18n 可能な構造で持つ）

---

## 2. データ設計

### 2.1 最重要の前提：「指定緊急避難場所」と「指定避難所」は別物

災害対策基本法 第49条の4 / 第49条の7 に基づく別々の指定。

| | 指定緊急避難場所 | 指定避難所 |
|---|---|---|
| 目的 | 命を守るために緊急に逃げ込む場所 | 被災者が一定期間生活する施設 |
| 例 | 高台、公園、津波避難タワー、学校の校庭 | 体育館、公民館 |
| 指定単位 | 災害種別ごと（洪水 / 崖崩れ・土石流・地滑り / 高潮 / 地震 / 津波 / 大規模な火事 / 内水氾濫 / 火山現象 の8種） | 種別区分なし |
| 本サービスでの扱い | ハザード適合性（軸A）の評価対象 | 設備・収容力（軸B/C/D）の主対象 |

同一の物理施設が両方に指定されていることが多い。データ上は **施設（facility）1件に、指定（designation）を種別ごとの配列で持つ**。同じ施設に同じ種別の行が複数ある（建物と校庭、一般の避難所と受入対象者を限定した避難所など）ため、行は畳まない（`docs/DATA_NOTES.md` D-12）。

### 2.2 データソース

| # | ソース | 内容 | 使用フェーズ | 注意 |
|---|---|---|---|---|
| D1 | 国土地理院「指定緊急避難場所・指定避難所データ」 `hinanmap.gsi.go.jp` | 全国CSV 2本 | Phase 1 | 利用上の注意への同意が必要。手動ダウンロードして `data/raw/` に置く。「最新でない場合や未掲載の場合がある」旨を利用者に正確に伝える義務がある |
| D3 | 各自治体オープンデータ（`{市区町村コード}_evacuation_space.csv` 形式） | 想定収容人数、標高ほか | Phase 4 | 収容人数は D1 に含まれない。ライセンスは自治体ごとに確認 |
| D4 | 国土数値情報 | 行政区域、緊急輸送道路、浸水想定区域ほか | Phase 4 | 版ごとに使用許諾条件を確認 |
| D5 | ハザードマップポータルのタイル | 洪水浸水深、土砂、津波、高潮 | Phase 4 | ビルド時に地点の値を取得 |
| D6 | 国勢調査 地域メッシュ統計（500mメッシュ人口） | 周辺人口 | Phase 4 | |
| D7 | 文部科学省 空調設備設置状況調査 | 都道府県別の体育館空調設置率 | Phase 5 | PDF からの手動転記 |

D1 の既知の列（Step 0 で実物を確認して確定させること）：

- 指定緊急避難場所：NO, 共通ID, 都道府県名及び市町村名, 施設・場所名, 住所, 洪水, 崖崩れ、土石流及び地滑り, 高潮, 地震, 津波, 大規模な火事, 内水氾濫, 火山現象, 指定避難所との住所同一, 緯度, 経度, 備考
- 指定避難所：NO, 共通ID, 都道府県名及び市町村名, 施設・場所名, 住所, 指定緊急避難場所との住所同一, その他市町村長が必要と認める事項, 受入対象者, 緯度, 経度, 備考

### 2.3 データの置き場所（v0.2 の中心）

| データ | 置き場所 | 更新 |
|---|---|---|
| 施設・指定・スコア・確定済み設備値（読み取り専用） | **R2 上の静的ファイル** | ビルドスクリプトが生成 |
| 設備項目マスタ | **リポジトリ内 `config/amenity-defs.json`**（唯一の正） | 手動 |
| 認証、市民投稿、異議申し立て、確定設備値の原本 | **Supabase**（Phase 2 から） | 実行時 |
| 投稿写真 | **R2**（Supabase Storage は使わない） | 実行時 |

フロントエンドは地図・詳細表示のために Supabase を読まない。Supabase が停止していても閲覧は成立すること。

### 2.4 静的ファイルの構成（R2）

```
/tiles/shelters.pmtiles                 全施設の点データ
/facilities/by-muni/{muni_key}.json     市区町村ごとの施設詳細
/summary/national.json                  全国集計
/summary/munis.json                     都道府県→市区町村の索引（リスト表示用。地図の初期表示では読まない）
/summary/pref/{pref_code}.json          都道府県集計（Phase 5）
/meta.json                              生成日時、D1 の取得日、件数、スキーマバージョン
```

**タイルの属性（最小限に保つ）**

| 属性 | 型 | 内容 |
|---|---|---|
| `id` | string | facility_id |
| `name` | string | 施設名 |
| `muni` | string | muni_key |
| `kind` | int | ビットフラグ。1=指定緊急避難場所、2=指定避難所 |
| `hz` | int | 災害種別8種のビットマスク（指定緊急避難場所のみ） |
| `state` | string | display_state（§3.6） |
| `ac` | string | `aircon_main_hall` の確定値。未確認なら属性自体を持たない（Phase 3 で追加） |
| `rs` | int | 避難所の指定がすべて受入対象者限定なら 1、それ以外は 0 |
| `ne` / `ns` | int | 指定緊急避難場所／指定避難所の指定があれば 1。まとめ表示では合算値 |
| `h0`〜`h7` | int | 災害種別ごとの指定があれば 1（順序は `hz` のビットと同じ）。まとめ表示では合算値 |

`ne` / `ns` / `h0`〜`h7` は、低ズームのまとめ表示で絞り込み中の件数を出すためのもの。「指定避難所 × 災害種別」の組み合わせだけは合算値から正確な件数を求められないため、まとめ表示には件数を出さず、印だけを表示して拡大を促す（個別の点は正確に絞り込む）。

タイルの要件：低ズームではクラスタ表示（件数付き）、z12 以上で全点を個別表示。tippecanoe で生成する。フラグの具体値は実装時に決めてよいが、点の間引きで施設が消えないこと。

**市区町村JSONの形**

```json
{
  "muni_key": "…",
  "pref_code": "…",
  "pref_name": "…",
  "muni_name": "…",
  "generated_at": "ISO8601",
  "facilities": [
    {
      "id": "…",
      "name": "…",
      "address": "…",
      "lat": 0, "lng": 0,
      "merge_rules": ["R1"],
      "designations": {
        "emergency_site": [
          { "source_id": "…", "name": "…", "hazards": { "flood": true, "landslide": false, "storm_surge": false, "earthquake": true, "tsunami": false, "fire": false, "inland_flood": false, "volcano": false }, "note": "…", "lat": 0, "lng": 0 }
        ],
        "shelter": [
          { "source_id": "…", "name": "…", "restricted": false, "target": null, "other": null, "note": "…", "lat": 0, "lng": 0 }
        ]
      },
      "amenities": {
        "aircon_main_hall": { "value": "none", "confidence": "verified", "observed_at": "2026-08-01", "evidence_count": 2 }
      },
      "scores": {
        "hazard": null, "capacity": null, "habitability": null, "logistics": null,
        "coverage_ratio": 0, "display_state": "unknown", "breakdown": {}
      }
    }
  ]
}
```

指定がない側は空配列。値がないものは `null` のまま出力する。`restricted` は受入対象者を限定した避難所かどうか（`docs/DATA_NOTES.md` D-11）。`merge_rules` は施設を作るときに適用した統合規則、各指定の `lat` / `lng` は元データの座標（施設の `lat` / `lng` は代表の行の値。`docs/DATA_NOTES.md` D-5）。

### 2.5 ID体系・重複統合（Step 0 の結果で確定）

次の3点は実データを見るまで決めない。Step 0（§9）で調査し、`docs/DATA_NOTES.md` に決定内容を記録する。

- `facility_id`：再取り込みしても変わらない安定IDであること（市民投稿が紐づくため）
- `muni_key`：市区町村を一意に表すキー。全国地方公共団体コードを導出できるならそれを使う
- 2つのCSVに現れる同一施設の統合規則。**曖昧なものは統合せず、`data/build/merge_candidates.json` に出力して人手判断に回す**

### 2.6 設備項目マスタ（`config/amenity-defs.json` の初期内容）

各項目は `key, label_ja, category, value_type, enum_options, weight, help_text` を持つ。

| key | label_ja | category | type | 選択肢・備考 |
|---|---|---|---|---|
| `aircon_main_hall` | 主要滞在スペースの冷房 | climate | enum | none / spot_only / partial / full |
| `heating_main_hall` | 主要滞在スペースの暖房 | climate | enum | 同上 |
| `insulation` | 断熱改修 | climate | boolean | |
| `toilet_total` | トイレ総数 | sanitation | integer | |
| `toilet_western_ratio` | 洋式化率（%） | sanitation | integer | |
| `toilet_multipurpose` | 多目的トイレ | sanitation | boolean | |
| `shower` | 入浴・シャワー設備 | sanitation | enum | none / shower / bath |
| `water_supply` | 給水設備・受水槽 | sanitation | boolean | |
| `power_backup` | 非常用発電機 | power | enum | none / lighting_only / full |
| `power_duration_h` | 自立運転可能時間 | power | integer | |
| `solar_battery` | 太陽光＋蓄電池 | power | boolean | |
| `elevator` | エレベーター | accessibility | boolean | |
| `step_free_entry` | 段差のない入口 | accessibility | boolean | |
| `wifi` | 災害時開放Wi-Fi | comms | boolean | |
| `stockpile_onsite` | 敷地内備蓄倉庫 | supplies | boolean | |
| `stockpile_days` | 備蓄想定日数 | supplies | integer | |
| `partition_kit` | パーティション・簡易ベッド | supplies | enum | none / partial / sufficient |
| `kitchen` | 炊き出し可能な調理設備 | supplies | boolean | |
| `pet_accepted` | ペット同行受入 | pets | enum | no / outdoor_only / same_room |
| `capacity_persons` | 想定収容人数 | capacity | integer | |
| `capacity_area_sqm` | 滞在スペースの有効面積（㎡） | capacity | integer | |

`weight` の初期値はすべて 1。項目の追加は JSON の編集だけで完結させ、画面側に設備名を直接書かない。

### 2.7 Supabase スキーマ（Phase 2）

施設本体は Supabase に持たない。参照整合性のために最小限の索引テーブルだけ同期する。

```sql
-- ビルドスクリプトが同期する施設索引（投稿先の存在確認用）
create table facility_index (
  facility_id text primary key,
  muni_key    text not null,
  name        text not null,
  deprecated_at timestamptz
);

-- config/amenity-defs.json から同期
create table amenity_defs (
  key text primary key,
  value_type text not null,
  enum_options jsonb
);

-- 確定値（原本）
create table facility_amenities (
  facility_id text references facility_index(facility_id),
  amenity_key text references amenity_defs(key),
  value jsonb not null,
  confidence text not null check (confidence in ('official','verified','reported','disputed')),
  evidence_count int not null default 0,
  observed_at date,
  last_report_id uuid,
  updated_at timestamptz default now(),
  primary key (facility_id, amenity_key)
);

-- 市民投稿（不変ログ）
create table reports (
  id uuid primary key default gen_random_uuid(),
  facility_id text not null references facility_index(facility_id),
  amenity_key text not null references amenity_defs(key),
  value jsonb not null,
  basis text not null check (basis in ('official_doc','on_site','photo','hearsay')),
  source_url text,
  photo_urls text[],
  observed_at date not null,
  note text,
  reporter_id uuid not null references auth.users(id),
  status text not null default 'pending'
    check (status in ('pending','accepted','rejected','superseded')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz default now()
);
create index on reports (facility_id, amenity_key, status);

-- 異議申し立て
create table disputes (
  id uuid primary key default gen_random_uuid(),
  facility_id text not null references facility_index(facility_id),
  amenity_key text not null references amenity_defs(key),
  reason text not null,
  counter_value jsonb,
  evidence_url text,
  raiser_id uuid not null references auth.users(id),
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution_note text,
  created_at timestamptz default now()
);
```

---

## 3. リスク評価ロジック（4軸）

スコアは DB ではなく**ビルドスクリプト（TypeScript）で算出**し、静的ファイルに書き出す。

### 3.1 基本原則

- 各軸は 0〜100。算出に必要な入力が欠けている軸は `null`（未評価）。0 や平均値で埋めない。
- 総合点（単一の数値）は作らない。表示は常に4軸。
- `breakdown` に中間値と `method_version` をすべて保存し、詳細ページで開示する。

### 3.2 軸A：ハザード適合性（Phase 4）

指定されている災害種別について、その地点の想定ハザード（D5）と矛盾がないかを見る。

```
mismatch = 「その災害種別の指定緊急避難場所」かつ「その災害の想定区域内」
score_hazard = 100 − (mismatch数 ÷ 指定種別数 × 100)
```

mismatch は指定の誤りを意味しない（垂直避難が前提の場合など）。画面上は「要確認」と表示する。

### 3.3 軸B：収容余力（Phase 4）

```
1人あたり面積 = capacity_area_sqm ÷ 想定避難者数
参照線：2.0㎡（国内の従来想定）／ 3.5㎡（スフィア基準）
score_capacity = min(100, 1人あたり面積 ÷ 3.5 × 100)
capacity_persons しかない場合は充足率で代替し、breakdown に method='headcount' を記録
```

想定避難者数の算出方法は未決（§10）。決まるまで軸Bは `null`。
トイレは `toilet_total` に対しスフィア基準（20人に1基）を参照線として併記する。

### 3.4 軸C：生活環境（Phase 3）

```
score_habitability = Σ(項目の得点 × weight) ÷ Σ(全項目の weight) × 100
coverage_ratio     = Σ(回答済み項目の weight) ÷ Σ(全項目の weight)
```

未回答項目を分母から除外しない。`confidence='disputed'` の項目は未回答として扱う。

### 3.5 軸D：到達性・兵站（Phase 4）

v1 は単純指標で開始する：緊急輸送道路までの直線距離（500m未満=100 / 2km未満=70 / 5km未満=40 / それ以上=10）、敷地内備蓄の有無で±20。

### 3.6 表示状態

| display_state | 色 | 条件 |
|---|---|---|
| `unknown` | グレー（無視されない濃さ） | coverage_ratio < 0.4 |
| `critical` | 赤 | 軸Aに mismatch あり、または評価済みの軸のいずれかが 25 未満 |
| `poor` | オレンジ | 評価済みの軸のいずれかが 50 未満 |
| `fair` | 黄 | 評価済みの軸がすべて 50 以上 |
| `good` | 緑 | 4軸すべて評価済みで 75 以上 |

Phase 1 では全施設が `unknown` になる。それが正しい初期状態。
色だけに頼らず、マーカー内の記号を併用する。凡例は常時表示。

---

## 4. 市民投稿と検証（Phase 2）

### 4.1 信頼度

| confidence | 条件 |
|---|---|
| `official` | 自治体公開データ、または施設管理者アカウントの投稿 |
| `verified` | 異なる2名以上が、根拠 `on_site` または `photo` で同じ値を投稿し、観測日が180日以内 |
| `reported` | 投稿1件のみ、またはモデレーター承認 |
| `disputed` | 未解決の異議がある。スコア計算から除外し、詳細ページに注記 |

### 4.2 投稿フロー

1. 閲覧は匿名可。投稿はログイン必須（Supabase Auth）。**開始時は Google ログインのみ**（2026-11-14 決定）。メールのマジックリンクは、メール送信サービスを用意してから追加する（Supabase 標準のメール送信は本番利用に向かないため）。
2. 根拠（basis）と観測日（observed_at）は必須。`official_doc` は URL 必須、`photo` は写真1枚以上必須。
3. 投稿は `pending` で保存。
4. 自動処理（Supabase の Postgres 関数。投稿時に実行）：
   - 確定値と一致 → `accepted`、evidence_count を加算
   - 確定値と矛盾 → `pending` のままモデレーション待ち
   - それ以外 → すべてモデレーション待ち
   - **開始時は「確定値と一致」だけを自動承認とする**（2026-11-14 決定、§10-4）。当初案の「確定値なし、かつ根拠が `official_doc` / `photo` → 自動で `accepted`（confidence=`reported`）」は、投稿の質が分かってから有効にするかを判断する。有効・無効を設定で切り替えられる形で実装する。
5. モデレーターが承認・却下。却下理由は記録され、履歴として公開される。

### 4.3 反映の経路

- 詳細ページは、静的JSONの確定値に加えて、Supabase から当該施設の最新の `facility_amenities` を取得して上書き表示する（取得に失敗しても静的値で表示を続ける）。
- 地図タイルとスコアへの反映は次回ビルド時（日次）。詳細ページに「地図への反映は最大1日かかります」と明記する。

### 4.4 誤情報の訂正

- すべての設備値の横に「この情報は違う」を常設。
- 押すと `disputes` が作られ、その項目は即座に `disputed` になる。濫用防止のため1ユーザーあたり24時間で3件まで。
- 争点は自由記述の議論にせず、「対立する2つの値と、それぞれの根拠」として並べて表示する。
- `reports` は物理削除しない。施設ごとの編集履歴を誰でも閲覧できる。

### 4.5 荒らし対策・施設管理者

- 新規アカウントは登録後24時間、投稿3件まで。
- 却下率が50%を超えたアカウントに要注意フラグ。
- 写真はアップロード時にサーバー側（Supabase Edge Function）で EXIF を除去・リサイズしてから R2 に保存する。除去前のファイルは公開しない。
- 施設管理者アカウント：申請制（`lg.jp` ドメイン等の確認＋手動承認）。投稿は `official` として即時反映。訂正はできるが履歴は消せない。
- 削除要請フォームを別途用意し、運営が判断する。

---

## 5. 技術アーキテクチャ

### 5.1 構成

```
[ビルド] data/raw/*.csv ──scripts──▶ data/build/ ──upload──▶ Cloudflare R2
                                         ▲
                                         └─ Supabase の確定設備値を読み込む（Phase 3〜）

[閲覧]   ブラウザ ──▶ Cloudflare Pages（React の静的ビルド）
                  ──▶ R2（PMTiles / JSON）
                  ──▶ 地理院タイル（背景地図）

[投稿]   ブラウザ ──▶ Supabase（認証・投稿・異議）  ※Phase 2〜
```

### 5.2 スタック

| レイヤ | 採用 |
|---|---|
| フロント | React 19 + Vite + TypeScript |
| ルーティング | TanStack Router |
| データ取得 | TanStack Query |
| スタイル | Tailwind CSS v4 |
| 地図 | MapLibre GL JS + `pmtiles` プロトコル。背景は地理院タイル（淡色地図） |
| タイル生成 | tippecanoe（PMTiles を直接出力） |
| ホスティング | Cloudflare Pages |
| 静的データ・写真 | Cloudflare R2 |
| 認証・投稿 | Supabase Free（Phase 2〜） |
| バッチ | TypeScript スクリプト。Phase 1 はローカル実行、のちに GitHub Actions |

### 5.3 地図プロバイダ

- 地図描画は `src/lib/map/` の `MapAdapter` インターフェース経由で行う。実装は `MapLibreAdapter` のみ用意する。
- Google Maps Platform の API は使わない（従量課金のため）。経路案内は API キー不要の外部リンクで開く：
  `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}`
- 住所検索は Phase 1 では実装しない（現在地ボタンと地図操作のみ）。

### 5.4 環境変数

| 変数 | 用途 |
|---|---|
| `VITE_DATA_BASE_URL` | 静的データの配信元（R2 の公開URL、またはローカル） |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Phase 2〜 |
| `CLOUDFLARE_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | アップロード用（スクリプトのみ） |
| `SUPABASE_SERVICE_ROLE_KEY` | ビルド時の読み取り・索引同期（スクリプトのみ。フロントに絶対に含めない） |

`.env.example` を用意し、実値はコミットしない。

### 5.5 ローカル開発の要件

- `data/build/` の成果物をローカルで配信して動作確認できること。PMTiles は HTTP Range リクエストを使うため、Range に対応した配信方法にする。
- R2 と Supabase に接続しなくても Phase 1 の全機能が動くこと。

### 5.6 スクリプト（すべて冪等に）

| スクリプト | 内容 | フェーズ |
|---|---|---|
| `inspect-gsi` | D1 の構造調査。結果を `docs/DATA_NOTES.md` に出力 | Step 0 |
| `build-facilities` | D1 を正規化・統合し、中間データ（GeoJSON）と市区町村JSONを生成 | 1 |
| `build-tiles` | tippecanoe で PMTiles を生成 | 1 |
| `build-summaries` | 全国集計・`meta.json` を生成 | 1 |
| `upload-r2` | `data/build/` を R2 に同期 | 1 |
| `sync-supabase` | `facility_index` と `amenity_defs` を Supabase に同期 | 2 |
| `compute-scores` | 確定設備値を読み込み4軸を算出（`build-facilities` に組み込む） | 3〜 |

再取り込み時の要件：公的データから消えた施設は削除せず `deprecated_at` を付ける。市民投稿は施設の再取り込みで失われない（`facility_id` が安定であることが前提）。

---

## 6. 画面仕様

### 6.1 `/` 地図（Phase 1）

- 全画面地図。フィルタパネル（PCは左、モバイルは下部シート）。
- フィルタ：指定種別、災害種別、表示状態。Phase 3 で設備フィルタを追加し、**「冷房なしだけを表示」をワンタップで実行できる**ようにする。
- 現在地ボタン。
- ヘッダーに全国サマリー（掲載件数、設備情報が1項目以上ある施設の件数と割合）。割合の低さを隠さない。
- マーカーを選ぶと要約カード（施設名、指定種別、表示状態）を出し、詳細ページへ遷移できる。
- 受入対象者を限定した避難所（避難所の指定がすべて限定の施設）は、地図では白抜きの印、要約カードとリストでは「受入対象者限定」のラベルで区別する。詳細ページでは枠付きで「受入対象者が限定されています」と `受入対象者` の原文を出す。絞り込みの項目には加えない。
- 「指定避難所 × 災害種別」で絞り込んでいる間は、まとめ表示に件数を出さない旨を案内する（§2.4）。

### 6.2 `/f/{muni_key}/{facility_id}` 施設詳細（Phase 1）

- 施設名、住所、小さな地図、経路を開く外部リンク
- 指定種別と対応災害種別のバッジ
- 4軸のスコア（水平バー4本。未評価は「未評価」と表示し、バーを空にしない＝0点に見せない）
- 設備チェックリスト（カテゴリ別。未確認の項目も「未確認」として全項目を並べる）
- スコア根拠の開示（折りたたみ）
- 出典、データ取得日、「最新かつ詳細の状況は当該市町村にご確認ください」の注記
- Phase 2 で「情報を追加」「この情報は違う」「編集履歴」を追加

### 6.3 `/list` リスト表示（Phase 1）

地図に依存しない一覧。都道府県→市区町村→施設の順にたどれる。スクリーンリーダーと低スペック端末のための代替経路。

### 6.4 投稿・モデレーション（Phase 2）

- `/f/{muni_key}/{facility_id}/report`：1画面1項目のステップ形式。現地で目視確認しやすい項目から並べる。
- `/moderation`：投稿の承認待ち、異議、施設管理者申請（要権限）。

### 6.5 `/pref/{code}` 都道府県サマリー、`/about`、`/data`（Phase 5）

- 件数、表示状態の構成比、設備別の充足率。D7 の体育館空調設置率を並置。
- `/data`：集計データのダウンロード（CC BY 4.0）。
- `/about`：趣旨、評価方法、出典、運営者、問い合わせ・削除要請。

### 6.6 全ページ共通

- 最上部の固定バナー：「このサイトは平常時の課題の可視化を目的としています。災害時は必ずお住まいの自治体の公式情報に従ってください。」
- フッターに出典（国土地理院ほか）とライセンス。地図上に地理院タイルの出典表示。

### 6.7 デザイン方針

- データジャーナリズム寄りの落ち着いたトーン。防災アプリ的な赤・黄の多用は避ける。
- 「グレーが地図を埋めている」ことが最初の印象になるようにする。
- UI の文言はすべて日本語。文言は1か所（辞書ファイル）にまとめる。

---

## 7. Supabase の権限設計（Phase 2）

| テーブル | SELECT | INSERT | UPDATE |
|---|---|---|---|
| `facility_index`, `amenity_defs` | 全員 | service_role | service_role |
| `facility_amenities` | 全員 | 関数経由のみ | 関数経由のみ |
| `reports` | 全員（`reporter_id` は公開ビューで匿名化） | ログインユーザー（`submit_report` 関数経由） | moderator |
| `disputes` | 全員（同上） | ログインユーザー（`raise_dispute` 関数経由） | moderator |

- ロールは `app_metadata.role` に `user / facility_admin / moderator / admin`。
- レート制限と入力検証は関数内で行う。
- Free プランの自動停止対策として、GitHub Actions から3日おきに軽い読み取りを実行する。

---

## 8. 非機能要件

- **コスト**：Cloudflare Pages / R2 / Supabase / GitHub Actions の無料枠内で動くこと。
- **パフォーマンス**：モバイル回線で地図の初期表示（LCP）2.5秒以内。初期ロードで全施設データを取得しない。
- **アクセシビリティ**：WCAG 2.2 AA。キーボード操作、色に依存しない状態表示、リスト表示。
- **出典表示**：国土地理院コンテンツ利用規約に従う。
- **公開データのライセンス**：本サービスが生成する集計データは CC BY 4.0。
- **リポジトリ**：公開。秘密情報をコミットしない。

---

## 9. 実装フェーズ

### Step 0：データ調査（コードを書く前に必ず実施）

`data/raw/` の D1 CSV 2本を調べ、`docs/DATA_NOTES.md` に次を記録して**作業を止め、承認を待つ**。

1. 各ファイルの文字コード、改行、列名、行数
2. 共通IDの形式と一意性。2ファイル間で共通IDが一致する施設の有無と件数
3. 市区町村コードを導出できるか（共通IDや名称から）
4. 緯度経度の欠損、日本の範囲外の値の件数
5. 災害種別フラグの値の表現
6. 提案：`facility_id` の体系、`muni_key`、同一施設の統合規則、統合が曖昧になる件数の見込み

### Phase 1：地図に全国の避難所が出る

- プロジェクトの雛形、Lint、型チェック、テスト基盤
- `build-facilities` / `build-tiles` / `build-summaries` / `upload-r2`
- 地図（`/`）、施設詳細、リスト表示、共通バナー、出典表示
- Cloudflare Pages へのデプロイ設定
- 完了条件：公開URLで全国の施設がグレーの点で表示され、任意の施設の詳細を開ける。全国件数が D1 の行数と整合する（統合・除外の内訳を説明できる）。

### Phase 2：投稿が一周する

Supabase のスキーマと権限、認証、投稿フォーム、自動処理、モデレーション画面、異議申し立て、写真アップロード（EXIF除去→R2）、`sync-supabase`。
完了条件：投稿→承認→詳細ページに反映、までを通しで確認できる。

### Phase 3：設備が地図に出る

ビルドへの確定設備値の取り込み、軸C、表示状態の色分け、設備フィルタ（「冷房なし」）、日次ビルドの GitHub Actions 化。

### Phase 4：軸A・B・D

D3 / D4 / D5 / D6 の取り込みと各軸の算出。

### Phase 5：公開準備

都道府県サマリー、データダウンロード、`/about`、OGP画像、独自ドメイン。

---

## 10. 未決事項（該当箇所に着手する前に確認を取ること）

1. 想定避難者数の算出方法（軸Bの分母）
2. ~~福祉避難所を扱うか~~ → 決定済み（2026-11-12）。D1 に含まれる受入対象者を限定した避難所は掲載し、区別して表示する（`docs/DATA_NOTES.md` D-11）。D1 に載っていない福祉避難所は引き続きスコープ外
3. D1 の自動取得が可能か（同意画面があるため、当面は手動更新）
4. ~~モデレーション体制と自動承認の閾値~~ → 決定済み（2026-11-14）。モデレーターは当面、運営者 1 人（権限の仕組みは複数人に対応させる）。自動承認は「確定値と一致」のみ（§4.2）
5. 正式名称とドメイン

---

## 付録：出典

- 国土地理院「指定緊急避難場所・指定避難所データ」 https://hinanmap.gsi.go.jp/
- 国土数値情報ダウンロードサイト https://nlftp.mlit.go.jp/ksj/
- 文部科学省「公立学校施設の空調（冷房）設備設置状況」 https://www.mext.go.jp/a_menu/shotou/zyosei/mext_01278.html
