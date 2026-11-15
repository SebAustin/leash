"use client";

import { useCallback, useEffect, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import type { Address } from "viem";
import { createAgentTools, type Activity } from "@/lib/client/agentTools";
import { setVaultPaused, signOwnerApproval } from "@/lib/client/ownerWallet";
import { ActivityFeed } from "./ActivityFeed";
import { BudgetMeter, type Budget } from "./BudgetMeter";
import { VoicePanel, type TranscriptLine } from "./VoicePanel";

const BUDGET_POLL_MS = 15_000;
const EXPLORER = "https://explorer.testnet.arc.io/address/";

type Props = { vaultAddress: Address };

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => ({ status: "error", message: `HTTP ${res.status}` }));
}

function newId(): string {
  return crypto.randomUUID();
}

/** Container: owns budget polling, activity, transcript, and the agent's client tools. */
export function LeashConsole({ vaultAddress }: Props) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [lastBetUsd, setLastBetUsd] = useState<number | null>(null);
  const [isPausing, setIsPausing] = useState(false);

  const refreshBudget = useCallback(async () => {
    const res = (await postJson("/api/agent/get-budget", {})) as Budget & { status?: string };
    if (res.status !== "error" && "remainingTodayUsd" in res) setBudget(res);
  }, []);

  const pushActivity = useCallback(
    (a: Activity) => {
      setActivity((prev) => [a, ...prev].slice(0, 50));
      void refreshBudget();
    },
    [refreshBudget],
  );

  // Created once: handlers are stable and only call stable setters.
  const [clientTools] = useState(() =>
    createAgentTools({
      post: (path, body) => {
        if (path === "/api/agent/place-bet") {
          const amount = Number((body as { amountUsd?: unknown }).amountUsd);
          if (Number.isFinite(amount)) setLastBetUsd(amount);
        }
        return postJson(path, body);
      },
      signApproval: signOwnerApproval,
      onActivity: pushActivity,
      newId,
    }),
  );

  useEffect(() => {
    // Poll the vault (an external system); the first read runs right after mount.
    const first = setTimeout(() => void refreshBudget(), 0);
    const id = setInterval(() => void refreshBudget(), BUDGET_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [refreshBudget]);

  const handleMessage = useCallback((m: { message: string; role?: string; source?: string }) => {
    const speaker: TranscriptLine["speaker"] = (m.role ?? m.source) === "user" ? "you" : "leash";
    setTranscript((prev) => [...prev, { id: newId(), speaker, text: m.message }].slice(-30));
  }, []);

  const handleError = useCallback(
    (message: string) => pushActivity({ id: newId(), at: Date.now(), kind: "error", title: message }),
    [pushActivity],
  );

  async function handleTogglePause() {
    if (!budget) return;
    setIsPausing(true);
    try {
      const hash = await setVaultPaused(vaultAddress, !budget.paused);
      pushActivity({
        id: newId(),
        at: Date.now(),
        kind: "info",
        title: budget.paused ? "Vault unpaused by owner" : "Vault paused by owner: agent spending blocked",
        txHash: hash,
      });
    } catch (err) {
      handleError(err instanceof Error ? err.message : "Pause failed");
    } finally {
      setIsPausing(false);
    }
  }

  const isPaused = budget?.paused ?? false;

  return (
    <ConversationProvider
      clientTools={clientTools}
      onMessage={handleMessage}
      onError={(message: string) => handleError(`Voice error: ${message}`)}
    >
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-4 py-6 sm:px-8 lg:py-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-5">
          <div className="flex items-baseline gap-4">
            <h1 className="text-3xl font-semibold tracking-tight">Leash</h1>
            <a
              href={`${EXPLORER}${vaultAddress}`}
              target="_blank"
              rel="noreferrer"
              className="tabular text-xs text-ink-soft underline decoration-rule underline-offset-2 hover:text-tension"
            >
              vault {vaultAddress.slice(0, 6)}…{vaultAddress.slice(-4)} on Arc ↗
            </a>
          </div>
          <button
            type="button"
            onClick={handleTogglePause}
            disabled={!budget || isPausing}
            className={`rounded-full border-2 px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tension ${
              isPaused
                ? "border-auto bg-auto text-paper hover:bg-auto/90"
                : "border-reject text-reject hover:bg-reject hover:text-paper"
            }`}
          >
            {isPausing ? "Waiting for MetaMask…" : isPaused ? "Unpause vault" : "Pause agent"}
          </button>
        </header>

        {isPaused && (
          <p role="status" className="border-l-4 border-reject bg-reject/10 px-4 py-3 text-sm">
            The vault is paused. The contract blocks every agent spend until you unpause it.
          </p>
        )}

        <main className="grid flex-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <VoicePanel transcript={transcript} onError={handleError} />
          <div className="flex flex-col gap-10">
            <BudgetMeter budget={budget} lastBetUsd={lastBetUsd} />
            <ActivityFeed items={activity} />
          </div>
        </main>

        <footer className="text-xs text-ink-soft">
          Testnet demo. Limits are enforced by the LeashVault contract, not by the AI.
        </footer>
      </div>
    </ConversationProvider>
  );
}
