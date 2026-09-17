# Reddit Data API access request (file via the support form, category: developer)

**Use case.** A single-user tool for one Reddit account (mine) that (1) reads public posts in a fixed
list of about six subreddits where people ask how to avoid P2P trading scams, and (2) lets me — a
human — post a reply I wrote or approved, from my own account, at most a few times per day. Nothing
is automated end to end: the tool emails me a suggested reply, and I decide whether to post it.

**What it does today, without access.** It reads public Atom/RSS feeds only, unauthenticated, with a
descriptive User-Agent and a contact address, one request at a time, well under 100 QPM. It does not
write to Reddit at all. That is its default and current configuration.

**What access would change.** Only the last step: posting the reply I have already approved, through
a script-type OAuth client on my own account with `read` and `submit` scopes, instead of my pasting
it into a browser. The rate limits I apply to myself — at most four replies a day, at least 25
minutes apart — are enforced in code and are unaffected by the change.

**What it is not.** No multiple accounts, no scraping beyond the feeds and, with access, the OAuth
client. No model training on Reddit data. No resale, redistribution or sharing. No combination with
any other data source. Stored post text is deleted within 48 hours unless I replied to it.

**Technical.** One script-type OAuth client (password grant, my own account only), `read` + `submit`
scopes, User-Agent `zeus-reddit-monitor/0.1 (by /u/<me>; contact: hello@zeus.as)`, rate-limit headers
honoured, `Retry-After` respected.

**Source.** https://github.com/onlyintelligence/zeus-reddit-monitor — the whole tool, open for
inspection. The safeguards above are in `src/publish/publisher.ts`, `src/compliance/` and
`src/publish/purge.ts`.

**Affiliation disclosed.** I'm the founder of Zeus (zeus.as), a non-custodial settlement bot in
sandbox, operated by Onlyintelligence Ltd. Replies that mention it carry a disclosure line,
appended automatically. Most replies will not mention it at all.

If this is considered commercial, please route accordingly — I'd rather be told than guess.
