import { useState, useCallback } from 'react'
import Head from 'next/head'
import { AppShell } from '../components/shell'
import { MemoSourcePanel, MemoEditor, MemoCitationsPanel } from '../components/memo'

export default function MemoPage() {
  const [memo, setMemo] = useState('')
  const [sourceData, setSourceData] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  const handleGenerate = useCallback(async (formData) => {
    setGenerating(true)
    setError(null)
    setSourceData(formData)

    try {
      const res = await fetch('/api/memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to generate memo')
      }

      const data = await res.json()
      setMemo(data.memo || '')
    } catch (err) {
      setError(err.message)
      console.error('Memo generation error:', err)
    } finally {
      setGenerating(false)
    }
  }, [])

  return (
    <>
      <Head>
        <title>Deal Memo — Signalera</title>
      </Head>
      <AppShell breadcrumb="Deal Memo Generator">
        <div className="flex h-full">
          {/* Left — Source input */}
          <div className="w-[300px] shrink-0 border-r border-border-subtle">
            <MemoSourcePanel
              onGenerate={handleGenerate}
              generating={generating}
            />
          </div>

          {/* Center — Memo editor */}
          <div className="flex-1 min-w-0 border-r border-border-subtle">
            <MemoEditor
              memo={memo}
              loading={generating}
              sourceData={sourceData}
            />
            {error && (
              <div className="px-6 pb-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-live/10 border border-live/20">
                  <span className="text-12 text-live">{error}</span>
                </div>
              </div>
            )}
          </div>

          {/* Right — Citations + copilot */}
          <div className="w-[280px] shrink-0">
            <MemoCitationsPanel
              sourceData={sourceData}
              hasMemo={!!memo}
            />
          </div>
        </div>
      </AppShell>
    </>
  )
}
