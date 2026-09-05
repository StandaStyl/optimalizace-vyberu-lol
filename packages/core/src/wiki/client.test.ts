import { describe, it, expect } from "vitest";
import { aliasMap, championsInSections, deriveAttributes, isBlinkSection, isDashSection, parseChampionData } from "./client.ts";

const LUA = `-- <pre>
return {
  ["Gnar"] = {
    ["id"]         = 150,
    ["apiname"]    = "Gnar",
    ["herotype"]   = "Fighter",
    ["alttype"]    = "Tank",
    ["stats"] = {
      ["range"]    = 175,
    },
    ["rangetype"]   = "Ranged",
    ["role"]        = {"Specialist"},
    ["client_tags"]        = {"Shapeshift", "Crowd Control", "Physical"},
    ["damage"]      = 2,
    ["toughness"]   = 3,
    ["control"]     = 2,
    ["mobility"]    = 2,
    ["utility"]     = 1,
    ["adaptivetype"]= "Physical",
    ["skills"] = {[1] = "Rage Gene",
        [2] = "Boomerang Throw"},
  },
  ["Mega Gnar"] = {
    ["id"]         = 150.2,
    ["apiname"]    = "GnarBig",
    ["rangetype"]   = "Melee",
  },
  ["Ezreal"] = {
    ["id"]         = 81,
    ["apiname"]    = "Ezreal",
    ["herotype"]   = "Marksman",
    ["rangetype"]   = "Ranged",
    ["role"]        = {"Marksman"},
    ["toughness"]   = 1,
    ["mobility"]    = 3,
    ["adaptivetype"]= "Physical",
  },
  ["Annie"] = {
    ["id"]         = 1,
    ["apiname"]    = "Annie",
    ["herotype"]   = "Mage",
    ["rangetype"]   = "Ranged",
    ["role"]        = {"Burst"},
    ["toughness"]   = 1,
    ["mobility"]    = 1,
    ["adaptivetype"]= "Magic",
  },
}
-- </pre>`;

const DASH = `Intro {{ci|Sejuani}} using {{ai|Arctic Assault|Sejuani}}.
== [[Auto-targeted]] dashes ==
* {{cai|Hop|Gnar}} and {{cis|Mega Gnar}} {{ai|Crunch|Mega Gnar}}
== Dashes that can't bypass terrain ==
* {{cai|Something|Annie}}
== Dash cancels ==
* {{cai|Steadfast Presence|Poppy}}
== Lunge ==
* {{cai|Decimate|Darius}}`;

const BLINK = `== Blinks ==
=== Champion abilities ===
* {{cai|Arcane Shift|Ezreal}}
=== Summoner Spells ===
* {{si|Flash}}`;

describe("wiki champion data (SPEC-08)", () => {
  it("parses the Lua module and drops alias forms", () => {
    const m = parseChampionData(LUA);
    expect(m.map((c) => c.name)).toEqual(["Gnar", "Ezreal", "Annie"]);
    const gnar = m[0]!;
    expect(gnar).toMatchObject({ id: 150, rangetype: "Ranged", herotype: "Fighter", toughness: 3, mobility: 2, adaptivetype: "Physical", role: ["Specialist"] });
    expect(gnar.clientTags).toEqual(["Shapeshift", "Crowd Control", "Physical"]);
  });

  it("folds alias names onto the base champion id", () => {
    const a = aliasMap(LUA);
    expect(a.get("Mega Gnar")).toBe(150);
    expect(a.get("Gnar")).toBe(150);
  });

  it("collects champions only from the ability sections that define the mechanic", () => {
    const dash = championsInSections(DASH, isDashSection);
    expect([...dash].sort()).toEqual(["Gnar", "Mega Gnar"]);   // not Poppy (cancels), not Darius (lunge), not Annie (sub-list of an excluded section)
    const blink = championsInSections(BLINK, isBlinkSection);
    expect([...blink]).toEqual(["Ezreal"]);
  });

  it("derives partitions: dash beats blink beats none, ratings become values", () => {
    const attrs = deriveAttributes(parseChampionData(LUA), aliasMap(LUA), championsInSections(DASH, isDashSection), championsInSections(BLINK, isBlinkSection));
    const by = Object.fromEntries(attrs.map((a) => [a.name, a.attrs]));
    expect(by.Gnar).toEqual({ range: "ranged", mobility: "dash", class: "fighter", subclass: "specialist", toughness: "3", mobility_rating: "2", dmgtype: "physical" });
    expect(by.Ezreal!.mobility).toBe("blink");
    expect(by.Annie!.mobility).toBe("none");
    expect(by.Annie!.dmgtype).toBe("magic");
  });
});
