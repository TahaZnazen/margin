import { describe, expect, it } from "vitest";
import {
  emptyHistory,
  farFromLanding,
  goBack,
  goForward,
  MAX_HISTORY,
  pushJump,
} from "./nav-history";

const at = (page: number, offsetPt = 0) => ({ page, offsetPt });

describe("nav history", () => {
  it("goes back to the place a link was followed from, and forward again", () => {
    const h1 = pushJump(emptyHistory, at(2, 100));
    const back = goBack(h1, at(11, 30));
    expect(back?.target).toEqual(at(2, 100));
    expect(back?.history.back).toEqual([]);
    const fwd = goForward(back?.history ?? emptyHistory, at(2, 100));
    expect(fwd?.target).toEqual(at(11, 30));
    expect(fwd?.history.back).toEqual([at(2, 100)]);
  });

  it("returns null when there is nothing to go back or forward to", () => {
    expect(goBack(emptyHistory, at(0))).toBeNull();
    expect(goForward(emptyHistory, at(0))).toBeNull();
  });

  it("keeps a stack: several jumps unwind in reverse order", () => {
    let h = pushJump(emptyHistory, at(1));
    h = pushJump(h, at(5));
    const first = goBack(h, at(9));
    expect(first?.target).toEqual(at(5));
    const second = goBack(first?.history ?? emptyHistory, at(5));
    expect(second?.target).toEqual(at(1));
  });

  it("a new jump clears the forward stack and the stack is capped", () => {
    const back = goBack(pushJump(emptyHistory, at(1)), at(4));
    expect(back?.history.forward).toHaveLength(1);
    expect(pushJump(back?.history ?? emptyHistory, at(7)).forward).toEqual([]);
    let h = emptyHistory;
    for (let i = 0; i < MAX_HISTORY + 10; i++) h = pushJump(h, at(i));
    expect(h.back).toHaveLength(MAX_HISTORY);
    expect(h.back.at(-1)).toEqual(at(MAX_HISTORY + 9));
  });

  it("decides when the pill is stale", () => {
    expect(farFromLanding(10, 11)).toBe(false);
    expect(farFromLanding(10, 13)).toBe(true);
    expect(farFromLanding(10, 7)).toBe(true);
  });
});
