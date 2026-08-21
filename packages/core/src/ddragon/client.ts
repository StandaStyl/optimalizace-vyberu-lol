/** Data Dragon: static champion data per patch. No API key needed. */
export interface DDragonChampion {
  id: number;
  key: string;
  name: string;
  tags: string[];
  version: string;
}

const BASE = "https://ddragon.leagueoflegends.com";

export async function latestVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${BASE}/api/versions.json`);
  if (!res.ok) throw new Error(`ddragon versions ${res.status}`);
  const versions = (await res.json()) as string[];
  const v = versions[0];
  if (!v) throw new Error("no ddragon versions");
  return v;
}

export async function champions(version: string, fetchImpl: typeof fetch = fetch): Promise<DDragonChampion[]> {
  const res = await fetchImpl(`${BASE}/cdn/${version}/data/en_US/champion.json`);
  if (!res.ok) throw new Error(`ddragon champion.json ${res.status}`);
  const json = (await res.json()) as {
    data: Record<string, { key: string; id: string; name: string; tags: string[] }>;
  };
  return Object.values(json.data).map((c) => ({
    id: Number(c.key),
    key: c.id,
    name: c.name,
    tags: c.tags,
    version,
  }));
}

export function championIconUrl(version: string, key: string): string {
  return `${BASE}/cdn/${version}/img/champion/${key}.png`;
}

/** "16.16.1" -> "16.16"; Riot gameVersion "16.16.707.1234" -> "16.16". */
export function patchOf(version: string): string {
  const [a, b] = version.split(".");
  return `${a}.${b}`;
}
