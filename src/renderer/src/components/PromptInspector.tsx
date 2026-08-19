import { useStore } from '../store'

function Bar({ used, allocated }: { used: number; allocated: number }): React.JSX.Element {
  const pct = allocated > 0 ? Math.min(100, Math.round((used / allocated) * 100)) : 0
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-white/10">
      <div
        className={pct > 90 ? 'h-full bg-shell-warn' : 'h-full bg-shell-accent'}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

export default function PromptInspector(): React.JSX.Element {
  const report = useStore((s) => s.report)
  const toggleInspector = useStore((s) => s.toggleInspector)

  return (
    <aside
      aria-label="Prompt Inspector"
      className="flex w-80 shrink-0 flex-col border-l border-shell-line bg-shell-panel"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-shell-line px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-shell-muted">
          Prompt Inspector
        </h2>
        <button
          type="button"
          onClick={toggleInspector}
          aria-label="Close inspector"
          className="text-shell-muted hover:text-shell-text"
        >
          ✕
        </button>
      </header>

      {!report ? (
        <p className="px-3 py-6 text-center text-xs text-shell-muted">
          Send a message to see how its prompt was assembled.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-xs">
          <section className="mb-4">
            <div className="flex items-baseline justify-between">
              <span className="text-shell-muted">total</span>
              <span className="font-mono">
                {report.total} / {report.budget.usable}
              </span>
            </div>
            <Bar used={report.total} allocated={report.budget.usable} />
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-shell-muted">
              <dt>model limit</dt>
              <dd className="text-right font-mono">{report.budget.modelLimit}</dd>
              <dt>reserved output</dt>
              <dd className="text-right font-mono">{report.budget.reservedOutput}</dd>
              <dt>safety margin</dt>
              <dd className="text-right font-mono">{report.budget.safetyMargin}</dd>
              <dt>overhead</dt>
              <dd className="text-right font-mono">{report.overhead}</dd>
              <dt>headroom</dt>
              <dd className="text-right font-mono">{report.headroom}</dd>
              <dt>counter</dt>
              <dd className="truncate text-right font-mono">{report.counterId}</dd>
            </dl>
          </section>

          <section className="mb-4">
            <h3 className="mb-1.5 font-semibold uppercase tracking-wider text-shell-muted">
              Tiers
            </h3>
            <ul className="flex flex-col gap-2">
              {report.tiers.map((tier) => (
                <li key={tier.tier}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate">
                      T{tier.tier} · {tier.name}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-shell-muted">
                      {tier.used}/{tier.allocated}
                    </span>
                  </div>
                  <Bar used={tier.used} allocated={tier.allocated} />
                  <div className="mt-0.5 text-[10px] text-shell-muted">
                    cap {tier.cap}
                    {tier.cascadedIn > 0 && ` · +${tier.cascadedIn} cascaded in`}
                    {tier.cascadedOut > 0 && ` · ${tier.cascadedOut} passed down`}
                    {` · ${tier.includedIds.length} in`}
                    {tier.excludedIds.length > 0 && ` · ${tier.excludedIds.length} out`}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {report.ladder.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 font-semibold uppercase tracking-wider text-shell-muted">
                Degradation ladder
              </h3>
              <ol className="flex flex-col gap-1">
                {report.ladder.map((event, index) => (
                  <li key={index} className="rounded bg-white/5 px-2 py-1 text-[11px]">
                    <span className="font-mono text-shell-accent">step {event.step}</span> · T
                    {event.tier} — {event.action}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {report.excluded.length > 0 && (
            <section>
              <h3 className="mb-1.5 font-semibold uppercase tracking-wider text-shell-muted">
                Excluded ({report.excluded.length})
              </h3>
              <ul className="flex flex-col gap-1">
                {report.excluded.map((item) => (
                  <li key={item.id} className="rounded bg-white/5 px-2 py-1 text-[11px]">
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{item.kind}</span>
                      <span className="shrink-0 font-mono text-shell-warn">
                        {item.reason.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-0.5 text-shell-muted">{item.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  )
}
