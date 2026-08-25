# Nasazení

Cíl podle [SPEC-04](specs/SPEC-04-aplikace-a-provoz.md): malý hostovaný provoz, rozpočet
řádově 5–10 USD/měsíc. Databáze zůstává na Supabase, na hostingu běží jen aplikace.

Repo obsahuje `Dockerfile` a `fly.toml` pro **Fly.io** (dvě role z jednoho image: `api` a `worker`).
Stejný image jde spustit kdekoli, kde běží Docker — Fly je jen doporučení, ne závazek.

## Co je potřeba předem

- Účet na Fly.io a `flyctl` (`iwr https://fly.io/install.ps1 -useb | iex`).
- **Production Riot key** (viz [`riot-production-key.md`](riot-production-key.md)). Na dev klíči
  hosting nemá smysl — expiruje po 24 h a musel by se ručně měnit.
- Supabase connection string (pooler) a heslo role `draft_ingest`.

## Postup

```bash
cd C:\Users\zaluz\Projekty\draft-advisor
fly launch --no-deploy          # jméno appky a region potvrdit podle fly.toml
fly secrets set RIOT_API_KEY=... DATABASE_URL=... DB_PASSWORD=...
fly deploy
fly logs
```

Ověření po nasazení:

```bash
curl https://<app>.fly.dev/api/health        # {"ok":true,...}
curl https://<app>.fly.dev/api/champions | head -c 200
```

## Jak je to poskládané

| Role | Příkaz | Co dělá |
|---|---|---|
| `api` | `apps/api/src/index.ts` | HTTP API + statický web; agregáty drží v paměti (proto 1 GB a `auto_stop_machines = false`) |
| `worker` | `cli.ts worker --batch 2000` | v cyklu: crawl dávky → `infer_match_bands()` → `refresh_aggregates()` → spárování logů; při prázdném crawlu 5min pauza |

Obě role reagují na `SIGTERM`: API dokončí rozpracované požadavky (limit 10 s), worker dokončí
běžící dávku. Deploy tedy nezahodí rozdělanou práci.

Health check `/api/health` vrací `ok` i před dokončením zahřátí agregátů — je to *liveness*, ne
*readiness*. Fly by jinak zabíjel instanci během načítání, které trvá desítky sekund.

## Náklady

Dva stroje `shared-cpu-1x` (1 GB + 512 MB) vycházejí zhruba na 5–8 USD/měsíc.

Supabase free tier má 500 MB. **Změřeno 24. 8. 2026: 21 640 zápasů = 216 MB**, tedy zhruba
10 kB na zápas — free tier pojme řádově **50 000 zápasů, což je jeden plně nacrawlovaný patch**.
Průběžně proto mazat starší patche:

```bash
node --experimental-strip-types apps/ingest/src/cli.ts prune              # zkušební běh
node --experimental-strip-types apps/ingest/src/cli.ts prune --yes        # ponechá 1 patch
```

`prune` maže po patchích (účastníci a bany jdou kaskádou) a na závěr dělá `vacuum full`, bez
kterého se místo souboru nevrátí. Alternativa je Supabase Pro (25 USD/měsíc, 8 GB).

## Před spuštěním pro veřejnost

Než se odkaz pošle dál, musí platit (SPEC-02):

- [ ] `/privacy.html` je dostupná a mazací formulář funguje proti produkční DB.
- [ ] V patičce je disclaimer Riot Games.
- [ ] Odeslaná žádost o production key odkazuje na tuto URL.
- [ ] Stránka **Model** ukazuje aktuální evaluaci — projekt tvrdí, že čísla platí, tak musí být vidět.
