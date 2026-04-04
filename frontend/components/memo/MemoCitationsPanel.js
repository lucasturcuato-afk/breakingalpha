import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { BookOpen, ExternalLink, Sparkles, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import Badge from '../primitives/Badge'
import Separator from '../primitives/Separator'
import Skeleton from '../primitives/Skeleton'
import EmptyState from '../primitives/EmptyState'

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function MemoCitationsPanel({ sourceData, hasMemo }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(false)

  // Fetch related articles when source data changes
  useEffect(() => {
    if (!sourceData?.company) {
      setArticles([])
      return
    }

    async function fetchRelated() {
      setLoading(true)
      const companyName = sourceData.company.toLowerCase()

      const { data } = await supabase
        .from('articles')
        .select('id, title, source, sector, published_at, ingested_at, url, summary, sentiment')
        .order('ingested_at', { ascending: false })
        .limit(50)

      if (data) {
        // Filter for articles mentioning the company or sector
        const related = data.filter(a => {
          const text = `${a.title} ${a.summary || ''} ${a.sector || ''}`.toLowerCase()
          return text.includes(companyName) ||
            (sourceData.sector && text.includes(sourceData.sector.toLowerCase())) ||
            (sourceData.acquirer && text.includes(sourceData.acquirer.toLowerCase()))
        }).slice(0, 10)

        setArticles(related)
      }
      setLoading(false)
    }

    fetchRelated()
  }, [sourceData?.company, sourceData?.sector, sourceData?.acquirer])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-11 shrink-0 border-b border-border-subtle">
        <BookOpen size={14} className="text-content-muted" />
        <span className="text-12 font-semibold text-content-primary uppercase tracking-wider">
          Citations
        </span>
        {articles.length > 0 && (
          <span className="text-11 text-content-muted font-mono ml-auto">
            {articles.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Related articles */}
        {loading ? (
          <div className="p-3 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5 p-2">
                <Skeleton width="80%" height="13px" rounded="sm" />
                <Skeleton width="50%" height="11px" rounded="sm" />
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={sourceData?.company ? 'No related articles' : 'Enter source data'}
              description={sourceData?.company
                ? 'No articles found matching this company or sector.'
                : 'Fill in the source panel to see related articles and citations.'
              }
              className="py-8"
            />
          </div>
        ) : (
          <div className="p-2">
            <div className="px-2 py-1.5 mb-1">
              <span className="text-11 font-medium text-content-muted uppercase tracking-wider">
                Related Coverage
              </span>
            </div>
            {articles.map((article, i) => (
              <a
                key={article.id}
                href={article.url || '#'}
                target={article.url ? '_blank' : undefined}
                rel="noopener noreferrer"
                className={clsx(
                  'group flex flex-col gap-1 px-3 py-2.5 rounded-md',
                  'hover:bg-base-elevated sig-transition',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-11 font-mono text-content-muted">
                    {i + 1}
                  </span>
                  <span className="text-11 text-content-muted truncate">
                    {article.source}
                  </span>
                  <span className="text-11 text-content-muted font-mono ml-auto shrink-0">
                    {timeAgo(article.ingested_at)}
                  </span>
                  <ExternalLink
                    size={10}
                    className="text-content-muted opacity-0 group-hover:opacity-100 sig-transition shrink-0"
                  />
                </div>
                <span className="text-12 text-content-secondary leading-snug line-clamp-2 group-hover:text-content-primary sig-transition">
                  {article.title}
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Copilot context section */}
        {hasMemo && (
          <>
            <Separator className="mx-3" />
            <div className="p-3">
              <div className="flex items-center gap-2 px-2 py-1.5 mb-2">
                <Sparkles size={12} className="text-ai" />
                <span className="text-11 font-medium text-content-muted uppercase tracking-wider">
                  Copilot
                </span>
              </div>
              <div className="sig-data-ai rounded-md p-3">
                <p className="text-12 text-content-secondary leading-relaxed">
                  Memo generated from {sourceData?.company || 'source input'}.
                  Open the copilot rail to ask follow-up questions, request
                  revisions, or generate comparison analyses.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
