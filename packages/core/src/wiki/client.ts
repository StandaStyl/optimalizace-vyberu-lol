/**
 * Champion attributes from the League of Legends wiki (SPEC-08).
 *
 * Sources, all public and machine-readable:
 *   - Module:ChampionData/data — one Lua table per champion with Riot's own champion-select
 *     ratings (damage/toughness/control/mobility/utility, 1–3), range type, adaptive damage
 *     type, Riot tags (herotype/alttype) and the wiki's subclass ("role").
 *   - Dash and Blink pages — every champion ability classified as a dash or a blink; the wiki
 *     is the only source that separates the two (Poppy's W stops dashes, not blinks).
 *
 * Nothing here says which attribute is *good* against what — that is measured from match
 * data. Attributes are grouping features, not rules (SPEC-04).
 */
export interface WikiChampion {
  /** Riot champion id; alias forms (Mega Gnar = 150.2) are folded onto the base champion. */
  id: number;
  name: string;
  apiname: string;
  herotype: string | null;
  alttype: string | null;
  rangetype: "Melee" | "Ranged" | null;
  role: string[];
  clientTags: string[];
  damage: number | null;
  toughness: number | null;
  control: number | null;
  mobility: number | null;
  utility: number | null;
  adaptivetype: string | null;
}

const WIKI = "https://wiki.leagueoflegends.com/en-us";
const UA = "draft-advisor-research/0.1 (diploma project; contact musil@mans.cz)";

function field(body: string, key: string): string | undefined {
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`\["` + k + String.raw`"\]\s*=\s*("([^"]*)"|-?[\d.]+|\{[^}]*\})`).exec(body)?.[1];
}
const num = (body: string, key: string): number | null => { const v = field(body, key); return v === undefined || v.startsWith('"') || v.startsWith("{") ? null : Number(v); };
const str = (body: string, key: string): string | null => { const v = field(body, key); return v?.startsWith('"') ? v.slice(1, -1) : null; };
const list = (body: string, key: string): string[] => { const v = field(body, key); return v?.startsWith("{") ? [...v.matchAll(/"([^"]*)"/g)].map((m) => m[1]!) : []; };

/** Parses the raw Lua of Module:ChampionData/data. Alias entries (fractional ids) are dropped. */
/**
 * Top-level entries, split on their starts: the closing "}," of an entry is not formatted
 * consistently on the wiki (trailing spaces, one-space indent), so the end of an entry is
 * the start of the next one.
 */
function entries(lua: string): Array<{ name: string; body: string }> {
  const starts = [...lua.matchAll(/^  \["([^"]+)"\] = \{$/gm)];
  return starts.map((m, i) => ({ name: m[1]!, body: lua.slice(m.index + m[0].length, i + 1 < starts.length ? starts[i + 1]!.index : lua.length) }));
}

export function parseChampionData(lua: string): WikiChampion[] {
  const out: WikiChampion[] = [];
  for (const { name, body } of entries(lua)) {
    const id = num(body, "id");
    if (id === null || !Number.isInteger(id)) continue;
    const rt = str(body!, "rangetype");
    out.push({
      id, name: name!, apiname: str(body!, "apiname") ?? name!,
      herotype: str(body!, "herotype"), alttype: str(body!, "alttype"),
      rangetype: rt === "Melee" || rt === "Ranged" ? rt : null,
      role: list(body!, "role"), clientTags: list(body!, "client_tags"),
      damage: num(body!, "damage"), toughness: num(body!, "toughness"), control: num(body!, "control"),
      mobility: num(body!, "mobility"), utility: num(body!, "utility"), adaptivetype: str(body!, "adaptivetype"),
    });
  }
  return out;
}

/**
 * Champion display names mentioned by ability templates ({{cai|Ability|Champion}}, {{ai|…}},
 * {{ais|…}}, {{ci|Champion}}, {{cis|Champion}}) inside the given wikitext sections.
 */
export function championsInSections(wikitext: string, sectionFilter: (title: string) => boolean): Set<string> {
  const parts = wikitext.split(/^==+ *(.*?) *==+$/m);
  const names = new Set<string>();
  for (let i = 1; i < parts.length; i += 2) {
    if (!sectionFilter(parts[i]!)) continue;
    for (const t of (parts[i + 1] ?? "").matchAll(/\{\{(cai|ais|ai|cis|ci)\|([^}|]*)(?:\|([^}|]*))?/g)) {
      const champ = t[1] === "ci" || t[1] === "cis" ? t[2] : t[3];
      if (champ) names.add(champ.trim());
    }
  }
  return names;
}

/** Dash page: the four targeting sections list every dash ability; interruption/lunge sections do not. */
export const isDashSection = (t: string) => /dashes$/i.test(t) && !/can't bypass/i.test(t);
/** Blink page: only the champion-ability subsection (summoner spells and items are not champions). */
export const isBlinkSection = (t: string) => /^Champion abilities$/i.test(t);

export interface ChampionAttributes {
  id: number;
  name: string;
  /** dim → value; every dim is a partition of champions. */
  attrs: Record<string, string>;
}

/**
 * Derives the attribute partitions used by the model. Names from the Dash/Blink pages are
 * resolved through the module (display name or alias name → base id), so "Mega Gnar" lands on Gnar.
 */
export function deriveAttributes(module: WikiChampion[], aliasToId: Map<string, number>, dashNames: Set<string>, blinkNames: Set<string>): ChampionAttributes[] {
  const resolve = (names: Set<string>) => {
    const ids = new Set<number>();
    for (const n of names) { const id = aliasToId.get(n); if (id !== undefined) ids.add(id); }
    return ids;
  };
  const dash = resolve(dashNames), blink = resolve(blinkNames);
  return module.map((c) => {
    const attrs: Record<string, string> = {};
    if (c.rangetype) attrs.range = c.rangetype.toLowerCase();
    attrs.mobility = dash.has(c.id) ? "dash" : blink.has(c.id) ? "blink" : "none";
    if (c.herotype) attrs.class = c.herotype.toLowerCase();
    if (c.role[0]) attrs.subclass = c.role[0].toLowerCase();
    if (c.toughness !== null) attrs.toughness = String(c.toughness);
    if (c.mobility !== null) attrs.mobility_rating = String(c.mobility);
    if (c.adaptivetype) attrs.dmgtype = c.adaptivetype.toLowerCase();
    return { id: c.id, name: c.name, attrs };
  });
}

/** Alias map incl. fractional-id forms: "Mega Gnar" → 150, "Kled & Skaarl" → 240. */
export function aliasMap(lua: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const { name, body } of entries(lua)) {
    const id = num(body, "id");
    if (id !== null) m.set(name, Math.floor(id));
  }
  return m;
}

async function raw(page: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(`${WIKI}/${encodeURIComponent(page)}?action=raw`, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`wiki ${page}: ${res.status}`);
  return res.text();
}

/** Downloads the three pages and derives attributes for every champion in the module. */
export async function fetchChampionAttributes(fetchImpl: typeof fetch = fetch): Promise<{ attributes: ChampionAttributes[]; dash: number; blink: number }> {
  const [lua, dashPage, blinkPage] = await Promise.all([raw("Module:ChampionData/data", fetchImpl), raw("Dash", fetchImpl), raw("Blink", fetchImpl)]);
  const module = parseChampionData(lua);
  const aliases = aliasMap(lua);
  const dashNames = championsInSections(dashPage, isDashSection);
  const blinkNames = championsInSections(blinkPage, isBlinkSection);
  const attributes = deriveAttributes(module, aliases, dashNames, blinkNames);
  return { attributes, dash: attributes.filter((a) => a.attrs.mobility === "dash").length, blink: attributes.filter((a) => a.attrs.mobility === "blink").length };
}
