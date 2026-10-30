import { db } from "./db";
import type { Order, OrderStage } from "./lib/types";

/** An order made by staff has no stage and counts as approved. */
export const stageOf = (o: Order): OrderStage => o.stage ?? "approved";

const NEXT: Record<OrderStage, OrderStage[]> = {
  pending: ["approved", "rejected"],
  approved: ["cooking", "ready"],
  cooking: ["ready"],
  ready: ["delivered"],
  delivered: [],
  rejected: [],
};

/** Move an order forward one stage. The server checks again who is allowed to do it. */
export async function setStage(id: string, stage: OrderStage, reason = ""): Promise<boolean> {
  return db.transaction("rw", db.orders, async () => {
    const o = await db.orders.get(id);
    if (!o || !NEXT[stageOf(o)].includes(stage)) return false;
    await db.orders.update(id, {
      stage,
      ...(stage === "delivered" ? { done: true, deliveredAt: Date.now() } : {}),
      ...(stage === "rejected" ? { reason: reason.slice(0, 100) } : {}),
    });
    return true;
  });
}

/** Waiting for the restaurant desk to approve. */
export const pendingGuest = (orders: Order[]) => orders.filter((o) => o.src === "guest" && o.stage === "pending").sort((a, b) => a.at - b.at);
/** What the kitchen has to cook now: approved or being cooked, and not yet ready. */
export const kitchenQueue = (orders: Order[]) => orders.filter((o) => !o.billed && !o.paid && ["approved", "cooking"].includes(stageOf(o)) && !(o.stage === undefined && o.done)).sort((a, b) => a.at - b.at);
/** Cooked, waiting for room service to carry it. */
export const readyList = (orders: Order[]) => orders.filter((o) => o.stage === "ready").sort((a, b) => a.at - b.at);
