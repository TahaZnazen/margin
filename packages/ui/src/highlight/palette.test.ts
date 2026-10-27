import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fillVisibility,
  minPairDistance,
  PAGE_MODES,
  SAMPLES,
  textContrast,
  underlineContrast,
  VISIONS,
} from "./analysis";
import { HIGHLIGHT_COLORS, HIGHLIGHT_PALETTE } from "./palette";
import { PALETTE_REQUIREMENTS as REQ, renderPaletteReport } from "./report";

const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
const reportPath = fileURLToPath(new URL("../../../../docs/design/palette.md", import.meta.url));

describe("highlight palette", () => {
  it("text under every highlight is >= 4.5:1 in every page mode", () => {
    for (const c of HIGHLIGHT_COLORS)
      for (const m of PAGE_MODES)
        expect(textContrast(c, m)).toBeGreaterThanOrEqual(REQ.textContrast);
  });

  it("underlines and fills are visible", () => {
    for (const c of HIGHLIGHT_COLORS)
      for (const m of PAGE_MODES) {
        expect(underlineContrast(c, m)).toBeGreaterThanOrEqual(REQ.underlineContrast);
        expect(fillVisibility(c, m)).toBeGreaterThanOrEqual(REQ.fillVisibility);
      }
  });

  it("the five colors stay distinguishable under protanopia, deuteranopia and tritanopia", () => {
    for (const sample of Object.values(SAMPLES))
      for (const v of VISIONS)
        expect(minPairDistance(sample, v).deltaE).toBeGreaterThanOrEqual(REQ.pairDistance);
  });

  it("tokens.css matches palette.ts", () => {
    for (const c of HIGHLIGHT_COLORS) {
      const s = HIGHLIGHT_PALETTE[c];
      for (const hex of [
        s.fillLight,
        s.underlineLight,
        s.chipLight,
        s.underlineDark,
        s.chipDark,
        s.fillDark,
      ])
        expect(tokens.toLowerCase()).toContain(hex.toLowerCase());
    }
  });

  it("docs/design/palette.md holds the current numbers", () => {
    const report = renderPaletteReport();
    if (process.env.UPDATE_PALETTE_DOC) writeFileSync(reportPath, report);
    expect(readFileSync(reportPath, "utf8")).toBe(report);
  });
});
