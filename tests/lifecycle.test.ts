import { describe, expect, it } from "vitest";
import { resolveStatusTransition } from "../src/services/lifecycle.js";

describe("resolveStatusTransition", () => {
  it("advances to a higher-ranked status", () => {
    expect(resolveStatusTransition("delivered", "clicked")).toMatchObject({
      nextStatus: "clicked",
      changed: true,
    });
  });

  it("stores a late lower-ranked event without downgrading", () => {
    expect(resolveStatusTransition("clicked", "delivered")).toMatchObject({
      nextStatus: "clicked",
      changed: false,
    });
  });

  it("does not let a late failure override delivery or engagement", () => {
    expect(resolveStatusTransition("read", "failed")).toMatchObject({
      nextStatus: "read",
      changed: false,
    });
  });

  it("does not let a late sent event resurrect a failed communication", () => {
    expect(resolveStatusTransition("failed", "sent")).toMatchObject({
      nextStatus: "failed",
      changed: false,
    });
  });

  it("allows a delivery event to recover a contradictory earlier failure", () => {
    expect(resolveStatusTransition("failed", "delivered")).toMatchObject({
      nextStatus: "delivered",
      changed: true,
    });
  });

  it("treats converted as final", () => {
    expect(resolveStatusTransition("converted", "clicked")).toMatchObject({
      nextStatus: "converted",
      changed: false,
    });
  });
});
