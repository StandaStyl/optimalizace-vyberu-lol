-- 0014: kalibrační vrstva modelu (SPEC-09).
--
-- logit P(blue) = side_logit + S + term_scale · D, kde S je baseline sil a D součet všech
-- odchylkových členů (countery, synergie, forma hráče, atributový prior). Dva skaláry fitované
-- maximální věrohodností na holdout hrách (model:calibrate), uložené per patch; API a CLI berou
-- poslední řádek pro daný patch, pokud sedí priory (prior_n_matchup / prior_n_synergy), jinak
-- běží nekalibrovaně (term_scale 1). logloss_cv je křížově validovaný (fit na jedné polovině
-- testovacího období, skóre na druhé) — to je číslo, které se cituje.

create table if not exists model_calibration (
  id               bigserial primary key,
  patch            text not null references patch(patch),
  tier_band        tier_band_t,
  term_scale       double precision not null,
  side_logit       double precision not null,
  attr_weight      double precision not null,
  prior_n_matchup  int not null,
  prior_n_synergy  int not null,
  n_fit            int not null,
  train_games      int not null,
  logloss_strength double precision not null,
  logloss_raw      double precision not null,
  logloss_cv       double precision not null,
  ece_cv           double precision not null,
  params           jsonb not null,
  fitted_at        timestamptz not null default now()
);
create index if not exists model_calibration_patch_idx on model_calibration (patch, fitted_at desc);
