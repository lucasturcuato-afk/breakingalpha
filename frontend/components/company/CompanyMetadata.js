import clsx from 'clsx'
import Badge from '../primitives/Badge'
import Separator from '../primitives/Separator'

function MetaRow({ label, value, mono = false }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-12 text-content-muted">{label}</span>
      <span className={clsx('text-12 text-content-primary', mono && 'font-mono tabular-nums')}>
        {value}
      </span>
    </div>
  )
}

export default function CompanyMetadata({ name, mentionCount, sectors, firstSeen, lastSeen, dealTypes }) {
  return (
    <div className="px-6 py-4 max-w-[500px]">
      <h3 className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-3">
        Company Profile
      </h3>

      <div className="divide-y divide-border-subtle">
        <MetaRow label="Company Name" value={name} />
        <MetaRow label="Total Mentions" value={mentionCount} mono />
        <MetaRow label="First Seen" value={firstSeen} mono />
        <MetaRow label="Last Seen" value={lastSeen} mono />
      </div>

      {sectors && sectors.length > 0 && (
        <>
          <Separator className="my-4" />
          <h3 className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-3">
            Sectors
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {sectors.map(s => (
              <Badge key={s} variant="default" size="sm">{s}</Badge>
            ))}
          </div>
        </>
      )}

      {dealTypes && dealTypes.length > 0 && (
        <>
          <Separator className="my-4" />
          <h3 className="text-11 font-semibold text-content-muted uppercase tracking-wider mb-3">
            Deal Types
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {dealTypes.map(d => (
              <Badge key={d} variant="meta" size="sm">{d}</Badge>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
