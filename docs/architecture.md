# Architecture

One process, five stages, one output: an email. Nothing here writes to Reddit.

```
  public RSS  ──▶  items  ──▶  relevance filter  ──▶  drafts  ──▶  email  ──▶  a human posts
   (listen)                        (triage)                       (digest)     (by hand)
                                                                      │
                                                  items.body cleared after 48h (purge)
```

## The stages

| job | reads | writes | file |
|---|---|---|---|
| `listen` | public Reddit Atom feeds, unauthenticated | `items` | `src/listeners/reddit.ts` |
| `triage` | `items` with status `new` | `items.status`, `drafts` | `src/triage/triage.ts`, `draft.ts` |
| `digest` | `drafts` not yet emailed | `drafts.emailed_at`, sends one email | `src/digest/digest.ts` |
| `purge` | `items` older than `PURGE_AFTER_HOURS` | clears `items.body` and `raw` | `src/publish/purge.ts` |

`listen` runs every 30 minutes, `triage` five minutes later, `digest` every
`DIGEST_EVERY_HOURS`, `purge` nightly. See `src/main.ts`.

## What it reads, precisely

Two feed shapes per subreddit, both public and unauthenticated:

```
https://www.reddit.com/r/<sub>/new.rss?limit=50
https://www.reddit.com/r/<sub>/search.rss?q=<term>&restrict_sr=1&sort=new&t=week
```

Six terms (`middleman`, `mm`, `is this legit`, `scammed`, `vouch`) plus the new
feed — six requests per subreddit per cycle, paced at roughly one request every
two seconds, with `Retry-After` honoured on 429 (`src/http.ts`). With the
default six subreddits that is 36 requests every 30 minutes: far below any
published limit.

No API key, no OAuth, no login. The Data API is not used for reading.

## Where each safeguard lives

| safeguard | file | what it does |
|---|---|---|
| claim linter | `src/compliance/bannedPhrases.ts` | six built-in rules; a hit is a hard failure the approval step cannot override |
| disclosure | `src/compliance/disclosure.ts` | appends `DISCLOSURE_LINE` to any reply mentioning the product; idempotent |
| daily cap | `src/publish/gate.ts` | `REDDIT_MAX_REPLIES_PER_DAY`, counted in the database, not in memory |
| minimum gap | `src/publish/gate.ts` | 25 minutes between replies |
| manual mode | `src/publish/gate.ts` | `REDDIT_POST_MODE=manual` (the default) marks the job `manual_pending` and returns |
| 48-hour purge | `src/publish/purge.ts` | clears stored post text; `PURGE_AFTER_HOURS` defaults to 48 |

## What this program does not do

- **It does not post.** In the default mode the publish loop is not even
  registered (`src/main.ts`), and the gate's manual branch returns before any
  Reddit call. Beyond that, **nothing in this repository creates a `publish_jobs`
  row** — grep for `insert(schema.publishJobs` and you will find nothing — so the
  queue the gate drains is always empty here.
- **It does not vote, follow, message, or edit.** The only Reddit write function
  in the repository is `redditComment` (`src/publish/reddit.ts`), reachable only
  in `api` mode.
- **It does not use more than one account.** There is one set of credentials and
  no rotation.
- **It does not combine Reddit data with any other source**, sell it, share it,
  or use it for model training.

## The database

Six tables: `items`, `drafts`, `publish_jobs`, `cursors`, `counters`,
`audit_log`. The `platform` enum has a single member, `reddit`.

There is no `tokens` table. Manual mode holds no OAuth credential for any
account, so there is nowhere for one to be stored.

Every state change writes to `audit_log` (`src/db/helpers.ts`).
