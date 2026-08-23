# SPEC-04 Aplikace a provoz

**Stav:** potvrzeno 2026-08-23

## Rozhodnutí
- Stack: TypeScript/Node monorepo, Postgres na Supabase, API na `node:http`, statický web (bez build kroku). Next.js/Tauri jen pokud vznikne konkrétní potřeba.
- **LCU: malý Node konektor** (čte lockfile + websocket `/lol-champ-select/v1/session`, posílá stav do API). UI zůstává ve webu. Žádná automatizace v klientu.
- **Hosting: malý VPS / Fly.io / Render** (API + crawler jako dlouho běžící proces), DB Supabase. Rozpočet ~5–10 USD/měsíc. Supabase Pro až při překročení free tieru.
- Web ve fázi A: draft simulátor (je), stránka modelu (je), **profil hráče podle Riot ID** (+ mazání), **stránka šampiona**, **šance celého draftu** (winprob), **doporučení banů**.
- Pořadí práce: **validace → web (profil, šampion, winprob, bany) → hosting → LCU**.

## Historie
- 2026-08-23 vytvořeno.
