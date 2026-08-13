import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { cards } from '../api/endpoints'
import type { HandoverCardResponse, HandoverCardStatus, SummaryEntryDto } from '../api/types'
import { StatusBadge, useStatusLabel } from '../components/StatusBadge'
import { useHandoverCard } from '../hooks/useHandoverCard'
import { useLanguage } from '../i18n/LanguageContext'
import { type Messages } from '../i18n/messages'
import { formatDateTime } from '../lib/format'
import { languageLabel } from '../lib/languages'
import { summaryTextFor } from '../lib/summary'

/**
 * 진행 표시줄에 쓰는 파이프라인 순서와 칸 이름.
 * 상태 이름을 그대로 쓰면 TRANSCRIBED 처럼 "무엇이 끝났다" 는 값이 섞여 읽기 어렵다.
 * 사용자가 기다리는 단위(인식 → 번역 → 요약)로 이름을 붙인다.
 */
const PIPELINE: { status: HandoverCardStatus; label: (t: Messages) => string }[] = [
  { status: 'RECEIVED', label: (t) => t.detail.stepReceived },
  { status: 'TRANSCRIBING', label: (t) => t.detail.stepTranscribing },
  { status: 'TRANSCRIBED', label: (t) => t.detail.stepTranslating },
  { status: 'SUMMARIZING', label: (t) => t.detail.stepSummarizing },
  { status: 'COMPLETED', label: (t) => t.detail.stepDone },
]

export function CardDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const numericId = id && /^\d+$/.test(id) ? Number(id) : null
  const { card, loading, error, refresh } = useHandoverCard(numericId)
  const { t } = useLanguage()
  const statusLabel = useStatusLabel()

  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading && !card) {
    return (
      <div className="center-screen" style={{ minHeight: 320 }}>
        <span className="spinner" />
      </div>
    )
  }

  if (error && !card) {
    return (
      <div className="panel">
        <div className="alert alert--error" role="alert">
          {error}
        </div>
        <Link to="/" className="btn" style={{ marginTop: 16 }}>
          {t.common.backToList}
        </Link>
      </div>
    )
  }

  if (!card) return null

  async function handleReprocess() {
    if (!card) return
    setBusy(true)
    setActionError(null)
    try {
      await cards.reprocess(card.id)
      await refresh()
    } catch (caught) {
      // 재처리도 소유자만 가능하며, 권한이 없으면 404 로 온다.
      setActionError(
        caught instanceof ApiError && caught.status === 404
          ? t.detail.reprocessDenied
          : caught instanceof ApiError
            ? caught.message
            : t.detail.reprocessFailed,
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!card) return
    if (!window.confirm(t.detail.confirmDelete)) return
    setBusy(true)
    setActionError(null)
    try {
      await cards.remove(card.id)
      navigate('/', { replace: true })
    } catch (caught) {
      // 소유자가 아니면 서버가 카드 존재 여부를 숨기려고 403 대신 404 를 준다.
      // "찾을 수 없음" 이라고 그대로 보여주면 사용자가 오해하므로 상황을 설명한다.
      setActionError(
        caught instanceof ApiError && caught.status === 404
          ? t.detail.deleteDenied
          : caught instanceof ApiError
            ? caught.message
            : t.detail.deleteFailed,
      )
      setBusy(false)
    }
  }

  const isProcessing = card.status !== 'COMPLETED' && card.status !== 'FAILED'
  const currentStep = PIPELINE.findIndex((step) => step.status === card.status)

  return (
    <>
      <div className="page-head">
        <Link to="/" className="btn btn--ghost" style={{ marginBottom: 12, paddingLeft: 0 }}>
          {t.common.backToList}
        </Link>

        <div className="detail-head">
          <div>
            <p className="detail-eyebrow">
              {card.teamName ? `${card.teamName} · ` : ''}
              {formatDateTime(card.createdAt)}
            </p>
            <h1 className="page-title" style={{ marginTop: 5 }}>
              {card.senderName} → {card.receiverName}
            </h1>
            <p className="page-subtitle" style={{ marginTop: 3 }}>
              {languageLabel(card.sourceLanguage)} → {languageLabel(card.targetLanguage)}
            </p>
          </div>
          <StatusBadge status={card.status} />
        </div>
      </div>

      {actionError && (
        <div className="alert alert--error" role="alert" style={{ marginBottom: 16 }}>
          {actionError}
        </div>
      )}

      {isProcessing && (
        <div className="panel">
          <div className="spread">
            <strong>{statusLabel(card.status)}</strong>
            {/* 몇 단계 중 몇 번째인지. 숫자만 들어가는 자리라 모노스페이스가 맞다. */}
            <span className="progress-count">
              {currentStep + 1} / {PIPELINE.length}
            </span>
          </div>
          <p className="faint" style={{ marginTop: 4 }}>
            {t.detail.processingNote}
          </p>

          {/* 돌아가는 로딩 대신 진행 칸이 상태를 알린다 */}
          <div className="progress-track">
            {PIPELINE.map((step, index) => (
              <span
                key={step.status}
                className="progress-step"
                data-state={index < currentStep ? 'done' : index === currentStep ? 'active' : 'todo'}
              />
            ))}
          </div>
          <div className="progress-labels">
            {PIPELINE.map((step, index) => (
              <span key={step.status} className="progress-label" data-current={index === currentStep}>
                {step.label(t)}
              </span>
            ))}
          </div>
        </div>
      )}

      {card.status === 'FAILED' && (
        <div className="panel">
          <strong style={{ color: 'var(--danger)' }}>{t.detail.failedTitle}</strong>
          <p className="muted" style={{ marginTop: 6 }}>
            {card.errorMessage ?? t.detail.noReason}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: 16 }}
            onClick={handleReprocess}
            disabled={busy}
          >
            {busy && <span className="spinner" />}
            {t.detail.reprocess}
          </button>
        </div>
      )}

      {/*
        요약이 비어 있어도 블록은 남긴다. 통째로 사라지면 "요약이 없다" 와
        "요약 자리가 아예 없다" 가 구분되지 않는다.
      */}
      {(card.status === 'COMPLETED' || (card.summary && hasAnySummary(card.summary))) && (
        <div className="panel">
          <h2 className="summary-title">{t.detail.summary}</h2>

          {/*
            요약이 통째로 없는 것과 항목만 비어 있는 것은 원인이 다르다.
            앞은 서버가 요약을 못 만든 것이고, 뒤는 말한 내용에 그 항목이 없던 것이다.
            둘 다 「없음」 으로 보이면 어느 쪽인지 알 수 없다.
          */}
          {card.summary ? (
            <>
              <SummarySection card={card} title={t.detail.keyPoints} entries={card.summary.keyPoints ?? []} />
              <SummarySection card={card} title={t.detail.actionItems} entries={card.summary.actionItems ?? []} />
              <SummarySection
                card={card}
                title={t.detail.issues}
                entries={card.summary.blockers ?? []}
                variant="blocker"
              />
            </>
          ) : (
            <div className="alert alert--info" style={{ marginTop: 20 }}>
              <strong>{t.detail.noSummaryTitle}</strong>
              <p style={{ marginTop: 6, fontSize: 13 }}>{t.detail.noSummaryBody}</p>
            </div>
          )}
        </div>
      )}

      {(card.translatedText || card.transcript) && (
        <div className="panel">
          <h2 className="section-title" style={{ marginBottom: 12 }}>
            {t.detail.fullText}
          </h2>

          {card.translatedText && (
            <div className="transcript-block">
              <p className="transcript-label">
                {t.detail.translated(languageLabel(card.targetLanguage))}
              </p>
              <p className="transcript">{card.translatedText}</p>
            </div>
          )}

          {card.transcript && (
            <div className="transcript-block">
              <p className="transcript-label">
                {t.detail.original(languageLabel(card.sourceLanguage))}
              </p>
              <p className="transcript transcript--source">{card.transcript}</p>
            </div>
          )}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 24 }}>
        <button type="button" className="btn btn--danger" onClick={handleDelete} disabled={busy}>
          {t.detail.deleteCard}
        </button>
      </div>
    </>
  )
}

function hasAnySummary(summary: { keyPoints: unknown[]; actionItems: unknown[]; blockers: unknown[] }) {
  return summary.keyPoints.length > 0 || summary.actionItems.length > 0 || summary.blockers.length > 0
}


/**
 * 요약 한 묶음을 점 목록으로 늘어놓는다.
 * 번역문을 크게, 원문을 그 아래 작게 — 둘을 함께 보여주는 것이 이 제품의 핵심이라
 * 언어를 토글로 감추지 않는다.
 *
 * 항목이 없으면 「없음」 한 줄을 남긴다. 묶음을 통째로 지우면 요약에서 이 항목이
 * 안 나온 것인지 화면이 그 자리를 안 만든 것인지 알 수 없다.
 */
function SummarySection({
  card,
  title,
  entries,
  variant,
}: {
  card: HandoverCardResponse
  title: string
  entries: SummaryEntryDto[]
  variant?: 'blocker'
}) {
  const { lang, t } = useLanguage()

  return (
    <section className="summary-group">
      <div className="summary-group-head">
        <h3 className="summary-heading">{title}</h3>
        {entries.length > 0 && <span className="summary-count">{entries.length}</span>}
      </div>

      <ul className="summary-list">
        {entries.length === 0 ? (
          <li className="summary-item summary-item--empty">{t.common.none}</li>
        ) : (
          entries.map((entry, index) => {
            // 읽는 사람의 언어를 크게, 나머지 한 벌을 그 아래 작게.
            const primary = summaryTextFor(entry, card, lang)
            const other = primary === entry.target ? entry.source : entry.target

            return (
              <li
                key={index}
                className={`summary-item${variant === 'blocker' ? ' summary-item--blocker' : ''}`}
              >
                <p className="summary-target">{primary}</p>
                {/* 두 벌이 같으면 덧붙일 이유가 없다 */}
                {other && other !== primary && <p className="summary-source">{other}</p>}
              </li>
            )
          })
        )}
      </ul>
    </section>
  )
}

