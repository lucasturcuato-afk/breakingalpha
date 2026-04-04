import { SkeletonRow } from '../primitives/Skeleton'
import EmptyState from '../primitives/EmptyState'
import SignalCard from './SignalCard'

export default function SignalsList({ signals, loading }) {
  if (loading) {
    return (
      <div className="p-4 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (!signals || signals.length === 0) {
    return (
      <EmptyState
        title="No signals detected"
        description="Signals are generated from article sentiment, volume spikes, and thesis activity. Check back as new data flows in."
      />
    )
  }

  return (
    <div className="divide-y divide-border-subtle">
      {signals.map(signal => (
        <SignalCard key={signal.id} signal={signal} />
      ))}
    </div>
  )
}
