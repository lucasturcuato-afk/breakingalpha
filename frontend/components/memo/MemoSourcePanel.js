import { useState } from 'react'
import clsx from 'clsx'
import { FileText, Send, Loader2 } from 'lucide-react'
import Input from '../primitives/Input'
import Separator from '../primitives/Separator'

const DEAL_TYPES = [
  'M&A', 'Acquisition', 'Merger', 'LBO', 'Growth Equity',
  'Recapitalization', 'Divestiture', 'SPAC', 'IPO', 'Secondary',
]

const SECTORS = [
  'Technology', 'Healthcare', 'Fintech', 'Energy', 'Consumer',
  'Real Estate', 'Industrials', 'Financial Services', 'Media',
]

export default function MemoSourcePanel({ onGenerate, generating }) {
  const [form, setForm] = useState({
    company: '',
    acquirer: '',
    deal_type: 'M&A',
    value: '',
    sector: 'Technology',
    description: '',
  })

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.company.trim()) return
    onGenerate(form)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border-subtle">
        <FileText size={14} className="text-content-muted" />
        <span className="text-12 font-semibold text-content-primary uppercase tracking-wider">
          Source Input
        </span>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-3">
        <Input
          label="Target / Company"
          placeholder="e.g. Figma"
          value={form.company}
          onChange={e => update('company', e.target.value)}
          required
        />

        <Input
          label="Acquirer"
          placeholder="e.g. Adobe"
          value={form.acquirer}
          onChange={e => update('acquirer', e.target.value)}
        />

        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-12 font-medium text-content-secondary">
              Deal Type
            </label>
            <select
              value={form.deal_type}
              onChange={e => update('deal_type', e.target.value)}
              className="h-8 px-3 rounded-md text-13 bg-base-elevated text-content-primary border border-border hover:border-border-strong sig-transition outline-none"
            >
              {DEAL_TYPES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <Input
              label="Deal Value"
              placeholder="e.g. $20B"
              value={form.value}
              onChange={e => update('value', e.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-12 font-medium text-content-secondary">
            Sector
          </label>
          <select
            value={form.sector}
            onChange={e => update('sector', e.target.value)}
            className="h-8 px-3 rounded-md text-13 bg-base-elevated text-content-primary border border-border hover:border-border-strong sig-transition outline-none"
          >
            {SECTORS.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-12 font-medium text-content-secondary">
            Additional Context
          </label>
          <textarea
            value={form.description}
            onChange={e => update('description', e.target.value)}
            placeholder="Paste article text, deal rationale, or any additional context..."
            rows={5}
            className={clsx(
              'px-3 py-2 rounded-md text-13',
              'bg-base-elevated text-content-primary',
              'border border-border hover:border-border-strong',
              'placeholder:text-content-muted',
              'focus:outline-none focus:ring-2 focus:ring-signal-500/40 focus:ring-offset-1 focus:ring-offset-base',
              'sig-transition resize-none',
            )}
          />
        </div>

        <Separator className="my-2" />

        <button
          type="submit"
          disabled={!form.company.trim() || generating}
          className={clsx(
            'flex items-center justify-center gap-2 w-full h-9 rounded-md text-13 font-semibold',
            'bg-signal-500 text-base',
            'hover:bg-signal-400',
            'disabled:opacity-40 disabled:pointer-events-none',
            'sig-transition',
          )}
        >
          {generating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Generating Memo...
            </>
          ) : (
            <>
              <Send size={14} />
              Generate Deal Memo
            </>
          )}
        </button>
      </form>
    </div>
  )
}
