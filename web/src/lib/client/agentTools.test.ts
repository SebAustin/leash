import { describe, expect, test } from "vitest";
import { createAgentTools, type Activity } from "./agentTools";

const approval = {
  vault: "0x0D2D3434c50B7df9D368504D9CdC664Da3D24E74" as const,
  chainId: 5042002,
  market: "GEMI-X-YES",
  outcomeYes: true,
  amount: "5000000",
  nonce: "0",
  deadline: "1794744600",
};

function setup(placeBetResult: unknown) {
  const posted: { path: string; body: unknown }[] = [];
  const activity: Activity[] = [];
  const signed: unknown[] = [];
  let shouldFail = false;
  const tools = createAgentTools({
    post: async (path, body) => {
      posted.push({ path, body });
      if (path === "/api/agent/place-bet") return placeBetResult;
      if (path === "/api/approvals") return { status: "placed", positionId: "9", txHash: "0xfeed", message: "Done" };
      return { ok: true };
    },
    signApproval: async (a) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("User rejected the request.");
      }
      signed.push(a);
      return "0xsig";
    },
    onActivity: (a) => activity.push(a),
    newId: () => "ap1",
  });
  return { tools, posted, activity, signed, failNextSign: () => (shouldFail = true) };
}

describe("placeBet", () => {
  test("keeps the approval request client-side and hands the agent only an id", async () => {
    const { tools, activity } = setup({ status: "needs_approval", message: "Need signature", approval });
    const out = JSON.parse(await tools.placeBet({ symbol: "GEMI-X-YES", side: "yes", amountUsd: "5" }));
    expect(out).toEqual({ status: "needs_approval", message: "Need signature", approvalId: "ap1" });
    expect(activity.at(-1)).toMatchObject({ kind: "needs_approval" });
  });
});

describe("requestOwnerApproval", () => {
  test("signs the stored request, not anything the agent sends", async () => {
    const { tools, posted, signed } = setup({ status: "needs_approval", message: "m", approval });
    await tools.placeBet({ symbol: "GEMI-X-YES", side: "yes", amountUsd: "5" });
    const out = JSON.parse(await tools.requestOwnerApproval({ approvalId: "ap1", amount: "999000000" }));
    expect(signed).toEqual([approval]);
    expect(posted.at(-1)).toEqual({
      path: "/api/approvals",
      body: { market: "GEMI-X-YES", outcomeYes: true, amount: "5000000", deadline: "1794744600", signature: "0xsig" },
    });
    expect(out).toMatchObject({ status: "placed", positionId: "9" });
  });

  test("unknown or reused ids are refused", async () => {
    const { tools } = setup({ status: "needs_approval", message: "m", approval });
    await expect(tools.requestOwnerApproval({ approvalId: "nope" })).rejects.toThrow(/no pending approval/i);
    await tools.placeBet({ symbol: "GEMI-X-YES", side: "yes", amountUsd: "5" });
    await tools.requestOwnerApproval({ approvalId: "ap1" });
    await expect(tools.requestOwnerApproval({ approvalId: "ap1" })).rejects.toThrow(/no pending approval/i);
  });

  test("a declined MetaMask prompt is reported, and the approval stays pending for a retry", async () => {
    const { tools, activity, failNextSign } = setup({ status: "needs_approval", message: "m", approval });
    await tools.placeBet({ symbol: "GEMI-X-YES", side: "yes", amountUsd: "5" });
    failNextSign();
    await expect(tools.requestOwnerApproval({ approvalId: "ap1" })).rejects.toThrow(/rejected/);
    expect(activity.at(-1)).toMatchObject({ kind: "error" });
    expect(JSON.parse(await tools.requestOwnerApproval({ approvalId: "ap1" })).status).toBe("placed");
  });
});
