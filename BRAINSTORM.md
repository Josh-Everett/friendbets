# FriendBets — Brainstorm

A living document for ideas, known issues, and future plans. Items here get refined and eventually become concrete development tasks.

---

## Table of Contents

1. [Known Bugs & Safety Gaps](#known-bugs--safety-gaps)
2. [Incomplete Features](#incomplete-features)
3. [Design & Balance Questions](#design--balance-questions)
4. [Feature Ideas](#feature-ideas)
5. [Platform Vision](#platform-vision)
6. [Economy Design](#economy-design)
7. [Developer Platform & Game API](#developer-platform--game-api)
8. [Scaling: Streamers & Large Communities](#scaling-streamers--large-communities)
9. [Infrastructure Roadmap](#infrastructure-roadmap)
10. [Monetization & Real Money](#monetization--real-money)
11. [POC Design Decisions](#poc-design-decisions)
12. [Clean Slate & Season Resets](#clean-slate--season-resets)
13. [Dev Tools](#dev-tools)

---

## Known Bugs & Safety Gaps

### 1. `cancel_bet` has no status guard
The SQL function does not check current status before cancelling. A resolved bet can be cancelled, which refunds wagers that were already paid out — inflating balances.

**Fix:** Add `IF v_bet.status NOT IN ('resolved', 'cancelled')` check in the PL/pgSQL function.

### 2. Group creation is not atomic
Three separate inserts (group, member, invite code) without a transaction. If the member or invite insert fails, the group exists but is broken.

**Fix:** Wrap in a PL/pgSQL function or use Supabase Edge Function.

### 3. Invite code join race condition
The `use_count` increment is not atomic with the membership insert. Two simultaneous joins could exceed `max_uses` by one.

**Fix:** Use `UPDATE ... SET use_count = use_count + 1 WHERE use_count < max_uses RETURNING *`.

### 4. Storage policies are overly broad
Any authenticated user can read/write any file in the `bet-proofs` bucket regardless of group membership. App-layer RLS on `bet_proofs` table controls record visibility, but the raw files are accessible.

**Fix:** Scope storage policies by path prefix (e.g., `{group_id}/{bet_id}/`).

---

## Incomplete Features

### 5. Achievements are not grantable
The constants, types, UI, and database table exist, but there is no code that actually inserts achievements. There is also no INSERT RLS policy on the `achievements` table.

**Needs:** Achievement-granting logic (likely in `resolve_bet` function or a post-resolution API call).

### 6. `p_resolved_by` parameter is unused
The `resolve_bet` function accepts this parameter but does not store it anywhere.

**Options:**
- Remove the parameter entirely
- Add a `resolved_by` column to the `bets` table and store it

### 7. Zod validation not wired up
`zod` is installed as a dependency but no validation schemas exist. API routes currently trust request bodies without schema validation.

**Opportunity:** Add request body validation to all API routes.

### 8. Profile editing
The profile page is read-only. No form to update username, display name, or avatar.

### 9. Deadline auto-lock
Bets have a `deadline` field but there is no cron/scheduled job to auto-lock bets when the deadline passes. Locking is manual only.

**Options:**
- Supabase Edge Function on a cron schedule
- Cloudflare Workers Cron Trigger
- Check-on-load approach (lock expired bets when the group page renders)

---

## Design & Balance Questions

### Subject bonus is inflationary
The subject bonus grants the FULL TOTAL POT as new currency rather than redistributing existing currency. Over time this inflates the group's total money supply.

**Questions to consider:**
- Is this intentional? It rewards being the subject of a successful bet, but it can snowball.
- Should there be a cap (e.g., subject bonus capped at 50% of pot)?
- Should it redistribute from a "house" pool instead of minting new currency?
- Or is inflation fine for a fun friend group app where the numbers are meaningless?

### Subject bonus in AMM context
With the new dynamic odds system, the subject can already benefit by betting on themselves early at good odds. Does the bonus still make sense?

**Options:**
- Keep as-is (full pot, inflationary) — simple, dramatic, fun
- Scale to a percentage of pot (e.g., 25%)
- Give bonus shares instead of coins — but shares only exist per-bet, not as currency
- Remove entirely — the AMM already provides the incentive (bet on yourself at opening odds)

See **[MARKET_MAKING_PLAN.md](./MARKET_MAKING_PLAN.md)** for full context.

### Realtime events lack profile data
Postgres change events return raw rows without joined relations (e.g., profiles). Newly inserted items display with null profile data until the next full page load.

**Options:**
- Client-side profile cache that the realtime handler can look up
- Fetch profile data on INSERT event
- Accept the limitation (profiles load on next navigation)

---

## Feature Ideas

*Add ideas here as they come up. When one is fleshed out enough, create a development plan for it.*

- **Notifications:** In-app notification bell for new bets, wagers on your bets, resolution results
- **Bet comments/trash talk:** Thread of messages on each bet for banter
- **Recurring bets:** Templates for bets that happen regularly (e.g., weekly predictions)
- **Bet categories/tags:** Organize bets by type (sports, dares, predictions, etc.)
- **Group stats dashboard:** Charts showing betting trends, biggest wins, most active members
- **Dark/light mode toggle:** Currently hardcoded dark theme only
- **PWA support:** Installable on mobile home screen with offline indicator
- **Emoji reactions:** Quick reactions on bets and resolutions
- ~~**Dynamic odds / market making:**~~ **PLANNED** — see [MARKET_MAKING_PLAN.md](./MARKET_MAKING_PLAN.md). CPMM with virtual liquidity, creator is first bettor, no early cashout.
- **Odds history chart:** Visual graph showing how odds moved over the life of a bet (pairs well with AMM system)
- **Virtual liquidity as group setting:** Let group admins tune how sensitive odds are to wagers

---

## Platform Vision

FriendBets is not just a website — it's a **social betting platform** with a virtual economy that spans web, mobile, and games.

### Surfaces

| Surface | Technology | Status |
|---|---|---|
| Web app | Next.js + Supabase | In progress |
| iOS app | React Native (Expo) | Future |
| Android app | React Native (Expo) | Future |
| Steam games (Windows) | Unity/Unreal + FriendBets SDK | Future |
| Third-party games | Any engine + FriendBets REST API | Future |

### Core Principle: Groups Are the Scope

Everything is group-scoped. You don't just "play poker" — you play poker with your Beer Tokens group. The group is the social unit, the economy, and the matchmaking pool for all activities:

- **Bets** happen within a group (current feature)
- **Games** are played between group members using group currency
- **Leaderboards** are per-group per-season
- **Mobile app** shows the same groups, bets, and balances as the web

Shared auth via Supabase — one account works across web, mobile, and game clients. Games authenticate users via FriendBets API and verify group membership before allowing play.

### Mobile App (React Native / Expo)

Why Expo:
- Same TypeScript ecosystem as the web app
- Supabase JS client works in React Native
- Share types, AMM math module, constants, validation schemas
- UI is rewritten in React Native components (no HTML/Tailwind), but data layer carries over
- Push notifications for bet activity, game invites, season resets

### Steam / PC Games

Games are separate executables distributed on Steam. They connect to FriendBets via REST API to:
- Authenticate users (link Steam account ↔ FriendBets account)
- Verify group membership
- Convert group currency ↔ game currency (with conversion fee)
- Report game results (credit/debit balances)

---

## Economy Design

### Currency Layers

```
Group Currency (Beer Tokens, Lunch Bucks, etc.)
       ↕ conversion (fee taken by FriendBets)
Game Currency (Poker Chips, Racing Bucks, etc.)
```

- **Group currency** is the core economy. Earned through daily allowance, won through bets and games. Resets seasonally.
- **Game currency** is specific to each game. Exists only during a game session. Converted in from group currency at session start, converted out at session end.
- Each game defines its own currency name, symbol, and exchange rate relative to group currency.
- **Conversion fee** (e.g., 3%) is taken on each direction. Round-trip cost: ~6%. This is FriendBets' revenue model.

### Daily Allowance

Every group member receives a daily currency credit. Prevents permanent bankruptcy and keeps everyone engaged.

**Proposed formula:** `daily_allowance = starting_balance * 0.05` (5% of starting balance per day)

- Group with 1000 starting balance → 50 coins/day
- Broke player can place a small bet after one day, a meaningful one after a few days
- Not enough to recover from a big loss quickly — winning is still the best path

**Implementation options:**
- Supabase cron (pg_cron extension) that credits all members daily
- Cloudflare Workers Cron Trigger that calls an API endpoint
- Credit-on-login approach (calculate owed allowance since last login, credit on first request of the day)

Credit-on-login is simplest and doesn't require scheduled infrastructure. Store `last_allowance_at` on the group_members row.

### Seasonal Resets

Periodic balance resets create "seasons" that keep the game fresh and prevent runaway wealth.

**Configuration:** Group admin chooses reset frequency:
- Weekly
- Biweekly
- Monthly (default)
- Quarterly

**When a season resets:**
1. Current leaderboard is archived (season results table)
2. All group member balances reset to `starting_balance`
3. Active bets are force-cancelled (refund wagers at original amount)
4. Active game sessions are force-finished
5. Achievements earned during the season persist forever
6. All-time stats accumulate (lifetime winnings, total bets won, etc.)

**Season archive data:**
- Final rankings (position, balance, profit/loss from starting)
- MVP (highest profit)
- Best single bet (highest payout)
- Most active bettor (most bets placed)
- Season duration + total volume

### Going Broke

- You CAN go to zero. No minimum balance floor.
- Recovery paths: daily allowance, winning bets at long odds (AMM rewards risk-taking when broke), winning games
- Going broke is a social moment — friends will roast you, which is the point

### Inflation Tolerance

With seasonal resets, inflation within a season doesn't matter long-term. This simplifies several design decisions:
- Subject bonus can stay inflationary (full pot) — it resets anyway
- Daily allowance inflates the money supply — it resets anyway
- Game currency conversion rounding errors — they reset anyway

---

## Developer Platform & Game API

### Vision

Third-party developers (or us) can build games distributed on Steam that plug into the FriendBets economy. FriendBets provides the social layer (groups, auth, currency) and the games provide the entertainment.

### Developer Flow

1. Developer registers on FriendBets developer portal
2. Creates a "game" entry: name, description, icon, game currency (name, symbol, exchange rate)
3. Gets API keys (client ID + secret)
4. Integrates FriendBets SDK (Unity, Unreal, or raw REST API)
5. Submits game for review (we verify it's not malicious, handles currency properly)
6. Game is listed in FriendBets app, groups can enable/disable games

### API Surface (REST)

```
Authentication:
  POST /api/v1/auth/token         — Exchange Steam token for FriendBets session
  GET  /api/v1/auth/me            — Get current user profile

Groups:
  GET  /api/v1/groups             — List user's groups
  GET  /api/v1/groups/:id/members — List group members

Currency:
  GET  /api/v1/groups/:id/balance         — Get user's group balance
  POST /api/v1/currency/convert-in        — Group currency → Game currency
  POST /api/v1/currency/convert-out       — Game currency → Group currency

Game Sessions:
  POST /api/v1/games/sessions             — Create game session (locks buy-in)
  POST /api/v1/games/sessions/:id/result  — Report game result (distributes payouts)
  POST /api/v1/games/sessions/:id/cancel  — Cancel session (refund buy-ins)
```

### Key Requirements for the API Layer

- **Idempotency keys** on all currency operations — game servers will retry; double-credits are catastrophic
- **Transaction ledger** — every currency movement is an immutable record (not just balance += x)
- **Rate limiting** per API key
- **Webhook system** — notify games of season resets, user leaving group, etc.
- **Versioned API** (v1, v2...) — games are compiled binaries, they can't update instantly when the API changes

### Transaction Ledger

Move away from just updating `group_members.balance` directly. Instead:

```sql
CREATE TABLE transactions (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL,     -- 'bet_payout', 'game_win', 'game_buyin', 'daily_allowance',
                          -- 'conversion_fee', 'season_reset', 'wager_placed', 'refund'
  amount integer NOT NULL, -- positive = credit, negative = debit
  balance_after integer NOT NULL,
  reference_type text,     -- 'bet', 'game_session', 'conversion', etc.
  reference_id uuid,       -- ID of the bet, game session, etc.
  idempotency_key text UNIQUE, -- prevents duplicate transactions
  created_at timestamptz DEFAULT now()
);
```

Balance is derived from the transaction ledger (or cached on group_members but always reconcilable). This is essential for:
- Audit trail (where did my coins go?)
- Dispute resolution
- Debugging
- Analytics
- Real money compliance (later)

---

## Scaling: Streamers & Large Communities

### The Opportunity

Twitch Channel Points predictions are wildly popular but limited — they're locked to Twitch, can't integrate with games, and the streamer doesn't own the economy. FriendBets is the open, cross-platform, game-integrated version.

A streamer's community is just a "group" at a different scale. The same group currency, betting, and game features apply — but the infrastructure needs to handle orders of magnitude more traffic.

### Group Types

Groups need a `type` field that determines behavior and feature access:

| | `friends` | `community` | `streamer` |
|---|---|---|---|
| Typical size | 5-20 | 20-500 | 100 - 100,000+ |
| Who creates bets | Any member | Admins + designated | Streamer + mods only |
| Bet lifecycle | Hours to weeks | Hours to days | Minutes (live) |
| Resolution | Creator or vote | Creator or vote | Streamer or auto-resolve |
| AMM processing | Direct DB (sync) | Direct DB (sync) | Batched or dedicated engine |
| Moderation | Minimal | Mod roles | Full mod tooling |

### AMM at Scale — The Contention Problem

The CPMM `buy_shares` function locks the bet row (`SELECT ... FOR UPDATE`) for every trade. This serializes at scale.

**Batch Auction Windows (Stage 1 — hundreds of concurrent users):**
- Collect wagers in time windows (2-3 seconds)
- All wagers in a window fill at the same price
- One AMM state update per window instead of per trade
- Implementable with a message queue (Redis, Cloudflare Queue) + single worker
- Users see "Order pending..." for a couple seconds, then "Filled at 0.42/share"

**In-Memory Trade Engine (Stage 2 — thousands of concurrent users):**
- Single-threaded Go or Rust service holds AMM state in memory
- Processes trades sequentially at tens of thousands/second
- Persists to Postgres asynchronously (eventual consistency)
- Database is the audit ledger, engine is the pricing source of truth
- WebSocket broadcast of price updates to all connected clients

**Horizontal Sharding (Stage 3 — massive scale):**
- Each active bet gets its own engine instance
- Routing layer directs trades to the correct engine
- Multiple streamers running simultaneously each have isolated workers

### Streamer-Specific Features

**Quick Bets:**
Streamer hits a hotkey or dashboard button → bet goes live instantly with a title, auto-closing in 30-120 seconds. Viewers see it and one-tap to bet. Designed for moments: "Will I clutch this round?" "Will I beat this boss?"

**Stream Overlays (OBS Browser Source):**
- Active bet with live odds bar
- Recent results ticker
- Top bettor leaderboard
- Animated notifications on big bets ("xX_Dave_Xx just went ALL IN on Yes!")

**Twitch/YouTube Extension:**
Embedded panel in the stream page. Viewers bet without leaving the stream. Zero friction. This is the killer UX.

**Auto-Resolution:**
For games with APIs (Riot, Valve, Epic, etc.), bets auto-resolve based on game data. "Will the streamer get a kill in the next round?" → game API reports result → bet resolves. No manual input.

**Multi-Outcome Bets:**
"Which boss will they die to?" with 5+ options. Two approaches:
- Multiple separate yes/no CPMM markets (one per outcome) — simple but odds don't naturally sum to 100%
- LMSR for multi-outcome markets — mathematically cleaner, single market with N outcomes, odds always sum to 100%
- Recommendation: start with separate yes/no markets, move to LMSR later

**Mod Tools:**
- Create/lock/cancel/resolve bets
- Ban users from betting (temporary or permanent)
- Set betting limits (max wager per user)
- View flagged activity (unusual patterns, potential abuse)

### Currency at Streamer Scale

Same group currency model, but acquisition differs:
- **Follow/subscribe rewards:** New followers or subs get a currency bonus (configurable)
- **Watch time rewards:** Passive currency accrual while watching the stream
- **Daily allowance:** Same as friend groups
- **Purchase (future):** Buy currency with real money/channel points

---

## Infrastructure Roadmap

Each stage builds on the last. Supabase stays as the database and auth provider throughout.

```
Stage 1 — POC (Current)
├── Supabase Postgres (all data)
├── Cloudflare Workers (Next.js app)
├── Direct DB queries for everything
└── Target: 7 friends, prove the concept

Stage 2 — AMM Launch
├── Same infra
├── AMM in PL/pgSQL (buy_shares, resolve_market)
├── Virtual liquidity, dynamic odds
└── Target: Small groups (5-50 people)

Stage 3 — Games & API
├── Add: Versioned REST API layer (/api/v1/...)
├── Add: Transaction ledger table
├── Add: Idempotency + rate limiting
├── Add: Webhook system
└── Target: Third-party game integration

Stage 4 — Mobile
├── Add: React Native (Expo) app
├── Add: Push notification service
├── Shared: Supabase auth, types, AMM math
└── Target: iOS + Android launch

Stage 5 — Streamers
├── Add: Redis/Cloudflare Queue for wager batching
├── Add: WebSocket server for live odds broadcast
├── Add: Read replicas for high-read queries
├── Add: Group types (friends/community/streamer)
├── Add: OBS overlay + Twitch extension
└── Target: Streamers with 100-10,000 viewers

Stage 6 — Scale
├── Add: In-memory trade engine (Go/Rust)
├── Add: Per-bet routing + horizontal sharding
├── Add: CDN for static + edge caching
├── Add: Multi-outcome markets (LMSR)
└── Target: Large streamers, 10,000+ concurrent bettors
```

---

## Monetization & Real Money

### Phase 1: Free (Current)
- All play money, no real money involved
- No revenue, just building the platform and user base

### Phase 2: Conversion Fees (With Games)
- Games convert group currency ↔ game currency with a percentage fee
- Fee is "virtual" — we take a cut of play money. No real revenue yet.
- But it establishes the mechanic and trains users on the concept

### Phase 3: Real Money (Future — Requires Legal Review)
- Users can purchase FriendBets Credits with real money
- Credits convert to group currency (like buying chips at a casino)
- Conversion fees on game currency become real revenue
- Potentially: premium features, cosmetics, group upgrades

### Legal Considerations (Not Solved, Just Flagged)
- Real money + betting on outcomes + payouts = **regulated gambling** in most jurisdictions
- Skill-based games may have different rules than chance-based
- "Social casino" models (buy currency, can't cash out) have their own regulations
- May need: gambling license, age verification, geographic restrictions, responsible gaming features
- **Action item:** Consult a lawyer specializing in gaming/gambling law before enabling real money
- Some possible safe harbors:
  - No cash-out (you can buy in but can't convert back to dollars) — "social casino" model
  - Skill-based games only (avoid pure-chance outcomes)
  - Restrict to jurisdictions where social betting is legal

---

## POC Design Decisions

These are the decisions that need to be finalized NOW to continue iterating on the proof of concept. Everything above is the long-term vision — this section is about what we build next.

### What the POC Must Prove

The POC targets 7 friends using the web app. It should demonstrate:
1. The core betting loop works and is fun (create → wager → resolve → payout)
2. Dynamic odds via AMM feel engaging (watching odds shift, getting good/bad prices)
3. The economy doesn't break within a season (balances stay meaningful)
4. The app is usable on mobile browsers (before native apps exist)

### Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| AMM type | CPMM (constant product) | Simple math, battle-tested, good enough for small groups |
| Liquidity model | Virtual (no LP risk) | Creator shouldn't lose money for creating a bet |
| Creator incentive | First-mover odds advantage | Creator picks a side + stakes coins at opening odds |
| Early cashout | No | Simplifies everything, positions locked until resolution |
| Multiple purchases | Same side only | Can add to position, can't hedge |
| Group scope | Everything group-scoped | Bets, games, currency, leaderboards |
| Going broke | Allowed, no floor | Daily allowance is the recovery path |
| Seasonal resets | Yes, admin-configurable | Weekly/biweekly/monthly/quarterly |

### Decisions Still Needed for POC

**1. Subject Bonus — Keep, Modify, or Remove?**

With the AMM, the subject can bet on themselves at good odds. The bonus may be redundant. But it's also a fun, dramatic moment.

> **Recommendation:** Keep it for the POC. It's simple, the friends will enjoy it, and seasonal resets prevent long-term inflation issues. Revisit after playtesting with the group.

**2. Virtual Liquidity Default — What Value?**

This controls how much odds swing per wager. Too low = wild swings, too high = boring flat odds.

> **Recommendation:** Default to `starting_balance / 2`. For a group with 1000 starting balance → V = 500. Let the group admin change it in settings. Label it simply: "Odds Sensitivity" with a Low/Medium/High selector mapping to V = starting_balance * 0.25 / 0.5 / 1.0.

**3. Daily Allowance — Amount and Implementation?**

> **Recommendation for POC:** 5% of starting_balance per day, credit-on-login (no cron needed). Store `last_allowance_at` on `group_members`. On any authenticated page load, check if 24h have passed, credit if so. Dead simple, no new infrastructure.

**4. Season Reset — Implementation for POC?**

> **Recommendation:** Store `season_end_at` and `reset_frequency` on the `groups` table. Check-on-load approach: when any member loads the group page and `now() > season_end_at`, trigger the reset (archive leaderboard, reset balances, cancel active bets, advance `season_end_at`). No cron needed for POC. Add a `seasons` archive table to store historical leaderboards.

**5. Transaction Ledger — Now or Later?**

The current system directly mutates `group_members.balance`. A transaction ledger adds complexity but makes the system auditable and sets up for games/API later.

> **Recommendation:** Add it now. It's a single new table + adjustments to the PL/pgSQL functions. Doing it later means migrating all existing balance mutations, which is painful. The ledger also makes debugging the AMM much easier during development — you can trace exactly where every coin went.

**6. Bet Creation — Still Allow Direct Insert or Force API?**

Currently `CreateBetForm` inserts directly into the `bets` table via Supabase client. The AMM requires atomic bet creation + first wager via `create_market` RPC.

> **Decision: Force API route.** The `CreateBetForm` must call `/api/bets/create` which calls the `create_market` RPC. Direct inserts into `bets` should be blocked (or at minimum, AMM state won't be initialized).

### POC Implementation Priority

Based on the decisions above, here's the build order for the next iteration:

```
1. Transaction ledger table + update PL/pgSQL functions to write ledger entries
2. AMM infrastructure (amm.ts, buy_shares, resolve_market, create_market)
3. Updated API routes (create, wager, resolve, cancel)
4. Updated UI (CreateBetForm, BetCard, bet detail, WagerSection)
5. Daily allowance (credit-on-login, last_allowance_at column)
6. Seasonal resets (seasons table, check-on-load reset trigger)
7. Fix existing bugs (cancel_bet status guard, group creation atomicity)
8. Deploy to Cloudflare, run Supabase migration, test with friends
```

Items 1-4 are the core AMM work — see [MARKET_MAKING_PLAN.md](./MARKET_MAKING_PLAN.md).
Items 5-6 are economy features that make playtesting realistic.
Item 7 cleans up known bugs from the first build.
Item 8 is go-live.

---

## Clean Slate & Season Resets

### What happens on a season reset

1. Archive current season standings (rank, balance, profit/loss per member)
2. Cancel all open/locked bets (refund wagers to balances before resetting)
3. Reset all member balances to `groups.starting_balance`
4. Increment season number
5. Achievements persist forever (not wiped)
6. Old bets/wagers stay in the database for history (tagged with season number)

### What does NOT happen

- Users are not removed from the group
- Profiles/accounts are untouched
- Invite codes remain valid
- Group settings (name, currency, starting balance) unchanged
- Proof files in storage are kept

### Design Questions

**1. How are seasons triggered?**

| Option | Approach | Pros | Cons |
|---|---|---|---|
| A: Manual | Admin clicks "End Season" in settings | Simple, explicit, no infra | Admin might forget |
| B: Auto (check-on-load) | Store `season_end_at` on group, trigger reset when expired | No cron, feels automatic | First loader pays the cost, race condition risk |
| C: Scheduled (cron) | pg_cron or Cloudflare Cron Trigger | Most reliable | Infra complexity, overkill for POC |

> **Leaning:** A (manual) for POC. Add B later.

**2. Do old bets stay in the database?**

> **Leaning:** Yes. Add a `season` integer column to `bets`. The stories are the product — deleting them defeats the purpose of a social app. Group history tab can filter by season.

**3. What stats do we archive per season?**

Minimum viable: rank, final balance, profit/loss (final_balance - starting_balance), dates.

> **Leaning:** Start minimal. "Nice to have" stats (biggest win, most active, win rate) can be computed from preserved bet data later.

**4. What happens to active bets on reset?**

| Option | Approach | Tradeoff |
|---|---|---|
| A: Force-cancel | Refund all wagers, set status cancelled | Fair but might kill an exciting bet |
| B: Carry over | Bets stay open into next season | Messy — locked money + reset balance = confusion |
| C: Grace period | Schedule reset 24-48h out, warn members | Best UX, more complex |

> **Leaning:** A (force-cancel) for POC. Consider C later.

**5. Can an admin undo a season reset?**

> **Leaning:** No. Irreversible. Archive exists for viewing history but balances/bets cannot be restored.

**6. Season numbering**

Auto-increment per group starting at 1. Season 1 begins when the group is created. Maybe allow custom season names later ("Summer 2026", "NFL Season").

### Proposed Schema Changes

```sql
-- Season archive
CREATE TABLE public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE NOT NULL,
  season_number integer NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL DEFAULT now(),
  total_bets integer NOT NULL DEFAULT 0,
  total_volume integer NOT NULL DEFAULT 0,
  UNIQUE(group_id, season_number)
);

-- Per-member results for each season
CREATE TABLE public.season_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid REFERENCES public.seasons(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  rank integer NOT NULL,
  final_balance integer NOT NULL,
  profit_loss integer NOT NULL,
  UNIQUE(season_id, user_id)
);

-- New columns on groups
ALTER TABLE public.groups ADD COLUMN current_season integer NOT NULL DEFAULT 1;
ALTER TABLE public.groups ADD COLUMN season_started_at timestamptz NOT NULL DEFAULT now();

-- New column on bets (nullable for backward compat)
ALTER TABLE public.bets ADD COLUMN season integer;
```

### Reset Function Sketch

```
reset_season(p_group_id, p_reset_by) -> void
  1. Verify caller is group admin
  2. Get current season info
  3. Count bets + sum volume for the season
  4. INSERT into seasons (archive metadata)
  5. INSERT into season_results (rank each member by balance)
  6. Cancel all open/locked bets (refund wagers, set status cancelled)
  7. Reset all group_members.balance to starting_balance
  8. Increment groups.current_season
  9. Set groups.season_started_at to now()
```

Note: refunding wagers in step 6 before resetting in step 7 doesn't matter functionally (balance gets overwritten anyway), but we still cancel bets to record proper status and payout history.

### Season Reset UI

- "End Season" button in group settings (admin only)
- Confirmation dialog showing: current season, duration, active bets to be cancelled, final standings preview
- After reset: toast "Season {N} complete! Season {N+1} has begun."
- Season history: new tab or sub-section showing past season leaderboards

### Open Items

- [ ] Decide: manual only vs. also support scheduled auto-reset?
- [ ] Decide: grace period / warning before reset?
- [ ] Decide: should `last_allowance_at` reset with the season?
- [ ] Design the season history UI (new tab? sub-section of leaderboard?)
- [ ] Write migration SQL (003_seasons.sql)
- [ ] Write PL/pgSQL `reset_season` function
- [ ] Wire up API route + UI

---

## Dev Tools

### Database Wipe Scripts

Two SQL scripts in `supabase/scripts/` for quick database clearing during development. Paste into the Supabase SQL Editor and run.

| Script | What it does | When to use |
|---|---|---|
| `dev-wipe-full.sql` | Nukes everything: users, profiles, groups, bets, storage refs | Starting completely over, testing signup flow |
| `dev-wipe-keep-users.sql` | Deletes all groups/bets/achievements, keeps users & profiles | Testing group creation and bet flows without re-signing up |

**Note:** Both scripts clear storage object metadata but actual files in the `bet-proofs` bucket need manual deletion via the Supabase Storage dashboard.
