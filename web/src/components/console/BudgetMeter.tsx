export type Budget = {
  autoApproveMaxUsd: string;
  perTradeCapUsd: string;
  dailyBudgetUsd: string;
  remainingTodayUsd: string;
  vaultBalanceUsd: string;
  paused: boolean;
};

interface BudgetMeterProps {
  budget: Budget | null;
  lastBetUsd: number | null;
}

/** The leash itself: today's remaining budget as the hero number, and a per-trade ruler. */
export function BudgetMeter({ budget, lastBetUsd }: BudgetMeterProps) {
  const auto = Number(budget?.autoApproveMaxUsd ?? 2);
  const cap = Number(budget?.perTradeCapUsd ?? 10);
  const daily = Number(budget?.dailyBudgetUsd ?? 20);
  const remaining = Number(budget?.remainingTodayUsd ?? daily);
  const scaleMax = cap * 1.4;
  const pct = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;
  const spentShare = daily > 0 ? Math.min(1, (daily - remaining) / daily) : 0;

  return (
    <section aria-labelledby="budget-heading" className="flex flex-col gap-8">
      <div>
        <h2 id="budget-heading" className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">
          Left to spend today
        </h2>
        <p className="tabular mt-2 leading-none" style={{ fontSize: "var(--text-hero)" }}>
          <span className="text-ink-soft/50">$</span>
          {budget ? remaining.toFixed(2) : "--.--"}
        </p>
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-rule" aria-hidden>
          <div
            className="h-full origin-left bg-tension transition-transform"
            style={{ transform: `scaleX(${spentShare})`, transitionDuration: "var(--duration-normal)" }}
          />
        </div>
        <p className="tabular mt-2 text-sm text-ink-soft">
          of ${daily.toFixed(2)} daily budget · resets 00:00 UTC · vault holds $
          {budget ? Number(budget.vaultBalanceUsd).toFixed(2) : "--"}
        </p>
      </div>

      <figure aria-label="Per-trade rules" className="flex flex-col gap-3">
        <figcaption className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-soft">
          One bet, by size
        </figcaption>
        <div className="relative h-10">
          <div className="absolute inset-y-3 left-0 rounded-l-sm bg-auto/80" style={{ width: pct(auto) }} />
          <div
            className="absolute inset-y-3 bg-approval/80"
            style={{ left: pct(auto), width: `calc(${pct(cap)} - ${pct(auto)})` }}
          />
          <div
            className="absolute inset-y-3 right-0 rounded-r-sm"
            style={{
              left: pct(cap),
              background: "repeating-linear-gradient(135deg, var(--reject) 0 6px, transparent 6px 11px)",
              opacity: 0.55,
            }}
          />
          {lastBetUsd !== null && (
            <div
              className="absolute inset-y-0 w-0.5 bg-ink transition-[left]"
              style={{ left: pct(lastBetUsd), transitionDuration: "var(--duration-normal)" }}
              aria-label={`Last bet $${lastBetUsd.toFixed(2)}`}
            >
              <span className="tabular absolute -top-5 -translate-x-1/2 text-xs">${lastBetUsd.toFixed(2)}</span>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Rule color="bg-auto" term="Agent decides" value={`up to $${auto.toFixed(2)}`} />
          <Rule color="bg-approval" term="Needs your signature" value={`up to $${cap.toFixed(2)}`} />
          <Rule color="bg-reject" term="Contract refuses" value={`over $${cap.toFixed(2)}`} />
        </dl>
      </figure>
    </section>
  );
}

function Rule({ color, term, value }: { color: string; term: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-2 text-ink-soft">
        <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} aria-hidden />
        {term}
      </dt>
      <dd className="tabular font-medium">{value}</dd>
    </div>
  );
}
