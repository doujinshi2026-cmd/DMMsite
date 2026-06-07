export const PROTECTED_MAKERS = Object.freeze([
  "どじろーブックス",
  "みずのウロ",
  "ひやしまくら",
]);

export const WORK_SELECTION_SOURCE_KEYS = Object.freeze({
  recurringRank: "dmm_api_rank_top_100",
  bootstrapRank: "dmm_api_rank_top_500",
  protectedMaker: "dmm_api_protected_maker",
});

export const WORK_SELECTION_POLICY = Object.freeze({
  provider: "DMM Webサービス API v3 ItemList",
  api_only: true,
  protected_makers: PROTECTED_MAKERS,
  recurring: Object.freeze({
    source_key: WORK_SELECTION_SOURCE_KEYS.recurringRank,
    label: "24時間ごとに更新されるDMM API人気順 コミック上位100作品",
    sort: "rank",
    media: "comic",
    offset: 1,
    limit: 100,
    hits: 100,
    page_limit: 3,
    crons: Object.freeze([
      Object.freeze({
        cron: "10 3 * * *",
        jst: "12:10",
        label: "daily-api-rank-top-100",
      }),
    ]),
  }),
  bootstrap: Object.freeze({
    source_key: WORK_SELECTION_SOURCE_KEYS.bootstrapRank,
    label: "過去作品全体を含むDMM API人気順 コミック上位500作品",
    sort: "rank",
    media: "comic",
    offset: 1,
    limit: 500,
    hits: 100,
    page_limit: 10,
  }),
  protected_maker_import: Object.freeze({
    source_key: WORK_SELECTION_SOURCE_KEYS.protectedMaker,
    sort: "rank",
    media: "comic",
    hits: 100,
    page_limit: 3,
  }),
  unsupported_api_conditions: Object.freeze([
    Object.freeze({
      requested: "同人トップ画面の「注目作品」",
      reason: "ItemList APIにはトップ画面の注目作品を識別する項目や絞り込みパラメータがありません。",
      fallback: "別条件へ誤変換せず、APIで取得可能になるまで未対応として管理します。",
    }),
  ]),
});

export function scheduledWorkSelection(cron) {
  const schedule =
    WORK_SELECTION_POLICY.recurring.crons.find((item) => item.cron === cron) ||
    WORK_SELECTION_POLICY.recurring.crons[0];
  return {
    ...WORK_SELECTION_POLICY.recurring,
    schedule_label: schedule.label,
    schedule_jst: schedule.jst,
  };
}
