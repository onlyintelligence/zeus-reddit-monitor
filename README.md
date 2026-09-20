# zeus-reddit-monitor

A single-user tool for one Reddit account. It watches six named subreddits for
questions about peer-to-peer trading scams and middlemen, and emails me a
suggested reply. I read it, edit or discard it, and post it myself. In its
default mode the tool never writes to Reddit.

```
public RSS  ──▶  items  ──▶  relevance filter  ──▶  draft  ──▶  email  ──▶  I post it by hand
```

Reddit only. Nothing is cross-posted, syndicated or scheduled.

## What it reads

Public Atom feeds, unauthenticated — no API key, no OAuth, no login:

```
https://www.reddit.com/r/<sub>/new.rss?limit=50
https://www.reddit.com/r/<sub>/search.rss?q=<term>&restrict_sr=1&sort=new&t=week
```

Six requests per subreddit per cycle, paced at about one every two seconds, with
`Retry-After` honoured on 429 (`src/http.ts`). With six subreddits that is 36
requests every 30 minutes — well under 100 QPM. The User-Agent is a real,
descriptive string naming the account and a contact address (`REDDIT_USER_AGENT`).

## What it writes

**Nothing, in the default mode.** `REDDIT_POST_MODE` defaults to `manual`:
the publish loop is not registered at all (`src/main.ts`), and the gate's manual
branch marks the job `manual_pending` and returns before any Reddit call
(`src/publish/gate.ts`).

Beyond that: **no code in this repository creates a job for the publish queue.**
Grep for `insert(schema.publishJobs` — there are no matches. In the wider
internal tool those rows come from a separate approval step that is not part of
this repository.

An `api` posting path exists in `src/publish/gate.ts` and `src/publish/reddit.ts`.
It is disabled by default and using it would require approved Reddit Data API
access and credentials this repository ships blank. It is kept rather than
deleted because it is the honest answer to what the program would do if approved.

## Safeguards, and the file that enforces each

These run in the publisher, not in the approval step, so an approval cannot
override them.

| safeguard | file |
|---|---|
| Claim linter — six rules; a hit is a hard failure | `src/compliance/bannedPhrases.ts` |
| Founder disclosure appended to any reply mentioning the product | `src/compliance/disclosure.ts` |
| Daily reply cap (`REDDIT_MAX_REPLIES_PER_DAY`, default 4) | `src/publish/gate.ts` |
| Minimum 25-minute gap between replies | `src/publish/gate.ts` |
| Manual mode — the default; hands the reply back to a human | `src/publish/gate.ts` |
| 48-hour purge of stored post text | `src/publish/purge.ts` |

## Data handling

Post text is stored only long enough to draft a reply and is cleared after
`PURGE_AFTER_HOURS` (default 48). Nothing is sold, shared, redistributed, or
used to train a model. There is one account and no rotation. Reddit data is not
combined with any other source.

## Reply drafts are LLM-prepared and human-reviewed

Drafts are prepared with an LLM assistant. Every word is read by a human before
it is posted, and most drafts are discarded.

## Three platform names a grep will find, and why

Rather than leave these to be discovered:

- **`Threads` and `YouTube`** appear once, in `src/triage/prompts.ts`, in a rule
  giving character limits per platform. The drafting prompt is shared with a
  wider internal tool; this repository posts to neither, and the limits are inert
  here.
- **`Discord_Bots`** appears as one of the six subreddit names in
  `.env.example`. It is a subreddit, not the Discord platform. It is listed
  rather than quietly dropped because it is genuinely monitored.

## Running it

```sh
pnpm install
cp .env.example .env        # then fill in DATABASE_URL and REDDIT_USER_AGENT
docker compose up -d        # local Postgres on 5433
pnpm db:migrate
pnpm job:listen             # fetch feeds, store items
```

**`job:listen` needs exactly two values filled** — `DATABASE_URL` and
`REDDIT_USER_AGENT`. Every credential may stay blank: they are validated at the
point of use, not at boot, so the read-only listener runs on a machine with no
Anthropic token and no SMTP account. `pnpm job:triage` fails without
`CLAUDE_CODE_OAUTH_TOKEN` (`src/triage/claude.ts`) and `pnpm job:digest` fails
without the SMTP settings (`requireDigestConfig`, `src/digest/email.ts`) — each
with a message naming what is missing. `pnpm start` runs everything on a
schedule.

`.env` is read by Node's own `--env-file-if-exists`, so there is no dotenv
dependency and nothing breaks when the file is absent and the environment comes
from systemd or Docker instead.

Licence: MIT. See `docs/architecture.md` for the data flow in more detail and
`docs/reddit-access-request.md` for the access request this repository supports.
