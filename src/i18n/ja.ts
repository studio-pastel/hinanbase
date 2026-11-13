// UI の文言はすべてここに置く（SPEC §6.7）。画面のコンポーネントに日本語を直接書かない。
import type { DisplayState, HazardKey } from '../../shared/types.ts'

export const ja = {
  appName: 'HinanBase',
  tagline: '全国の避難所の「未確認」を可視化する',
  // 全ページ最上部の固定バナー（SPEC §6.6。文言を変えないこと）
  banner:
    'このサイトは平常時の課題の可視化を目的としています。災害時は必ずお住まいの自治体の公式情報に従ってください。',
  skipToMain: '本文へ移動',
  nav: { map: '地図', list: 'リスト', label: 'ページ切り替え' },
  loading: '読み込み中…',
  loadError: 'データを読み込めませんでした。時間をおいて再度お試しください。',
  notFound: 'ページが見つかりません。',
  backToMap: '地図に戻る',
  unitFacilities: '施設',
  unitCount: '件',

  summary: {
    label: '全国の概況',
    facilities: '掲載施設',
    withAmenity: '設備情報が1項目以上ある施設',
    withAmenityNote: '公的データには設備の情報が含まれていません。',
  },

  kind: {
    label: '指定種別',
    all: 'すべて',
    emergency: '指定緊急避難場所',
    shelter: '指定避難所',
    emergencyHelp: '命を守るために緊急に逃げ込む場所。災害の種類ごとに指定されます。',
    shelterHelp: '被災した人が一定期間生活する施設。',
    restricted: '受入対象者が限定されています',
    restrictedShort: '受入対象者限定',
    targetLabel: '受入対象者',
    targetMissing: '対象者の記載はありません',
    otherLabel: 'その他市町村長が必要と認める事項',
    noteLabel: '備考',
    sourceIdLabel: '共通ID',
    none: 'この種別の指定はありません',
  },

  hazard: {
    label: '災害種別',
    all: 'すべて',
    help: '指定緊急避難場所が、どの災害に対して指定されているかを示します。',
    names: {
      flood: '洪水',
      landslide: '崖崩れ・土石流・地滑り',
      storm_surge: '高潮',
      earthquake: '地震',
      tsunami: '津波',
      fire: '大規模な火事',
      inland_flood: '内水氾濫',
      volcano: '火山現象',
    } satisfies Record<HazardKey, string>,
    designated: '指定あり',
    notDesignated: '指定なし',
  },

  state: {
    label: '表示状態',
    legend: '凡例',
    names: {
      unknown: '未確認',
      critical: '要確認（重要）',
      poor: '要確認',
      fair: '一部充足',
      good: '充足',
    } satisfies Record<DisplayState, string>,
    descriptions: {
      unknown: '設備情報がほとんど集まっていない',
      critical: '確認が必要な点がある（指定と想定区域の関係、または評価の低い軸）',
      poor: '評価済みの軸に 50 未満のものがある',
      fair: '評価済みの軸がすべて 50 以上',
      good: '4軸すべて評価済みで 75 以上',
    } satisfies Record<DisplayState, string>,
    restrictedLegend: '白抜きの印：受入対象者が限定された避難所',
    clusterLegend: '数字の印：その付近の施設数（拡大すると個別に表示）',
    phase1Note: '現在はすべての施設が「未確認」です。設備情報がまだ1件も集まっていないためです。',
  },

  map: {
    label: '全国の避難所の地図',
    filters: '絞り込み',
    filtersClose: '絞り込みを閉じる',
    clusterCountUnavailable: 'この組み合わせでは、まとめ表示の件数を出せません。拡大すると個別に表示されます。',
    listAlternative: '地図を使わずに一覧で探す',
    zoomIn: '拡大',
    zoomOut: '縮小',
    locate: '現在地を表示',
    locateUnavailable: '現在地を取得できません',
    attributionBase: '地理院タイル',
    attributionData: '国土地理院「指定緊急避難場所・指定避難所データ」を加工',
    selectedClose: '閉じる',
    openDetail: '施設の詳細を見る',
  },

  facility: {
    address: '住所',
    openRoute: '経路を開く（Google マップ）',
    mapLabel: '施設の位置',
    designations: '指定の内容',
    scores: '4軸の評価',
    scoresNote: '総合点は作りません。評価に必要な情報が欠けている軸は「未評価」と表示します。',
    unrated: '未評価',
    axes: {
      hazard: 'ハザード適合性',
      capacity: '収容余力',
      habitability: '生活環境',
      logistics: '到達性・兵站',
    },
    amenities: '設備',
    amenitiesNote: '未確認の項目もすべて並べています。公的データに含まれない項目は「未確認」です。',
    unknownValue: '未確認',
    yes: 'あり',
    no: 'なし',
    breakdown: '評価の根拠を見る',
    methodVersion: '算出方法の版',
    source: '出典と注意',
    fetchedDate: 'データ取得日',
    sourceText: '国土地理院「指定緊急避難場所・指定避難所データ」を加工して作成',
    cityNote: 'このデータは最新でない場合や、未掲載の施設がある場合があります。最新かつ詳細の状況は当該市町村にご確認ください。',
    kindNote: '指定緊急避難場所と指定避難所は別の指定です。指定緊急避難場所は災害の種類ごとに指定されています。',
    mergeNote: '国土地理院のデータでは別々の行だったものを、同じ施設としてまとめて表示しています。',
    notFound: 'この施設は見つかりませんでした。',
  },

  list: {
    title: '一覧から探す',
    intro: '都道府県、市区町村の順にたどって施設を探せます。地図を使わない代替の経路です。',
    prefs: '都道府県',
    munis: '市区町村',
    facilities: '施設',
    breadcrumb: '現在位置',
    top: '全国',
    muniNote: '政令指定都市は市単位でまとめています。国土地理院のデータに掲載のない市区町村は表示されません。',
  },

  footer: {
    source: '出典：国土地理院「指定緊急避難場所・指定避難所データ」を加工して作成。背景地図：地理院タイル。',
    license: '本サービスが生成する集計データは CC BY 4.0 で提供します。',
    fetched: 'データ取得日',
  },
} as const

export const fmt = new Intl.NumberFormat('ja-JP')
export const pct = (ratio: number) => `${(ratio * 100).toFixed(1)}%`
