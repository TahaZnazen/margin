import { expect, test } from "vitest";
import { uuidv5, uuidv7 } from "./uuid";

test("uuidv7 has version 7, variant 10 and sorts by time", () => {
  const a = uuidv7(1_700_000_000_000);
  const b = uuidv7(1_700_000_001_000);
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(a < b).toBe(true);
});

test("uuidv5 matches the RFC test vector and is deterministic", async () => {
  const dns = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  expect(await uuidv5("www.example.com", dns)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  expect(await uuidv5("a", dns)).toBe(await uuidv5("a", dns));
});
