import { it, expect } from "vitest";
import { patchOf } from "./client.ts";

it("patchOf extracts major.minor", () => {
  expect(patchOf("16.16.1")).toBe("16.16");
  expect(patchOf("16.16.707.1234")).toBe("16.16");
});
