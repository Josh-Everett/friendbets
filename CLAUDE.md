# FriendBets — Project Documentation

A social betting web app for a group of 7 friends. Members form groups, bet on each other using imaginary currency, and build a history of legendary moments.

**Live URL:** friendbets.net
**Repository owner:** Go/C# backend engineer learning the JS/TS ecosystem

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Local Development](#local-development)
4. [Supabase Setup](#supabase-setup)
5. [Database Schema](#database-schema)
6. [Auth System](#auth-system)
7. [Bet Lifecycle](#bet-lifecycle)
8. [Payout & Subject Bonus Logic](#payout--subject-bonus-logic)
9. [API Routes](#api-routes)
10. [UI Architecture](#ui-architecture)
11. [Realtime Subscriptions](#realtime-subscriptions)
12. [Deployment (Cloudflare)](#deployment-cloudflare)
13. [Known Issues & Incomplete Features](#known-issues--incomplete-features) *(see [BRAINSTORM.md](./BRAINSTORM.md))*
14. [Key Conventions](#key-conventions)
15. [File Listing](#file-listing)

### Related Documents
- **[BRAINSTORM.md](./BRAINSTORM.md)** — Known issues, design questions, feature ideas
- **[MARKET_MAKING_PLAN.md](./MARKET_MAKING_PLAN.md)** — Dynamic odds implementation plan (CPMM with virtual liquidity)

---

## Tech Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.1.6 | React 19, `src/` directory |
| Language | TypeScript | ^5 | Strict mode enabled |
| Styling | Tailwind CSS | v4 | CSS-based config via `@theme inline {}`, NOT tailwind.config.ts |
| Database | Supabase (Postgres) | JS client v2.98.0 | `@supabase/ssr` for cookie-based auth |
| Icons | lucide-react | ^0.575.0 | |
| Dates | date-fns | ^4.1.0 | `formatDistanceToNow` primarily |
| Validation | zod | ^4.3.6 | Declared but not yet used |
| Hosting | Cloudflare Workers | via `@opennextjs/cloudflare` ^1.17.1 | |

---

## Project Structure

```
friendbets/
  .env.local                          # Supabase credentials (not committed)
  .env.example                        # Template for env vars
  open-next.config.ts                 # Cloudflare adapter config
  wrangler.jsonc                      # Cloudflare Workers config
  supabase/
    migrations/
      001_initial_schema.sql          # All tables, functions, RLS, triggers, indexes
      002_storage.sql                 # Storage bucket policies
  src/
    middleware.ts                     # Auth session refresh + route protection
    app/
      layout.tsx                     # Root layout (Geist fonts, dark theme)
      page.tsx                       # Landing page (redirects to /dashboard if logged in)
      globals.css                    # Tailwind v4 theme + utility classes
      (auth)/                        # Auth route group (no app nav)
        login/page.tsx
        signup/page.tsx
        callback/route.ts            # Email confirmation callback
        join/[code]/                 # Invite link handler
          page.tsx                   # Server: validates code, shows preview
          join-client.tsx            # Client: join button
      (app)/                         # App route group (has nav + auth guard)
        layout.tsx                   # App layout: nav, mobile bottom nav, ToastProvider
        dashboard/page.tsx           # List of user's groups + create group form
        profile/page.tsx             # User stats, groups, achievements
        groups/[id]/
          page.tsx                   # Group page with tab navigation
          bets/[betId]/page.tsx      # Bet detail: wagers, resolution, proofs
      api/
        groups/route.ts              # POST: create group
        join/route.ts                # POST: join group via invite code
        upload/route.ts              # POST: generate signed upload URL
        bets/
          wager/route.ts             # POST: place wager (calls RPC)
          resolve/route.ts           # POST: resolve bet (calls RPC)
          cancel/route.ts            # POST: cancel bet (calls RPC)
          lock/route.ts              # POST: lock bet (direct update)
          vote/route.ts              # POST: cast vote
    components/
      ui/                            # Primitives: Button, Card, Input, Badge, Dialog,
                                     #   Avatar, Toast, Spinner
      auth/                          # LoginForm, SignupForm
      layout/                        # AppNav (top nav with group switcher + user menu)
      groups/                        # CreateGroupForm, GroupTabs, GroupSettings,
                                     #   GroupHistory, InviteCodeDisplay, MemberList
      bets/                          # BetCard, BetFeed, CreateBetForm, WagerSection,
                                     #   ResolutionPanel, ProofGallery
      leaderboard/                   # LeaderboardTable
      achievements/                  # AchievementsList
    hooks/
      use-supabase.ts                # Memoized browser Supabase client
      use-user.ts                    # Auth state hook { user, loading }
      use-realtime-bets.ts           # Live bet feed + wager subscriptions
    lib/
      utils.ts                       # cn(), formatCurrency(), generateInviteCode(),
                                     #   getInitials(), calculatePayout()
      constants.ts                   # Achievement types, bet status labels/colors,
                                     #   upload limits
      bet-engine.ts                  # Client-side payout calculation (display only)
      supabase/
        client.ts                    # Browser client (createBrowserClient)
        server.ts                    # Server client (createServerClient + cookies)
        admin.ts                     # Service role client (bypasses RLS)
      types/
        database.ts                  # Supabase-style table types (Row/Insert/Update)
        app.ts                       # Derived types + enriched UI types
```

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (standard Next.js, no Cloudflare adapter needed)
npm run dev

# Type-check only (faster than full build)
npx tsc --noEmit

# Full Next.js build (verifies compilation + static generation)
node node_modules/next/dist/bin/next build
```

**Note:** `npm run build` runs the Cloudflare adapter build which is very memory-intensive. Use `next build` directly for local verification. The Cloudflare build should run in CI (Cloudflare Pages) where it has adequate resources.

### Environment Variables

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
```

- `NEXT_PUBLIC_*` keys are safe to expose in the browser. RLS policies restrict access.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. Server-only. Never expose to the browser.

---

## Supabase Setup

### 1. Create Project
Go to supabase.com, create a new project. Note the Project URL and API keys from **Settings > API**.

### 2. Run Migrations
Open **SQL Editor** in the Supabase dashboard. Paste and run:
1. `supabase/migrations/001_initial_schema.sql` — tables, functions, RLS, triggers, indexes
2. `supabase/migrations/002_storage.sql` — storage bucket policies

### 3. Create Storage Bucket
**Storage > New Bucket** — name: `bet-proofs`, private, 50MB max file size.

### 4. Configure Auth
**Auth > URL Configuration:**
- Site URL: `http://localhost:3000` (dev) or `https://friendbets.net` (prod)
- Redirect URLs: `http://localhost:3000/callback`, `https://friendbets.net/callback`

Email confirmation is ON by default. For local dev, use Supabase's built-in Inbucket (check **Auth > Users** to see confirmation emails).

### 5. Enable Realtime
**Database > Publications** — ensure the `supabase_realtime` publication includes the `bets` and `bet_wagers` tables. This is required for the live bet feed.

---

## Database Schema

### Tables (9)

| Table | Purpose | Key Constraints |
|---|---|---|
| `profiles` | User profiles, auto-created on signup via trigger | PK `id` refs `auth.users`, UNIQUE `username` |
| `groups` | Betting groups with custom currency | Defaults: 'Coins', starting_balance 1000 |
| `group_members` | Membership + balance tracking | UNIQUE(group_id, user_id), role: admin/member |
| `invite_codes` | Shareable join codes | UNIQUE `code`, optional max_uses + expiry |
| `bets` | Core bet entity | Status: open/locked/resolved/cancelled |
| `bet_wagers` | Individual wagers | UNIQUE(bet_id, user_id) — one wager per user per bet |
| `bet_votes` | Votes for vote-resolved bets | UNIQUE(bet_id, user_id) |
| `bet_proofs` | Evidence uploads (image/video) | file_path points to Supabase Storage |
| `achievements` | Earned achievements | Tied to group + optionally a bet |

### Database Functions (PL/pgSQL, SECURITY DEFINER)

These run atomically inside a Postgres transaction:

**`place_wager(p_bet_id, p_user_id, p_side, p_amount) -> uuid`**
- Validates: bet is open, user is a member, no duplicate wager, sufficient balance
- Deducts balance from `group_members`, inserts wager
- Returns wager ID

**`resolve_bet(p_bet_id, p_outcome, p_resolved_by) -> void`**
- Validates: bet is open or locked
- Calculates payouts proportionally (see [Payout Logic](#payout--subject-bonus-logic))
- Credits winner balances, sets loser payouts to 0
- Applies subject bonus if applicable
- Sets status to 'resolved'

**`cancel_bet(p_bet_id) -> void`**
- Refunds all wagers: credits each user's balance back
- Sets status to 'cancelled'

### Auto-Profile Trigger

`on_auth_user_created` — AFTER INSERT on `auth.users`:
- Creates a `profiles` row using `username` from signup metadata
- Falls back to email prefix if no username provided

### RLS

RLS is enabled on ALL 9 tables. Key patterns:
- Profiles: any authenticated user can read; users can only update their own
- Groups/members/bets/wagers: scoped to group membership (subquery: `user_id IN group_members WHERE group_id = ...`)
- Inserts: require `auth.uid()` to match the `created_by`/`user_id`/`uploaded_by` column
- Achievements: read-only via RLS (no insert policy — must use service role or SECURITY DEFINER)

---

## Auth System

### Flow
1. **Signup:** Email + password + username. Username stored in `raw_user_meta_data`. Email confirmation sent.
2. **Confirm:** User clicks email link → hits `/callback` route → exchanges code for session → redirects to `/dashboard`.
3. **Login:** Email + password → Supabase sets session cookies.
4. **Session Refresh:** Middleware runs on every request to protected routes, refreshing the Supabase auth token via cookies.

### Route Protection (middleware.ts)
- `/dashboard/*`, `/groups/*`, `/profile/*` → redirect to `/login` if unauthenticated
- `/login`, `/signup` → redirect to `/dashboard` if already authenticated
- Landing page, callback, join, and API routes are NOT protected by middleware

### Three Supabase Clients
| Client | File | Used Where | RLS |
|---|---|---|---|
| Browser | `lib/supabase/client.ts` | Client components, hooks | Enforced |
| Server | `lib/supabase/server.ts` | Server components, API routes | Enforced |
| Admin | `lib/supabase/admin.ts` | Not currently used in routes | Bypassed |

---

## Bet Lifecycle

```
open ──→ locked ──→ resolved
  │         │
  └─────────┴──→ cancelled
```

| Transition | Who Can Do It | How |
|---|---|---|
| open → locked | Creator only | `/api/bets/lock` (direct UPDATE) |
| open/locked → resolved | Creator or admin | `/api/bets/resolve` (calls `resolve_bet` RPC) |
| open/locked → cancelled | Creator or admin | `/api/bets/cancel` (calls `cancel_bet` RPC) |

**Locking** stops new wagers but allows voting and resolution.

### Resolution Methods

**Creator-decided:** The bet creator clicks "It Happened" or "Didn't Happen".

**Group vote:** Members cast boolean votes. Once `ceil(memberCount / 2)` votes are in, the creator can finalize:
- Majority wins → resolved with that outcome
- Tie → cancelled (all wagers refunded)

Vote finalization is manual — reaching the threshold does NOT auto-resolve.

---

## Payout & Subject Bonus Logic

> **Note:** This system is being replaced by a CPMM dynamic odds model where users buy shares at shifting prices. See [MARKET_MAKING_PLAN.md](./MARKET_MAKING_PLAN.md) for the new design. The documentation below describes the **current** (pre-AMM) implementation.

### Standard Payouts
Winners split the loser pool proportionally to their wager amounts:

```
payout = wager_amount + (wager_amount / total_winner_pool) * total_loser_pool
```

Example: Alice bets 100 For, Bob bets 50 For, Charlie bets 200 Against. Outcome: For wins.
- Loser pool: 200 (Charlie)
- Alice payout: 100 + (100/150) * 200 = 100 + 133 = 233
- Bob payout: 50 + (50/150) * 200 = 50 + 67 = 117
- Charlie payout: 0

### Subject Bonus
If ALL three conditions are met:
1. The bet has a `subject_user_id` (someone the bet is "about")
2. The outcome is `true` (the subject succeeded)
3. The subject is NOT the bet creator

Then the subject receives the **FULL TOTAL POT** (sum of all wager amounts) as a bonus, added directly to their balance. This is ON TOP of any normal payout they receive from wagering.

**Important:** The subject bonus is inflationary — it creates new currency rather than redistributing existing currency.

---

## API Routes

| Route | Method | Auth | What It Does |
|---|---|---|---|
| `/api/groups` | POST | Required | Creates group + admin member + initial invite code |
| `/api/join` | POST | Required | Joins group via invite code |
| `/api/upload` | POST | Required | Generates signed upload URL for proof files |
| `/api/bets/wager` | POST | Required | Places wager via `place_wager` RPC |
| `/api/bets/lock` | POST | Creator only | Locks bet (direct table update) |
| `/api/bets/resolve` | POST | Creator or admin | Resolves bet via `resolve_bet` RPC |
| `/api/bets/cancel` | POST | Creator or admin | Cancels bet via `cancel_bet` RPC |
| `/api/bets/vote` | POST | Group member | Casts vote on vote-resolved bet |

All routes follow the same pattern: authenticate via `supabase.auth.getUser()`, validate, perform action, return JSON.

**Important:** Financial operations (wager, resolve, cancel) happen inside PL/pgSQL SECURITY DEFINER functions for atomicity. Locking is the only state transition that uses a direct table update (because it has no financial side effects).

---

## UI Architecture

### Theme (Rainbet-inspired dark navy)
Defined in `globals.css` via CSS custom properties + Tailwind v4 `@theme inline {}`:

| Token | Color | Usage |
|---|---|---|
| `--background` | `#0f1728` | Page background |
| `--background-card` | `#151d30` | Card backgrounds |
| `--background-elevated` | `#1a2340` | Elevated surfaces, inputs |
| `--foreground` | `#ffffff` | Primary text |
| `--foreground-secondary` | `#a2a8cc` | Secondary/muted text (periwinkle) |
| `--accent-primary` | `#ba0963` | CTAs, active states (magenta) |
| `--accent-gold` | `#fdd160` | Wins, balances, achievements |
| `--border-subtle` | `rgba(255,255,255,0.05)` | Card borders |
| `--border-light` | `rgba(255,255,255,0.1)` | Input borders, dividers |

Custom CSS classes: `.glass-card`, `.btn-primary`, `.btn-secondary`, `.btn-gold`

### UI Primitives (`src/components/ui/`)
| Component | Key Props | Notes |
|---|---|---|
| `Button` | `variant` (primary/secondary/gold/ghost/danger), `size`, `loading` | Shows spinner when loading |
| `Card` | `variant` (default/glass) | + `CardHeader`, `CardContent`, `CardFooter` |
| `Input` | `label`, `error` | Shows red border + error text when error is set |
| `Badge` | `variant` (default/success/warning/danger/gold) | |
| `Dialog` | `open`, `onClose`, `title` | Modal with backdrop blur, ESC to close |
| `Avatar` | `src`, `name`, `size` | Falls back to initials if no src |
| `Spinner` | `size` | SVG spinner in magenta |
| `Toast` | — | Use `<ToastProvider>` + `useToast()` hook |

### Toast System
`ToastProvider` wraps the app layout. Components call `const { toast } = useToast()` then `toast('message', 'success')`. Types: `success`, `error`, `info`. Auto-dismiss after 4 seconds.

### Group Page Tabs
URL-based tab state via `?tab=` search parameter. Default: `bets`. Tabs: Bets, Leaderboard, History, Achievements, Settings (admin only). All data is fetched server-side per navigation.

---

## Realtime Subscriptions

Two hooks in `src/hooks/use-realtime-bets.ts`:

**`useRealtimeBets(groupId)`** — Used in the bet feed. Subscribes to INSERT/UPDATE/DELETE on the `bets` table filtered by `group_id`. Keeps the bet list updated without page refresh.

**`useRealtimeWagers(betId)`** — For live wager updates on the bet detail page. Subscribes to INSERT/UPDATE on `bet_wagers` filtered by `bet_id`.

**Caveat:** Postgres change events return raw rows without joined relations (e.g., profiles). Newly inserted items will display with null profile data until the next full page load.

**Prerequisite:** The `supabase_realtime` publication must include the `bets` and `bet_wagers` tables (configure in Supabase dashboard under Database > Publications).

---

## Deployment (Cloudflare)

### Config Files
- `wrangler.jsonc` — Worker name, compatibility flags (`nodejs_compat`), asset binding
- `open-next.config.ts` — OpenNext Cloudflare adapter config (R2 cache commented out)

### Deploy via Cloudflare Pages (recommended)
1. Push to GitHub
2. Cloudflare Dashboard > Workers & Pages > Create > Pages > Connect to Git
3. Build settings:
   - Build command: `npm run build`
   - Build output directory: `.open-next`
   - Environment variable: `NODE_VERSION=18`
4. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
5. Custom domains > add `friendbets.net`

Every `git push` triggers a remote build and deploy.

### Local Dev
Just use `npm run dev` — the Cloudflare adapter is only needed for production builds.

---

## Known Issues & Incomplete Features

See **[BRAINSTORM.md](./BRAINSTORM.md)** for the full list of known bugs, safety gaps, incomplete features, design questions, and feature ideas. That document serves as the living brainstorm space — items get refined there and then become concrete development plans.

---

## Key Conventions

### TypeScript & Supabase
- **No `Database` generic on Supabase clients.** The v2.98 client's type inference breaks with our schema (produces `never` types). All three client factories create untyped clients.
- **`as any` casts after null checks.** Server pages cast query results to `any` after null-check guards because TypeScript narrows `.single()` results to `never` after `notFound()`/`redirect()`.
- **`(supabase.rpc as any)(...)` for RPC calls.** Same root cause — the untyped client's `.rpc()` method signature doesn't accept arguments properly.
- **`as { data: any }` on query chains.** Used when destructuring Supabase query results in server components and API routes.

### Next.js
- **`force-dynamic` on auth pages + landing page.** Prevents static prerendering which fails because env vars aren't available at build time.
- **`params` and `searchParams` are Promises in Next.js 16.** Must be `await`ed: `const { id } = await params`.
- **Middleware deprecation warning.** Next.js 16 warns that `middleware.ts` is deprecated in favor of `proxy.ts`. The middleware still works but may need migration in future versions.

### Styling
- **Tailwind v4:** Config is in `globals.css` via `@theme inline {}`, NOT in a `tailwind.config.ts` file.
- **`cn()` utility:** Always use `cn()` from `@/lib/utils` for conditional class merging.
- **Color hardcodes:** Components use hex values directly (e.g., `bg-[#151d30]`, `text-[#a2a8cc]`) rather than Tailwind theme tokens. This is intentional for readability but means theme changes require find-and-replace.

### File Patterns
- Server components: fetch data with `await createClient()` from `@/lib/supabase/server`
- Client components: use `useSupabase()` hook from `@/hooks/use-supabase`
- API routes: authenticate with `supabase.auth.getUser()`, return `NextResponse.json()`
- Financial operations: always use PL/pgSQL RPC functions for atomicity

---

## File Listing

```
src/app/(app)/dashboard/page.tsx
src/app/(app)/groups/[id]/bets/[betId]/page.tsx
src/app/(app)/groups/[id]/page.tsx
src/app/(app)/layout.tsx
src/app/(app)/profile/page.tsx
src/app/(auth)/callback/route.ts
src/app/(auth)/join/[code]/join-client.tsx
src/app/(auth)/join/[code]/page.tsx
src/app/(auth)/login/page.tsx
src/app/(auth)/signup/page.tsx
src/app/api/bets/cancel/route.ts
src/app/api/bets/lock/route.ts
src/app/api/bets/resolve/route.ts
src/app/api/bets/vote/route.ts
src/app/api/bets/wager/route.ts
src/app/api/groups/route.ts
src/app/api/join/route.ts
src/app/api/upload/route.ts
src/app/favicon.ico
src/app/globals.css
src/app/layout.tsx
src/app/page.tsx
src/components/achievements/achievements-list.tsx
src/components/auth/login-form.tsx
src/components/auth/signup-form.tsx
src/components/bets/bet-card.tsx
src/components/bets/bet-feed.tsx
src/components/bets/create-bet-form.tsx
src/components/bets/proof-gallery.tsx
src/components/bets/resolution-panel.tsx
src/components/bets/wager-section.tsx
src/components/groups/create-group-form.tsx
src/components/groups/group-history.tsx
src/components/groups/group-settings.tsx
src/components/groups/group-tabs.tsx
src/components/groups/invite-code-display.tsx
src/components/groups/member-list.tsx
src/components/layout/app-nav.tsx
src/components/leaderboard/leaderboard-table.tsx
src/components/ui/avatar.tsx
src/components/ui/badge.tsx
src/components/ui/button.tsx
src/components/ui/card.tsx
src/components/ui/dialog.tsx
src/components/ui/input.tsx
src/components/ui/spinner.tsx
src/components/ui/toast.tsx
src/hooks/use-realtime-bets.ts
src/hooks/use-supabase.ts
src/hooks/use-user.ts
src/lib/bet-engine.ts
src/lib/constants.ts
src/lib/supabase/admin.ts
src/lib/supabase/client.ts
src/lib/supabase/server.ts
src/lib/types/app.ts
src/lib/types/database.ts
src/lib/utils.ts
src/middleware.ts
```
