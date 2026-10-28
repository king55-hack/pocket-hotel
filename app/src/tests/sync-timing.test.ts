import { describe, expect, it } from "vitest";
import { BASE_DELAY, MAX_DELAY, nextDelay } from "../sync";

describe("how often the app asks the server", () => {
  it("starts at 30 seconds and slows down while nothing changes, up to 2 minutes", () => {
    let d = BASE_DELAY;
    const seen: number[] = [];
    for (let i = 0; i < 8; i++) { d = nextDelay(d, false); seen.push(d); }
    expect(seen[0]).toBe(45_000);
    expect(Math.max(...seen)).toBe(MAX_DELAY);
    expect(seen.every((x, i) => i === 0 || x >= seen[i - 1])).toBe(true);
  });
  it("goes back to 30 seconds as soon as something changes", () => {
    expect(nextDelay(MAX_DELAY, true)).toBe(BASE_DELAY);
  });
  it("a quiet phone makes about 6 times fewer requests than the old 20-second rhythm over a working day", () => {
    const day = 10 * 3600_000;
    let t = 0, d = BASE_DELAY, n = 0;
    while (t < day) { t += d; n++; d = nextDelay(d, false); }
    expect(n).toBeLessThan(day / 20_000 / 5);
  });
});
