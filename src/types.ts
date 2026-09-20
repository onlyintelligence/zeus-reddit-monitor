export type Platform = "reddit";

/** A single thing a listener found: a post, a comment, a video, a message. */
export interface ListenedItem {
  platform: Platform;
  /** Stable, Reddit-native id, e.g. t3_xxx. */
  externalId: string;
  url: string;
  /** Where it lives: the subreddit name, without the r/ prefix. */
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

export interface Draft {
  text: string;
  mentionsZeus: boolean;
}
