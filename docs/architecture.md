# Architecture

One process, five jobs, one output: an email. In the default configuration nothing in here
writes to Reddit.

```
  public RSS  ──▶  items  ──▶  relevance filter  ──▶  drafts  ──▶  gate  ──▶  email  ──▶  a human
   (listen)                        (triage)                      (publish)   (digest)     posts it
                                                                     │
                                                          status = manual_pending
                                                                     │
                                          items.body cleared after PURGE_AFTER_HOURS (purge)
```

## The jobs

| job | cron | reads | writes | file |
|---|---|---|---|---|
| `listen` | every 30 min | public Reddit Atom feeds, unauthenticated | `items` | `src/listeners/reddit.ts` |
| `triage` | `:10` and `:40` | `items` with status `new` | `items.status`, `drafts`, `publish_jobs` | `src/triage/triage.ts`, `draft.ts` |
| `publish` | every 10 min | `publish_jobs` with status `queued` | `publish_jobs.status` | `src/publish/publisher.ts` |
| `digest` | every `DIGEST_EVERY_HOURS` | `drafts` not yet emailed | `drafts.emailed_at`, sends one email | `src/digest/digest.ts` |
| `purge` | nightly 03:15 | `items` older than `PURGE_AFTER_HOURS` | clears `items.body` and `raw` | `src/publish/purge.ts` |

Wiring is `src/main.ts:20-52`. Each job takes a Postgres advisory lock (`withLock`), so two
overlapping runs cannot process the same row twice.

## What it reads, precisely

Two feed shapes per subreddit, both public and unauthenticated:

```
https://www.reddit.com/r/<sub>/new.rss?limit=50
https://www.reddit.com/r/<sub>/search.rss?q=<term>&restrict_sr=1&sort=new&t=week
```

No API key, no OAuth, no login. The Data API is not used for reading at all. Requests are paced,
one attempt per feed per pass, and `Retry-After` is honoured on 429 (`src/http.ts`). The
User-Agent is a real descriptive string naming the account and a contact address.

## The publish job runs in manual mode too — and that is the point

`triage` enqueues a `publish_jobs` row for every draft it keeps (`src/triage/draft.ts:51`). The
`publish` job drains that queue every ten minutes **regardless of mode**. What differs is what
happens at the end of the gate.

The gate, in order (`src/publish/publisher.ts`):

1. **Banned-phrase linter** — a hit fails the job outright. Nothing upstream can skip it.
2. **Disclosure** — appended by the program to any reply that mentions the product, not trusted
   to the draft.
3. **Daily cap and minimum gap** — counted in the database, not in memory.
4. **Manual mode (the default)** — the job is set to `manual_pending` and the function returns.
   No Reddit call is made, and `attempts` is never incremented.
5. **`api` mode** — only reachable with approved Reddit Data API access and four credentials that
   ship blank.

So in the default mode the queue fills, drains, and parks. That is deliberate: a parked job is
what `pnpm job:mark-posted <id> [url]` closes after you post the reply by hand, and closing it is
what marks the source item `posted` — which is also what exempts it from the 48-hour purge.

**The two modes are distinguishable by their side effects**, which is how the claim is checked
rather than asserted. Running the same queued job twice, changing only `REDDIT_POST_MODE`:

| mode | final status | `attempts` | network |
|---|---|---|---|
| `manual` | `manual_pending` | 0 | none |
| `api` | `posting`, then the credential error | 1 | reached the token call |

## Where each safeguard lives

| safeguard | file | what it does |
|---|---|---|
| claim linter | `src/compliance/bannedPhrases.ts` | six built-in rules; a hit is a hard failure |
| extra rules | `compliance-rules.example.json` | optional file via `COMPLIANCE_RULES_FILE`; rules are never logged |
| disclosure | `src/compliance/disclosure.ts` | appends `DISCLOSURE_LINE`; idempotent |
| daily cap | `src/publish/publisher.ts` | `REDDIT_MAX_REPLIES_PER_DAY`, counted in `counters` |
| minimum gap | `src/publish/publisher.ts` | a floor between replies, not a target |
| manual mode | `src/publish/publisher.ts` | the default; parks the job for a human |
| 48-hour purge | `src/publish/purge.ts` | clears stored post text |

## Credentials are optional at boot and required at use

`job:listen` reads public RSS and writes nothing, so it runs on a machine with no Anthropic token
and no SMTP account. `job:triage` fails without `CLAUDE_CODE_OAUTH_TOKEN` (`src/triage/claude.ts`)
and `job:digest` fails without the SMTP settings (`requireDigestConfig`, `src/digest/email.ts`),
each naming what is missing. A blank value in `.env` counts as unset, not as an invalid value.

## The database

Five tables: `items`, `drafts`, `publish_jobs`, `counters`, `audit_log`. The `platform` enum has a
single member, `reddit`, and `job_kind` a single member, `reply`.

There is no `tokens` table. Manual mode holds no OAuth credential for any account, so there is
nowhere for one to be stored.

Every state change writes to `audit_log` (`src/db/helpers.ts`).

## What this program does not do

- **It does not post in the default mode.** The gate's manual branch returns before any Reddit
  call, and the only Reddit write function in the repository is `redditComment`
  (`src/publish/reddit.ts`), reachable only in `api` mode.
- **It does not vote, follow, message, or edit.**
- **It does not use more than one account.** One set of credentials, no rotation.
- **It does not combine Reddit data with any other source**, sell it, share it, or use it for
  model training.
