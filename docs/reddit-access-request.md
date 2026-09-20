# Reddit Data API access request — draft (file via the support form, category: developer)

**Use case.** A single-user tool for one Reddit account (mine) that (1) reads public posts in a fixed list of ~6 subreddits
where people ask how to avoid P2P trading scams, and (2) lets me — a human — post a reply I wrote or approved, from my own
account, at most a few times per day. Nothing is automated end-to-end: the tool emails me a suggested reply and I post
it by hand. In the mode it ships in it makes no write calls to Reddit at all.

**What it is not.** No multiple accounts, no scraping beyond the OAuth client, no model training on Reddit data, no resale
or redistribution. Content is purged from my database within 48 hours unless I replied to it.

**Technical.** One script-type OAuth client (password grant, my own account only), `read` + `submit` scopes,
User-Agent `zeus-reddit-monitor/0.1 (by /u/<me>; contact: <email>)`, <100 QPM, rate-limit headers honoured. Source: https://github.com/onlyintelligence/zeus-reddit-monitor

**Affiliation disclosed.** I'm the founder of Zeus (zeus.as), a non-custodial settlement bot in sandbox. Replies that
mention it carry a disclosure line automatically. Most replies will not mention it at all.

If this is considered commercial, please route accordingly — I'd rather be told than guess.
