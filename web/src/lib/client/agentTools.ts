import type { ApprovalRequestJson } from "./ownerWallet";

export type ActivityKind = "placed" | "needs_approval" | "rejected" | "error" | "info";

export type Activity = {
  id: string;
  at: number;
  kind: ActivityKind;
  title: string;
  detail?: string;
  txHash?: string;
  simulated?: boolean;
};

type Json = Record<string, unknown>;

export type AgentToolDeps = {
  post(path: string, body: unknown): Promise<unknown>;
  signApproval(a: ApprovalRequestJson): Promise<string>;
  onActivity(a: Activity): void;
  newId(): string;
};

/**
 * Client tools the ElevenLabs agent calls in the browser. Results go back to the LLM
 * as JSON strings. Approval requests stay here: the agent only ever sees an approvalId,
 * so it cannot change the amount the owner is asked to sign.
 */
export function createAgentTools(deps: AgentToolDeps) {
  const pending = new Map<string, ApprovalRequestJson>();

  function log(kind: ActivityKind, title: string, extra: Partial<Activity> = {}) {
    deps.onActivity({ id: deps.newId(), at: Date.now(), kind, title, ...extra });
  }

  function recordOutcome(res: Json) {
    const message = String(res.message ?? "");
    if (res.status === "placed") {
      const order = res.order as Json | undefined;
      log("placed", message, { txHash: String(res.txHash ?? ""), simulated: Boolean(order?.simulated) });
    } else if (res.status === "rejected") {
      log("rejected", message, { detail: String(res.reason ?? "") });
    } else if (res.status === "error") {
      log("error", message);
    }
  }

  return {
    async listMarkets(params: Json) {
      return JSON.stringify(await deps.post("/api/agent/list-markets", { ...params, limit: 6 }));
    },

    async getBudget() {
      return JSON.stringify(await deps.post("/api/agent/get-budget", {}));
    },

    async placeBet(params: Json) {
      const res = (await deps.post("/api/agent/place-bet", params)) as Json;
      if (res.status === "needs_approval" && res.approval) {
        const approvalId = deps.newId();
        pending.set(approvalId, res.approval as ApprovalRequestJson);
        log("needs_approval", String(res.message ?? "Owner approval needed"));
        return JSON.stringify({ status: res.status, message: res.message, approvalId });
      }
      recordOutcome(res);
      return JSON.stringify(res);
    },

    async requestOwnerApproval(params: Json) {
      const id = String(params.approvalId ?? "");
      const request = pending.get(id);
      if (!request) throw new Error("No pending approval with that id. Place the bet again.");
      let signature: string;
      try {
        signature = await deps.signApproval(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Signature failed";
        log("error", `Approval not signed: ${message}`);
        throw new Error(`The owner did not sign: ${message}`);
      }
      pending.delete(id);
      const res = (await deps.post("/api/approvals", {
        market: request.market,
        outcomeYes: request.outcomeYes,
        amount: request.amount,
        deadline: request.deadline,
        signature,
      })) as Json;
      recordOutcome(res);
      return JSON.stringify(res);
    },
  };
}
