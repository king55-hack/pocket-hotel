import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, ensureHotel } from "../db";
import { kitchenQueue, pendingGuest, readyList, setStage, stageOf } from "../guestOrders";
import { guestLink } from "../guestOrderCard";
import type { Order } from "../lib/types";

vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));

const order = (id: string, over: Partial<Order> = {}): Order => ({ id, to: "Rb1", items: [{ name: "Momo", qty: 1, price: 250 }], done: false, billed: false, at: Date.now(), ...over });

beforeEach(async () => {
  await Promise.all([db.orders.clear(), db.hotel.clear()]);
  await ensureHotel();
});

describe("guest order stages", () => {
  it("an order made by staff counts as approved", () => {
    expect(stageOf(order("a"))).toBe("approved");
    expect(stageOf(order("b", { stage: "cooking" }))).toBe("cooking");
  });

  it("moves forward one step at a time and never back", async () => {
    await db.orders.add(order("g1", { src: "guest", stage: "pending" }));
    expect(await setStage("g1", "ready")).toBe(false); // cannot skip approval and cooking
    expect(await setStage("g1", "approved")).toBe(true);
    expect(await setStage("g1", "pending")).toBe(false);
    expect(await setStage("g1", "cooking")).toBe(true);
    expect(await setStage("g1", "ready")).toBe(true);
    expect(await setStage("g1", "delivered")).toBe(true);
    const o = (await db.orders.get("g1"))!;
    expect(o).toMatchObject({ stage: "delivered", done: true });
    expect(o.deliveredAt).toBeGreaterThan(0);
    expect(await setStage("g1", "ready")).toBe(false);
  });

  it("a refused order keeps the reason and cannot be revived", async () => {
    await db.orders.add(order("g2", { src: "guest", stage: "pending" }));
    expect(await setStage("g2", "rejected", "Sold out")).toBe(true);
    expect((await db.orders.get("g2"))!.reason).toBe("Sold out");
    expect(await setStage("g2", "approved")).toBe(false);
  });

  it("each person sees only their own list", () => {
    const all = [
      order("p", { src: "guest", stage: "pending", at: 2 }),
      order("p0", { src: "guest", stage: "pending", at: 1 }),
      order("a", { src: "guest", stage: "approved" }),
      order("c", { src: "guest", stage: "cooking" }),
      order("r", { src: "guest", stage: "ready" }),
      order("d", { src: "guest", stage: "delivered", done: true }),
      order("x", { src: "guest", stage: "rejected" }),
      order("own"), // a desk order with no stage: the kitchen cooks it too
      order("own-done", { done: true }),
      order("billed", { stage: "approved", billed: true }),
    ];
    expect(pendingGuest(all).map((o) => o.id)).toEqual(["p0", "p"]);
    expect(kitchenQueue(all).map((o) => o.id).sort()).toEqual(["a", "c", "own"]);
    expect(readyList(all).map((o) => o.id)).toEqual(["r"]);
  });
});

describe("the QR link", () => {
  it("keeps the key after # so it is never sent to a server by the browser itself, and escapes odd room names", () => {
    const l = guestLink("https://x.dev", "ABC234", "A 1/2", "k".repeat(20));
    expect(l).toBe("https://x.dev/guest.html#/ABC234/A%201%2F2/kkkkkkkkkkkkkkkkkkkk");
    expect(new URL(l).search).toBe("");
  });
});
