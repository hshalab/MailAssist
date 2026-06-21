"use client"

/**
 * EmailHealthBanner
 *
 * The unmissable answer to "are we missing any client emails right now?".
 *
 * Polls /api/admin/email-health (which reports, per connected mailbox, whether
 * real-time Gmail delivery is healthy, stale, never-synced, or orphaned) and
 * surfaces a single, calm verdict at the top of the Tickets workspace. When a
 * mailbox is at risk of dropping emails, it offers a one-click recovery that
 * re-scans the inbox and backfills any thread that never became a ticket
 * (POST /api/emails/backfill) — the same safety net the reconcile cron runs.
 *
 * Designed to be quiet when healthy and impossible to ignore when not.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ShieldCheck,
  ShieldAlert,
  TriangleAlert,
  RefreshCw,
  Loader2,
  Check,
  ChevronDown,
} from "lucide-react"

interface AccountHealth {
  user_email: string
  has_token: boolean
  last_sync_at: string | null
  minutes_since_last_sync: number | null
  status: "ok" | "stale" | "never_synced" | "orphaned_no_token"
}

interface HealthResponse {
  overall: "healthy" | "degraded"
  summary: {
    total_accounts: number
    ok: number
    stale: number
    never_synced: number
    orphaned: number
  }
  accounts: AccountHealth[]
}

type RecoverState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; created: number }
  | { phase: "error"; message: string }

type ActivateState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; activated: number; total: number }
  | { phase: "error"; message: string }

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

const STATUS_COPY: Record<AccountHealth["status"], string> = {
  ok: "live",
  stale: "no emails received in 6h+",
  never_synced: "never received a live email",
  orphaned_no_token: "disconnected — needs reconnect",
}

function relativeSync(minutes: number | null): string {
  if (minutes === null) return "never"
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface EmailHealthBannerProps {
  /** Called after a successful recovery so the parent can refresh its list. */
  onRecovered?: () => void
}

export default function EmailHealthBanner({ onRecovered }: EmailHealthBannerProps) {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [recover, setRecover] = useState<RecoverState>({ phase: "idle" })
  const [activate, setActivate] = useState<ActivateState>({ phase: "idle" })
  const [expanded, setExpanded] = useState(false)
  const [dismissedHealthy, setDismissedHealthy] = useState(false)
  const mountedRef = useRef(true)

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/email-health", { cache: "no-store" })
      // 401/403 => not an admin/business session; this banner simply hides.
      if (!res.ok) {
        if (mountedRef.current) setHealth(null)
        return
      }
      const data: HealthResponse = await res.json()
      if (mountedRef.current) setHealth(data)
    } catch {
      if (mountedRef.current) setHealth(null)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    loadHealth()
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return
      loadHealth()
    }, POLL_INTERVAL_MS)
    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [loadHealth])

  const runRecovery = useCallback(async () => {
    setRecover({ phase: "running" })
    try {
      let created = 0
      let resumeToken: string | null = null
      let guard = 0
      // CRITICAL: bound recovery to recent mail only. Without a date window the
      // backfill walks the ENTIRE inbox history and ticketed year-old emails.
      // A watch lapses weekly and the daily cron backfills, so 30 days is a safe
      // margin that recovers real gaps without dredging up old mail.
      const RECOVER_QUERY = encodeURIComponent("in:inbox newer_than:30d");
      // Walk the backfill in resumable chunks until it reports completion.
      do {
        const url: string = resumeToken
          ? `/api/emails/backfill?q=${RECOVER_QUERY}&pageToken=${encodeURIComponent(resumeToken)}`
          : `/api/emails/backfill?q=${RECOVER_QUERY}`
        const res: Response = await fetch(url, { method: "POST", credentials: "include" })
        if (!res.ok) {
          const body: any = await res.json().catch(() => ({}))
          throw new Error(body?.error || `Recovery failed (${res.status})`)
        }
        const data: any = await res.json()
        created += data?.totals?.ticketsCreated ?? 0
        resumeToken = data?.completed ? null : (data?.resumePageToken ?? null)
        guard++
      } while (resumeToken && guard < 25)

      if (mountedRef.current) {
        setRecover({ phase: "done", created })
        onRecovered?.()
        loadHealth()
      }
    } catch (err) {
      if (mountedRef.current) {
        setRecover({
          phase: "error",
          message: err instanceof Error ? err.message : "Recovery failed",
        })
      }
    }
  }, [onRecovered, loadHealth])

  // Restore real-time delivery by (re)activating the Gmail watch for each
  // connected mailbox. This is the ACTUAL fix for "not live" — recovery only
  // backfills already-missed mail; this stops the bleeding going forward.
  const runActivate = useCallback(async () => {
    setActivate({ phase: "running" })
    try {
      const res = await fetch("/api/admin/activate-watches", { method: "POST", credentials: "include" })
      const data: any = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `Failed (${res.status})`)
      setActivate({ phase: "done", activated: data?.activated ?? 0, total: data?.total ?? 0 })
      loadHealth()
    } catch (err) {
      setActivate({ phase: "error", message: err instanceof Error ? err.message : "Failed to restore live delivery" })
    }
  }, [loadHealth])

  // Nothing to show: no session/permission, or still loading.
  if (!health) return null

  const { summary, accounts } = health
  const atRisk = summary.stale + summary.never_synced + summary.orphaned
  const isDegraded = atRisk > 0

  // Healthy + dismissed → render nothing.
  if (!isDegraded && dismissedHealthy) return null

  // ---- Healthy state: a slim, reassuring strip. ----
  if (!isDegraded) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-[var(--status-success-bg)]/60 text-[12px]">
        <ShieldCheck className="h-3.5 w-3.5 text-[var(--status-success)] flex-shrink-0" />
        <span className="text-foreground/80 font-medium tracking-tight">
          All {summary.total_accounts} mailbox{summary.total_accounts === 1 ? "" : "es"} receiving email live
        </span>
        <span className="text-muted-foreground">· no emails being missed</span>
        <button
          onClick={() => setDismissedHealthy(true)}
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors text-[11px]"
        >
          Dismiss
        </button>
      </div>
    )
  }

  // ---- Degraded state: prominent, actionable. ----
  const critical = summary.never_synced + summary.orphaned > 0
  const accentVar = critical ? "--destructive" : "--status-medium"
  const Icon = critical ? ShieldAlert : TriangleAlert
  const headline =
    atRisk === 1
      ? "1 mailbox may be missing emails"
      : `${atRisk} mailboxes may be missing emails`

  const riskyAccounts = accounts.filter((a) => a.status !== "ok")

  return (
    <div
      className="border-b border-border/60 bg-card animate-in slide-in-from-top-2 duration-300"
      style={{ borderLeft: `3px solid var(${accentVar})` }}
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        <div
          className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
          style={{ background: `color-mix(in oklch, var(${accentVar}) 14%, transparent)` }}
        >
          <Icon className="h-4 w-4" style={{ color: `var(${accentVar})` }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold tracking-tight text-foreground">
              {headline}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {summary.ok}/{summary.total_accounts} live
            </span>
          </div>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Real-time delivery looks interrupted. Recover now to re-scan the inbox and
            pull in any client emails that never became tickets.
          </p>

          {/* Expandable per-account breakdown */}
          {riskyAccounts.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={`h-3 w-3 transition-transform ${expanded ? "rotate-180" : ""}`}
              />
              {expanded ? "Hide" : "Show"} affected mailbox{riskyAccounts.length === 1 ? "" : "es"}
            </button>
          )}
          {expanded && (
            <ul className="mt-1.5 space-y-1 border-l border-border/60 pl-3">
              {riskyAccounts.map((a) => (
                <li key={a.user_email} className="flex items-center gap-2 text-[11px]">
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{
                      background:
                        a.status === "stale" ? "var(--status-medium)" : "var(--destructive)",
                    }}
                  />
                  <span className="truncate font-medium text-foreground/90">{a.user_email}</span>
                  <span className="text-muted-foreground">— {STATUS_COPY[a.status]}</span>
                  {a.status === "stale" && (
                    <span className="text-muted-foreground/70">
                      (last: {relativeSync(a.minutes_since_last_sync)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Result feedback */}
          {recover.phase === "done" && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--status-success)]">
              <Check className="h-3.5 w-3.5" />
              {recover.created > 0
                ? `Recovered ${recover.created} missing ticket${recover.created === 1 ? "" : "s"}.`
                : "Re-scan complete — no missing emails found."}
            </div>
          )}
          {recover.phase === "error" && (
            <div className="mt-2 text-[12px] font-medium text-destructive">{recover.message}</div>
          )}
          {activate.phase === "done" && (
            <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--status-success)]">
              <Check className="h-3.5 w-3.5" />
              Re-activated {activate.activated}/{activate.total} mailbox{activate.total === 1 ? "" : "es"} — live delivery restored.
            </div>
          )}
          {activate.phase === "error" && (
            <div className="mt-2 text-[12px] font-medium text-destructive">{activate.message}</div>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-col gap-1.5">
          {/* Primary: actually fix live delivery by re-activating the watch. */}
          <button
            onClick={runActivate}
            disabled={activate.phase === "running"}
            className="inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
            style={{ background: `var(${accentVar})` }}
          >
            {activate.phase === "running" ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Restoring…</>
            ) : (
              <><ShieldCheck className="h-3.5 w-3.5" />Restore live delivery</>
            )}
          </button>
          {/* Secondary: pull in anything missed while it was down (bounded to 30d). */}
          <button
            onClick={runRecovery}
            disabled={recover.phase === "running"}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5 text-[12px] font-medium text-foreground/80 transition-all hover:bg-muted/50 disabled:opacity-70"
          >
            {recover.phase === "running" ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" />Recovering…</>
            ) : (
              <><RefreshCw className="h-3.5 w-3.5" />Recover missed (30d)</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
