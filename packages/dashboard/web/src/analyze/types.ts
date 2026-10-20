/** 상세가 있는 축. `#/analyze/<pillar>` 의 두 번째 세그먼트다(App.tsx `parseRoute`). */
export type AnalyzePillar = "tokens" | "security" | "performance";

/** 화면에 카드가 있는 축. 지금은 셋 다 상세가 있다. */
export type AnalyzePillarId = AnalyzePillar;
