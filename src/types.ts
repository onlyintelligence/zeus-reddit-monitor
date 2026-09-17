export type Platform = "reddit";

/** A single thing the listener found: a Reddit post. */
export interface ListenedItem {
  platform: Platform;
  /** Stable, Reddit-native id ("t3_xxx" for a post, "t1_xxx" for a comment). */
  externalId: string;
  url: string;
  /** The subreddit, without the r/ prefix. */
  container: string;
  author?: string;
  title?: string;
  body: string;
  publishedAt: Date;
  raw?: unknown;
}

export interface TriageResult {
  relevance: number;                     // 0–100
  isRealQuestion: boolean;
  intent: "seeking_middleman" | "scam_report" | "verify_someone" | "how_to_trade_safely" | "other";
  language: string;                      // BCP-47
  zeusIsTheAnswer: boolean;
  promotionRisk: "low" | "medium" | "high";
  action: "reply" | "watch" | "skip";
  reason: string;
}
