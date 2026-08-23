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

## Specifications

Binding decisions live in [docs/specs](docs/specs/README.md) (SPEC-01 … SPEC-05). Change a decision there first, then the code.

## Layout

```
packages/core     shared types, Riot API client (rate-limited), Data Dragon, DB + migrations
apps/ingest       crawler + Data Dragon sync + CLI
apps/model        posteriors, scoring, position inference, evaluation   (phase 2–3)
apps/api          HTTP API (node:http, no framework) + serves apps/web/public
apps/web/public   static UI: draft simulator, player page, model evaluation page
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
npm run model:refresh     # materialise aggregates (daily)
npm run api               # http://localhost:8787
```

API: `GET /api/champions`, `POST /api/score {myPos, allies[], enemies[], bans[], band?, myPuuid?}`,
`POST /api/winprob {blue[], red[]}`, `GET /api/player/:puuid`, `GET /api/model/eval`, `GET /api/health`.

Requires Node ≥ 22 (uses `--experimental-strip-types`; no build step for scripts).

## Riot policy

Read-only use of the public API; no champ-select automation; no PII stored beyond `puuid`.
Draft Advisor is not endorsed by Riot Games and does not reflect the views or opinions of
Riot Games or anyone officially involved in producing or managing Riot Games properties.
