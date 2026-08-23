import { it, expect } from "vitest";
import { parseRiotId } from "./profile.ts";
it("parses Riot IDs", () => {
  expect(parseRiotId("Imaqtpie#NA1")).toEqual({ gameName: "Imaqtpie", tagLine: "NA1" });
  expect(parseRiotId("  Jan Musil # eune ")).toEqual({ gameName: "Jan Musil", tagLine: "EUNE" });
  expect(parseRiotId("Name-EUW")).toEqual({ gameName: "Name", tagLine: "EUW" });
  expect(parseRiotId("nohash")).toBeNull();
});
