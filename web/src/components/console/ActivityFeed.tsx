import type { Activity } from "@/lib/client/agentTools";

const EXPLORER = "https://explorer.testnet.arc.io/tx/";

const KIND_STYLE: Record<Activity["kind"], { label: string; rule: string }> = {
  placed: { label: "Placed", rule: "border-auto" },
  needs_approval: { label: "Awaiting signature", rule: "border-approval" },
  rejected: { label: "Refused", rule: "border-reject" },
  error: { label: "Error", rule: "border-reject" },
  info: { label: "Note", rule: "border-rule" },
};

/** Everything the agent did this session, newest first, with onchain proof where there is some. */
export function ActivityFeed({ items }: { items: Activity[] }) {
  return (
    <section aria-labelledby="activity-heading" className="flex min-h-0 flex-col gap-3">
      <h2 id="activity-heading" className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">
        Activity
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-ink-soft">Nothing yet. Ask Leash for a market.</p>
      ) : (
        <ol className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
          {items.map((a) => (
            <li key={a.id} className={`border-l-2 ${KIND_STYLE[a.kind].rule} bg-paper-raised/70 py-2 pl-3 pr-2`}>
              <div className="flex items-baseline justify-between gap-3 text-xs text-ink-soft">
                <span className="font-semibold uppercase tracking-wider">
                  {KIND_STYLE[a.kind].label}
                  {a.simulated ? " · simulated fill" : ""}
                </span>
                <time className="tabular" dateTime={new Date(a.at).toISOString()}>
                  {new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
              </div>
              <p className="mt-1 text-sm">{a.title}</p>
              {a.txHash?.startsWith("0x") && (
                <a
                  className="tabular mt-1 inline-block text-xs text-ink-soft underline decoration-rule underline-offset-2 hover:text-tension focus-visible:outline-2 focus-visible:outline-tension"
                  href={`${EXPLORER}${a.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.txHash.slice(0, 10)}…{a.txHash.slice(-6)} on Arc ↗
                </a>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
