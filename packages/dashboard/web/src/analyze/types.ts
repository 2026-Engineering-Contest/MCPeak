/** 상세가 있는 축. `#/analyze/<pillar>` 의 두 번째 세그먼트다(App.tsx `parseRoute`). */
export type AnalyzePillar = "tokens" | "security";

/** 화면에 카드가 있는 축. 상세가 없는 축은 여기에만 있다. */
export type AnalyzePillarId = AnalyzePillar | "performance";
