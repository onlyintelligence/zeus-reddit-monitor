# zeus-reddit-monitor

A single-user tool, for one Reddit account, run by one person. It reads the public RSS feeds of a
short list of subreddits where people ask how to trade peer-to-peer without being scammed, filters
out the large majority that are not real questions, drafts a reply to the few that are, and emails
them to me. I read each one, edit or discard it, and post it myself from my own account, by hand. In
its default configuration the tool has no write path to Reddit at all.

I am the founder of Zeus (zeus.as), a non-custodial bonded settlement bot for P2P trades, currently
in sandbox. Most of the replies it drafts do not mention Zeus. The ones that do carry a disclosure
line, added automatically, that says I build it.

```
  public RSS  ──▶  items  ──▶  relevance filter  ──▶  draft  ──▶  email to me  ──▶  I post it
  (6 subs)         (db)        (discards most)        (linted)     (nothing sent)    (by hand)
```

## What it reads

Public Atom/RSS only — the same URLs any browser or feed reader can fetch:

```
https://www.reddit.com/r/<subreddit>/new.rss?limit=50
https://www.reddit.com/r/<subreddit>/search.rss?q=<keyword>&restrict_sr=1&sort=new&t=week   (off by default)
```

* No authentication, no OAuth, no API key, no login. Nothing behind a permission I have not been granted.
* A real User-Agent naming the account and a contact address, set in `REDDIT_USER_AGENT`.
* One request at a time, with a full minute between feeds (`src/listeners/reddit.ts`).
* Exactly one attempt per feed per pass. A feed that answers 429 is skipped until the next pass
  rather than retried — being told to slow down is answered by stopping, not by trying again.
* Volume: one pass every 30 minutes over the configured subreddits, one request each. With the six
  subreddits currently configured that is 12 requests an hour — about 0.2 per minute, against a
  limit of 100 per minute. Turning on the optional keyword feeds makes a pass 36 requests spread
  over 36 minutes, roughly 1 per minute, still far below.
* Feeds carry title, author, link, timestamp and body text. No scores, no private data, no user
  history, no crawling beyond the feeds listed above.

The subreddits are configuration, not code: `REDDIT_SUBREDDITS` currently reads
`GlobalOffensiveTrade, PHGamers, brdev, investimentos, Discord_Bots, freelance`. That list is
expected to change as I find communities where the question actually comes up.

## What it writes

In the default mode (`REDDIT_POST_MODE=manual`) — **nothing**. No comment, no post, no vote, no
message, no profile change. The tool's output is an email to me. Reddit never sees a request from it
other than the feed reads above.

The `api` mode in `src/publish/reddit.ts` is the path I would use if Data API access were approved:
a script-type OAuth client on my own account, `submit read identity`, posting the same reply the
same gate has already cleared. It is inert without approved access and credentials, and it is not
what the default configuration does.

## Safeguards

These live in the publisher, which every drafted reply passes through before it can be sent or even
shown to me. Nothing upstream can skip them, and there is no approval step that overrides them.

| What | Where |
|---|---|
| Claim linter — hard fail on "escrow" as self-description, "guarantee", "trustless", "risk-free", "no middlemen", "can't be scammed" | `src/compliance/bannedPhrases.ts`, applied at `src/publish/publisher.ts` and again at draft time in `src/triage/draft.ts` |
| Founder disclosure appended to any reply that mentions the product | `src/compliance/disclosure.ts` |
| Daily reply cap (`REDDIT_MAX_REPLIES_PER_DAY`, default 4) | `src/db/helpers.ts` (`tryIncrement`, atomic), gated in `src/publish/publisher.ts` |
| Minimum 25 minutes between replies | `src/publish/publisher.ts` |
| Stored post text deleted after 48 hours unless I actually replied to it | `src/publish/purge.ts` |

The email digest lists only replies that have already cleared all of the above, so the cap and the
linter govern what I am shown, not merely some later step.

A reply the linter rejects is never sent and never emailed. A reply beyond the daily cap is deferred,
not silently dropped.

## Data handling

* Nothing is sold, shared, redistributed, or published.
* Nothing is used to train a model.
* No Reddit data is combined with any other data source.
* One account, mine. No second accounts, no alternate personas, no automation of anyone else's account.
* Post text is stored only long enough to draft a reply and is deleted within 48 hours unless I
  replied to it, in which case the record is kept so the reply stays auditable.
* The database is a single Postgres instance on a private host. There is no public interface to it.

## About the drafts

Reply drafts are prepared with an LLM assistant (Claude, via the Agent SDK in `src/triage/`), and
every word is read by a human before anything is posted. Nothing is posted automatically.

## Running it

Needs Node 22+ and a Postgres database.

```bash
pnpm install
cp .env.example .env     # then fill it in — see below
POSTGRES_PASSWORD=dev docker compose up -d
pnpm db:migrate
pnpm start
```

`.env` must be filled in before the first run: the tool exits with a readable list of what is
missing rather than starting half-configured. A minimum working file:

```ini
DATABASE_URL="postgres://zeus:dev@127.0.0.1:5434/zeus_reddit_monitor"
REDDIT_USER_AGENT="zeus-reddit-monitor/0.1 (by /u/YOUR_REDDIT_USERNAME; contact: hello@zeus.as)"
REDDIT_SUBREDDITS="GlobalOffensiveTrade,freelance"
DIGEST_TO="you@example.com"
DIGEST_FROM="you@example.com"
SMTP_USER="you@example.com"
SMTP_PASS="your-smtp-app-password"
DISCLOSURE_LINE="(Disclosure: I'm building Zeus, a non-custodial settlement bot — mentioning it because it's directly relevant.)"
SANDBOX_LABEL="Zeus is currently in sandbox/testnet."
IDENTITY_PAGE_URL="https://zeus.as/verify"
CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
```

Individual jobs, for cron or a systemd timer:

```bash
pnpm job:listen                       # fetch the feeds
pnpm job:triage                       # relevance filter, then draft what survives
pnpm job:digest                       # send the email
pnpm job:purge                        # apply the 48-hour deletion
pnpm job:mark-posted <jobId> [url]    # record that I posted a suggested reply by hand
```

`pnpm job:listen` is the only job that contacts Reddit. `job:triage` calls an LLM; the others touch
only the database and SMTP.

## Two files are not in this repository

Both are gitignored, and each has an `*.example.json` next to it showing the shape:

* `src/triage/posture.local.json` — a note per subreddit about what that community's own rules
  allow. Without it every subreddit falls through to the conservative default in `src/triage/posture.ts`:
  assume promotion is unwelcome, answer the question, mention nothing unless asked.
* `compliance-rules.local.json` — extra linter rules for my deployment, named by
  `COMPLIANCE_RULES_FILE`. They can only add rules to the list above, never remove one. A file that
  is configured but missing or malformed stops the process rather than quietly linting with fewer
  rules than were configured.

## Licence

MIT. See `LICENSE`.
