# Riot Games production API key — application

Submit at <https://developer.riotgames.com/app-type> → **Register Product** (choose *Personal* unless the
product will be operated by an organisation). Fill the form with the texts below; Riot reviews in English.
Keep the demo URL reachable during review — reviewers open it.

## Form fields

**Product name**
Draft Advisor

**Product URL**
(public demo URL once hosted; until then the GitHub repository)
https://github.com/StandaStyl/optimalizace-vyberu-lol

**Product description (short)**
A champion-select decision-support tool for League of Legends ranked play that shows calibrated win
probabilities with uncertainty intervals, per-player personalisation and probabilistic inference of enemy
positions. Research project continuing a 2017 master's thesis (Palacký University Olomouc).

**Product description (long)**
Draft Advisor recommends champions during champion select. For the player's assigned position it ranks
eligible champions by an estimated win probability that combines (1) champion strength on the position,
(2) matchups against each known enemy champion, (3) synergies with already-locked allies and (4) the
player's own history on the champion. Every estimate is a Bayesian posterior, so the UI shows an 80 %
interval and groups statistically indistinguishable champions into one class instead of pretending a
52.3 % vs 52.1 % difference is meaningful. Enemy positions are not assumed; they are inferred from how
often each champion is played on each position, with the constraint that each position is filled once.

The project is academic: it continues the thesis *Decision model for assembling an optimal team in League
of Legends* (Musil, 2017) and tests four hypotheses (value of calibrated uncertainty, value of player-level
personalisation, tier dependence of synergy, accuracy of position inference). Model quality (log-loss,
Brier, AUC, calibration) is evaluated on held-out games and published on the site.

**How the Riot API is used**
- League-EXP-V4 / League-V4: sample ranked players per tier to seed the crawl and to determine a player's
  tier band.
- Match-V5: download ranked Solo/Duo matches (queue 420) on EUNE and EUW; we store match id, patch,
  duration, winner, and per participant: puuid, team, champion, position, result, items, runes and damage
  totals. No chat, no names, no timelines.
- Account-V1: resolve a Riot ID typed by the user into a puuid for the player profile page.
- Champion-Mastery-V4 (planned): mastery points as a feature of the player term.
- Data Dragon: static champion data and icons.

**Data volume and rate limits**
Target ~50 000 ranked matches per patch for two regions (EUNE, EUW). The crawler uses a token bucket honouring
the key's app-rate limits and Retry-After headers, retries 5xx with exponential backoff, and never runs more
than one worker per key. With the development key (100 requests / 2 min) a patch takes ~1.5 days; a
production key lets us finish within the first 48 h of a patch so recommendations reflect the live meta.

**What the product does NOT do**
- No automation of the League client: the optional local connector only *reads* the champion-select
  session through the LCU API and displays information in a browser; it never picks, bans or sends chat.
- No overlays that obscure the game, no in-game data, no spectator data.
- No selling of data, no redistribution of raw match data, no scraping of third-party sites.

**Player data and privacy**
- Stored identifier is the puuid; Riot IDs are stored only for players looked up explicitly on the site, in a
  separate table, and can be removed by the player via a "delete my data" button (the puuid is then
  replaced by an irreversible random token in all tables).
- Aggregated champion statistics are derived data and are not personal.
- Privacy notice and Riot disclaimer are shown at `/privacy.html` and in the footer.

**Disclaimer (shown on the site)**
Draft Advisor isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone
officially involved in producing or managing Riot Games properties. Riot Games, and all associated
properties are trademarks or registered trademarks of Riot Games, Inc.

## Checklist before submitting
- [ ] Demo reachable at a public URL (hosting step), showing the draft simulator and the model page.
- [ ] `/privacy.html` live with the delete-my-data form.
- [ ] 3–4 screenshots: draft simulator with recommendations and intervals, player page, model-evaluation page, (optional) LCU connector output.
- [ ] Contact e-mail that you read; Riot may ask follow-up questions.
- [ ] Accept the Riot Games API Terms of Service and Developer Policies.

## After approval
- Put the new key into `.env` (`RIOT_API_KEY`) and raise `RIOT_RATE_PER_SECOND` / `RIOT_RATE_PER_2MIN` to the
  limits shown on the key's page.
- Enable live player lookups (Account-V1 + Match-V5 history) in the profile page (SPEC-02).
