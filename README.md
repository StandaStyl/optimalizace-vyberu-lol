# Draft Advisor

League of Legends draft assistant built on the Riot Games API. Successor to the thesis
*Rozhodovací model pro sestavení optimálního herního týmu ve hře League of Legends* (Musil, 2017),
rebuilt on a probabilistic footing:

- **Calibrated uncertainty** — every number ships with an 80% interval; ties are shown as indifference classes.
- **Player-level personalisation** — a continuous, shrunk player×champion term for all 10 players, not rules.
- **Probabilistic enemy-position inference** — constraint propagation over P(position | champion).
- **Tier-band estimation** — separate models for Iron–Gold, Platinum–Emerald, Diamond+ (replaces the hand-set division weight).
- **Public evaluation** — log-loss, Brier, AUC, ECE per patch, always visible.

Scope for now: **EUNE + EUW, Ranked Solo/Duo (queue 420)**.

## Layout

```
packages/core     shared types, Riot API client (rate-limited), Data Dragon, DB + migrations
apps/ingest       crawler + Data Dragon sync + CLI
apps/model        posteriors, scoring, position inference, evaluation   (phase 2–3)
apps/api          HTTP API                                               (phase 4)
apps/web          Next.js UI                                             (phase 4)
apps/desktop      Tauri LCU connector                                    (phase 5)
infra/migrations  SQL, applied in lexical order by `npm run db:migrate`
```

## Setup

```bash
npm install
cp .env.example .env     # fill RIOT_API_KEY and DATABASE_URL (Supabase)
npm run db:migrate
npm run ddragon:sync
npm test
```

Requires Node ≥ 22 (uses `--experimental-strip-types`; no build step for scripts).

## Riot policy

Read-only use of the public API; no champ-select automation; no PII stored beyond `puuid`.
Draft Advisor is not endorsed by Riot Games and does not reflect the views or opinions of
Riot Games or anyone officially involved in producing or managing Riot Games properties.
