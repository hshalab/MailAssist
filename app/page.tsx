"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import TopNav from "@/components/top-nav"
import Sidebar, { type SidebarView } from "@/components/sidebar"
import GmailConnect from "@/components/gmail-connect"
import InboxView from "@/components/inbox-view"
import SettingsView from "@/components/settings-view"
import DraftsView from "@/components/drafts-view"
import SyncToast from "@/components/sync-toast"
import UserSelector from "@/components/user-selector"
import UserManagement from "@/components/user-management"
import TicketsView from "@/components/tickets-view"
import AISettings from "@/components/ai-settings"
import QuickRepliesView from "@/components/quick-replies-view"
import AnalyticsDashboard from "@/components/analytics-dashboard"
import ComposeView from "@/components/compose-view"
import TeamManagement from "@/components/team-management"
import DepartmentsView from "@/components/departments-view"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { User, Sparkles } from "lucide-react"

type View = SidebarView

interface UserProfile {
  name?: string
  email?: string
  picture?: string
}

interface SyncStats {
  totalStored: number
  sentWithEmbeddings: number
  completedReplies: number
  pendingReplies: number
  lastSync: number | null
  processing?: boolean
  queued?: number
  processed?: number
  errors?: number
}

function PageContent() {
  const [isConnected, setIsConnected] = useState(false)
  const [activeView, setActiveView] = useState<View>(() => {
    // Restore last active view from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('activeView')
      if (saved && ['inbox', 'sent', 'spam', 'trash', 'drafts', 'tickets', 'quick-replies', 'compose', 'settings', 'ai-settings', 'analytics', 'user-management', 'team'].includes(saved)) {
        return saved as View
      }
    }
    return "inbox"
  })
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [draftsVersion, setDraftsVersion] = useState(0)
  const [ticketsVersion, setTicketsVersion] = useState(0)
  const [hasAutoSynced, setHasAutoSynced] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [checkingUser, setCheckingUser] = useState(true)
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; role: string; businessId?: string | null; businessName?: string | null } | null>(null)
  const [hasAdmin, setHasAdmin] = useState(false)

  const [syncStatus, setSyncStatus] = useState<SyncStats | null>(null)
  const [syncInProgress, setSyncInProgress] = useState(false)
  const [syncTarget, setSyncTarget] = useState<number | null>(null)
  const [syncBaseline, setSyncBaseline] = useState(0)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [hideSyncToast, setHideSyncToast] = useState(false)
  const syncContinueCountRef = useRef(0) // Safety counter — ref so useCallback closures see live value
  // Live refs for state read inside startSync. Reading from refs (instead of
  // including the state in startSync's dep array) keeps startSync's identity
  // stable across renders. Without this, every setSyncStatus call recreates
  // startSync, which retriggered the main mount-effect, which called
  // fetchSyncStatus again — a render → fetch → state-update → render loop
  // that hammered /api/emails/sync and /api/auth/profile multiple times per
  // second and blew through Vercel's edge-request quota.
  const syncStatusRef = useRef<SyncStats | null>(null)
  const syncTargetRef = useRef<number | null>(null)
  const LOCAL_STORAGE_KEY = "gmail_connected"
  const [loggingOut, setLoggingOut] = useState(false)
  const [globalSearch, setGlobalSearch] = useState<string>("")
  const [deepLinkTicketId, setDeepLinkTicketId] = useState<string | null>(null)
  const [ticketNavKey, setTicketNavKey] = useState(0) // Force re-selection on navigation
  const [showPersonalAccountDialog, setShowPersonalAccountDialog] = useState(false)
  const searchParams = useSearchParams()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const isOAuthReturn = params.get("auth") === "success" ||
      params.get("businessAuth") === "true" ||
      params.get("connected") === "true"

    let timeoutId: NodeJS.Timeout | null = null

    // If this is an OAuth return, skip initial checks and handle it specially
    if (!isOAuthReturn) {
      checkAuthStatus()
      checkUserSelection()
    }

    if (params.get("auth") === "success") {
      setIsConnected(true)
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, "true")
      } catch {
        // Ignore localStorage errors (e.g. in private mode)
      }

      // CRITICAL: Always set skeleton flag when returning from OAuth
      // This ensures loading skeleton shows immediately, even if sessionStorage was cleared
      if (typeof window !== 'undefined') {
        // Set skeleton flag from URL param or sessionStorage, or set it fresh
        const urlSkeletonFlag = params.get("showSkeleton") === "true"
        const hasSkeletonFlag = sessionStorage.getItem('show_inbox_skeleton_on_return') === 'true'

        if (urlSkeletonFlag || !hasSkeletonFlag) {
          // Always set it when returning from OAuth to ensure skeleton shows
          sessionStorage.setItem('show_inbox_skeleton_on_return', 'true')
          console.log('[OAuth Return] Set skeleton flag - skeleton will show')
        }
        // Ensure we're on inbox view to show skeleton
        setActiveView("inbox")
      }

      // CONSISTENCY FIX: Only show welcome dialog for truly new accounts
      // Don't show if user already has a session (returning user)
      if (params.get("newAccount") === "true") {
        // Check if this is truly a new user (no existing session)
        const hasExistingSession = typeof window !== 'undefined' &&
          sessionStorage.getItem('current_user_id') !== null;

        if (!hasExistingSession) {
          setShowPersonalAccountDialog(true)
        }

        // Trigger sync and auto-classification for new accounts
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('trigger_sync_after_connect', 'true')
          sessionStorage.setItem('trigger_backfill_after_sync', 'true')
        }
      }

      window.history.replaceState({}, "", window.location.pathname)
      // After Gmail auth, check if user is selected
      // Ensure checkingUser is set to false after checkUserSelection completes
      Promise.all([
        checkAuthStatus(),
        checkUserSelection()
      ]).finally(() => {
        setCheckingUser(false)
        setCheckingAuth(false)
      })

      // Safety timeout to ensure loading state is cleared even if API calls hang
      timeoutId = setTimeout(() => {
        setCheckingUser(false)
        setCheckingAuth(false)
      }, 5000) // 5 second timeout
    } else if (params.get("businessAuth") === "true") {
      setIsConnected(true)
      window.history.replaceState({}, "", window.location.pathname)
      Promise.all([
        checkAuthStatus(),
        checkUserSelection()
      ]).finally(() => {
        setCheckingUser(false)
        setCheckingAuth(false)
      })

      // Safety timeout
      timeoutId = setTimeout(() => {
        setCheckingUser(false)
        setCheckingAuth(false)
      }, 5000)
    } else if (params.get("connected") === "true") {
      setIsConnected(true)
      // Store flag to trigger sync and auto-classification after component is ready
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('trigger_sync_after_connect', 'true')
        sessionStorage.setItem('trigger_backfill_after_sync', 'true')
        // Keep the skeleton flag - it will be cleared when emails load
        // Don't remove it here, let EmailList clear it
      }
      // Ensure we're on inbox view to show skeleton
      setActiveView("inbox")
      window.history.replaceState({}, "", window.location.pathname)
      // Ensure checkingUser is set to false after checkUserSelection completes
      Promise.all([
        checkAuthStatus(),
        checkUserSelection()
      ]).finally(() => {
        setCheckingUser(false)
        setCheckingAuth(false)
      })

      // Safety timeout
      timeoutId = setTimeout(() => {
        setCheckingUser(false)
        setCheckingAuth(false)
      }, 5000)
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }

    // NEW: If a valid business session exists, set isConnected to true
    fetch("/api/auth/current-user")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.user) {
          setIsConnected(true)
        }
      })
      .catch(() => { })
      .finally(() => {
        // Ensure checking states are set to false after all initialization
        // Only set if checkUserSelection hasn't already set them
        // Use a small timeout to let checkUserSelection complete first
        setTimeout(() => {
          setCheckingAuth(false)
          // Only set checkingUser if no user was selected
          if (!currentUserId) {
            setCheckingUser(false)
          }
        }, 100)
      })
  }, [])

  // Listen to ticketId in the URL to deep-link into a specific ticket from notifications
  useEffect(() => {
    const ticketId = searchParams.get("ticketId")
    if (ticketId) {
      if (ticketId !== deepLinkTicketId) {
        setActiveView("tickets")
        setDeepLinkTicketId(ticketId)
        setTicketNavKey(prev => prev + 1) // Increment to force re-selection
      }
    } else {
      // Clear deep link if removed from URL
      if (deepLinkTicketId) {
        setDeepLinkTicketId(null)
      }
    }
  }, [searchParams, deepLinkTicketId])

  // Save active view to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('activeView', activeView)
    }
  }, [activeView])

  // Update browser tab title to show current user
  useEffect(() => {
    if (currentUser?.name) {
      document.title = `${currentUser.name} (${currentUser.role}) - MailAssist`
    } else if (isConnected) {
      document.title = "MailAssist"
    } else {
      document.title = "MailAssist - Connect Gmail"
    }
  }, [currentUser, isConnected])

  // Redirect to /welcome when auth checks have settled and user is not connected.
  // Using useEffect avoids calling window.location.href as a render side-effect,
  // which could fire on transient false states mid-auth-check.
  useEffect(() => {
    if (!checkingAuth && !checkingUser && !isConnected) {
      if (typeof window !== 'undefined') {
        window.location.href = '/welcome'
      }
    }
  }, [checkingAuth, checkingUser, isConnected])

  // Re-check admin status when currentUser changes
  useEffect(() => {
    if (currentUser && isConnected) {
      checkAdminExists()
    }
  }, [currentUser, isConnected])

  // Proactively refresh Gmail OAuth tokens every 45 minutes so they never expire
  // while the user is actively using the app. Access tokens last 60 minutes;
  // refreshing at 45-min intervals keeps them well within validity.
  useEffect(() => {
    if (!isConnected) return

    const doRefresh = () => {
      // Always run regardless of visibility: access tokens expire at 60 min,
      // so skipping at 45 min would leave the user with an expired token on
      // their next visit. ~32 calls/day, not a request-volume concern.
      fetch('/api/auth/refresh-tokens', { method: 'POST', credentials: 'include' })
        .then(res => res.json())
        .then(data => {
          if (data.refreshed > 0) {
            console.log(`[TokenRefresh] Proactively refreshed ${data.refreshed} Gmail token(s)`)
          }
        })
        .catch(err => console.warn('[TokenRefresh] Background refresh failed:', err))
    }

    // Run once shortly after the user is confirmed connected, then every 45 minutes
    const initialTimer = setTimeout(doRefresh, 10_000) // 10 s after connection confirmed
    const interval = setInterval(doRefresh, 45 * 60 * 1000) // Every 45 minutes

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
    }
  }, [isConnected])

  const checkAdminExists = async () => {
    try {
      const response = await fetch("/api/users")
      if (response.ok) {
        const data = await response.json()
        const adminExists = data.users?.some((u: any) => u.role === "admin" && u.isActive) || false
        setHasAdmin(adminExists)
      }
    } catch {
      // Ignore errors
    }
  }

  const checkUserSelection = async () => {
    try {
      // Check for admin existence first
      await checkAdminExists()

      // Check if coming from OAuth redirect - if so, skip sessionStorage check
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
      const isOAuthRedirect = urlParams?.get('auth') === 'success'

      // First check sessionStorage (per-tab) - skip if OAuth redirect
      // But verify with API to ensure user belongs to current Gmail account
      if (!isOAuthRedirect && typeof window !== "undefined") {
        const storedUserId = sessionStorage.getItem("current_user_id")
        const storedUserName = sessionStorage.getItem("current_user_name")
        const storedUserRole = sessionStorage.getItem("current_user_role")
        const storedBusinessId = sessionStorage.getItem("current_user_business_id")

        if (storedUserId && storedUserName && storedUserRole) {
          // Verify user still belongs to current account
          const verifyResponse = await fetch("/api/auth/current-user", { cache: "no-store" })
          if (verifyResponse.ok) {
            const verifyData = await verifyResponse.json()
            if (verifyData.user && verifyData.user.id === storedUserId) {
              // User is valid and belongs to current account
              setCurrentUserId(storedUserId)
              setCurrentUser({
                id: storedUserId,
                name: storedUserName,
                role: storedUserRole,
                businessId: storedBusinessId || null,
              })
              setIsConnected(true) // FIX: Ensure connection state is synced
              setCheckingUser(false)
              setCheckingAuth(false)
              // CRITICAL: Force tickets refresh after auth to ensure fresh data
              setTicketsVersion(v => v + 1)
              return
            }
          }
          // If verification failed, clear sessionStorage
          sessionStorage.removeItem("current_user_id")
          sessionStorage.removeItem("current_user_name")
          sessionStorage.removeItem("current_user_role")
        }
      }

      // Fallback: Check API (cookie-based, shared across tabs)
      const response = await fetch("/api/auth/current-user", { cache: "no-store" })
      if (response.ok) {
        const data = await response.json()
        console.log('[DEBUG] Current user API response:', data) // DEBUG
        if (data.user) {
          console.log('[DEBUG] User businessId:', data.user.businessId) // DEBUG
          setCurrentUserId(data.user.id)
          setCurrentUser({
            id: data.user.id,
            name: data.user.name,
            role: data.user.role,
            businessId: data.user.businessId || null,
          })
          setIsConnected(true) // FIX: Ensure connection state is synced
          // Store in sessionStorage for this tab
          if (typeof window !== "undefined") {
            sessionStorage.setItem("current_user_id", data.user.id)
            sessionStorage.setItem("current_user_name", data.user.name)
            sessionStorage.setItem("current_user_role", data.user.role)
            sessionStorage.setItem("current_user_business_id", data.user.businessId || "")
            console.log('[DEBUG] Stored businessId in sessionStorage:', data.user.businessId) // DEBUG
          }
          setCheckingUser(false)
          setCheckingAuth(false)
          // CRITICAL: Force tickets refresh after auth to ensure fresh data
          setTicketsVersion(v => v + 1)
        } else {
          // No user found but response was ok - set checking to false
          setCheckingUser(false)
          setCheckingAuth(false)
        }
      } else if (response.status === 403 || response.status === 404) {
        // User doesn't belong to current account or not found
        // Check if this is because data was deleted (user was previously logged in)
        const wasLoggedIn = typeof window !== "undefined" && (
          sessionStorage.getItem("current_user_id") ||
          localStorage.getItem(LOCAL_STORAGE_KEY) === "true"
        )

        if (wasLoggedIn && response.status === 404) {
          // User data was deleted - clear everything and redirect silently
          console.log('[Auth] User data was deleted, clearing session and redirecting...')

          // Clear all session data
          if (typeof window !== "undefined") {
            sessionStorage.clear()
            localStorage.removeItem(LOCAL_STORAGE_KEY)
            localStorage.removeItem("inbox_selected_account")
            localStorage.removeItem("activeView")
          }

          // Clear cookies by calling logout
          try {
            await fetch("/api/auth/logout", { method: "POST" })
          } catch (err) {
            console.error("Error during logout:", err)
          }

          // Automatically redirect to welcome screen
          if (typeof window !== "undefined") {
            window.location.href = "/welcome"
          }
          return
        }

        // Normal case: clear sessionStorage
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("current_user_id")
          sessionStorage.removeItem("current_user_name")
          sessionStorage.removeItem("current_user_role")
          sessionStorage.removeItem("current_user_business_id")
        }
        setCurrentUserId(null)
        setCurrentUser(null)
        setCheckingUser(false)
        setCheckingAuth(false)
      } else {
        // Other status codes - still set checking to false
        setCheckingUser(false)
        setCheckingAuth(false)
      }
      // If 404, no user selected - that's okay, we'll show selector
    } catch (error) {
      console.error('[checkUserSelection] Error:', error)
      // Always set checking to false even on error
      setCheckingUser(false)
      setCheckingAuth(false)
    }
  }

  const handleUserSelected = async (userId: string) => {
    console.log('[DEBUG] handleUserSelected called with userId:', userId)
    setCurrentUserId(userId)

    // Fetch user details
    try {
      const response = await fetch(`/api/users/${userId}`)
      if (response.ok) {
        const data = await response.json()
        console.log('[DEBUG] User data fetched:', data.user)
        if (data.user) {
          const user = {
            id: data.user.id,
            name: data.user.name,
            role: data.user.role,
            businessId: data.user.businessId || null,
          }

          setCurrentUser(user)

          // Store in sessionStorage for this tab
          if (typeof window !== "undefined") {
            sessionStorage.setItem("current_user_id", data.user.id)
            sessionStorage.setItem("current_user_name", data.user.name)
            sessionStorage.setItem("current_user_role", data.user.role)
            sessionStorage.setItem("current_user_business_id", data.user.businessId || "")
          }

          // Refresh admin check after user selection
          await checkAdminExists()

          // CRITICAL: Set checkingUser to false AFTER all state updates
          setCheckingUser(false)

          // After user selection, navigate to inbox (default view)
          setActiveView("inbox")

          console.log('[DEBUG] User selected successfully, should show main app now')
          return
        }
      }
      console.error('[DEBUG] Failed to fetch user data')
    } catch (error) {
      console.error('[DEBUG] Error in handleUserSelected:', error)
    }

    // If we failed, still set checkingUser to false
    setCheckingUser(false)
  }

  const handleSwitchUser = async (userId: string) => {
    // User switching - update state smoothly without page reload
    setCurrentUserId(userId)

    // Fetch user details to update UI
    try {
      const response = await fetch(`/api/users/${userId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.user) {
          setCurrentUser({
            id: data.user.id,
            name: data.user.name,
            role: data.user.role,
            businessId: data.user.businessId || null,
          })
          // Store in sessionStorage for this tab
          if (typeof window !== "undefined") {
            sessionStorage.setItem("current_user_id", data.user.id)
            sessionStorage.setItem("current_user_name", data.user.name)
            sessionStorage.setItem("current_user_role", data.user.role)
            sessionStorage.setItem("current_user_business_id", data.user.businessId || "")
          }
          // Refresh admin check after user selection
          await checkAdminExists()
        }
      }
    } catch {
      // Ignore errors
    }
  }

  const fetchSyncStatus = useCallback(async () => {
    if (!isConnected) return null
    try {
      const response = await fetch("/api/emails/sync", { cache: "no-store" })
      if (!response.ok) return null
      const data: SyncStats = await response.json()
      syncStatusRef.current = data
      setSyncStatus(data)
      if (typeof data.processing === "boolean") {
        setSyncInProgress(data.processing)
        if (!data.processing) {
          syncTargetRef.current = null
          setSyncTarget(null)
          setSyncBaseline(0)
        } else if (typeof data.queued === "number") {
          syncTargetRef.current = data.queued
          setSyncTarget(data.queued)
        }
      }
      return data
    } catch {
      return null
    }
  }, [isConnected])

  const startSync = useCallback(
    async (maxResults = 300, silent = false) => {
      if (!isConnected) throw new Error("Connect Gmail first to sync emails.")

      // Only update UI state if not silent mode
      if (!silent) {
        setSyncError(null)
        setHideSyncToast(false)
      }

      const response = await fetch(`/api/emails/sync?maxResults=${maxResults}`, { method: "POST" })
      const data = await response.json().catch(() => ({}))

      if (response.status === 202 && data?.processing) {
        if (!silent) {
          setSyncInProgress(true)
          const nextTarget = data.queued ?? syncTargetRef.current ?? maxResults
          syncTargetRef.current = nextTarget
          setSyncTarget(nextTarget)
          setSyncBaseline(syncStatusRef.current?.sentWithEmbeddings ?? 0)
        }
        return
      }

      if (!response.ok) {
        // 401: session expired — send user back to login instead of showing a toast error
        if (response.status === 401) {
          if (typeof window !== 'undefined') {
            window.location.href = '/auth/landing?view=login'
          }
          return
        }
        const message = data?.error || "Failed to start sync"
        if (!silent) {
          setSyncInProgress(false)
          setSyncTarget(null)
          setSyncBaseline(0)
          setSyncError(message)
        }
        throw new Error(message)
      }

      const baseline = syncStatusRef.current?.sentWithEmbeddings ?? 0
      if (!silent) {
        setSyncBaseline(baseline)
        const nextTarget = data?.queued ?? maxResults
        syncTargetRef.current = nextTarget
        setSyncTarget(nextTarget)
        setSyncInProgress(true)
      }
      await fetchSyncStatus()

      if (data?.continue) {
        // Hard cap on continuation chain — prevents runaway loops if backend
        // keeps returning continue=true (data corruption / pagination bug).
        // Worst-case maxResults=2000 with BATCH_SIZE=50 ⇒ ~40 continuations.
        // Using a ref because startSync is a useCallback whose deps do not
        // include this counter, so a state value would be stale in the closure.
        const MAX_CONTINUE_CHAIN = 50
        if (syncContinueCountRef.current >= MAX_CONTINUE_CHAIN) {
          console.warn('[Sync] Continuation cap reached, stopping chain')
          syncContinueCountRef.current = 0
          if (!silent) setSyncInProgress(false)
          return
        }
        syncContinueCountRef.current += 1
        // 3s back-off (was 1s) — reduces request volume during long syncs
        // and gives Vercel function pool time to recycle.
        setTimeout(() => {
          startSync(maxResults, silent)
        }, 3000)
      } else if (!data?.continue) {
        syncContinueCountRef.current = 0
        if (!silent) {
          setSyncInProgress(false)
        }
      }
    },
    // syncStatus and syncTarget read from refs above so startSync stays stable
    // across renders. fetchSyncStatus is already stable (only depends on isConnected).
    [isConnected, fetchSyncStatus]
  )

  // Separate effect to trigger sync after Gmail connection
  useEffect(() => {
    if (typeof window === 'undefined') return

    const shouldTriggerSync = sessionStorage.getItem('trigger_sync_after_connect')
    if (shouldTriggerSync === 'true' && isConnected) {
      console.log('[Auth] Gmail connected, triggering sync...')
      sessionStorage.removeItem('trigger_sync_after_connect')

      // Small delay to ensure everything is ready
      setTimeout(() => {
        startSync(500).catch(err => {
          console.error('[Auth] Failed to trigger sync:', err)
        })
      }, 500)
    }
  }, [isConnected, startSync])

  useEffect(() => {
    if (isConnected) {
      fetchProfile()
      fetchSyncStatus()
      if (!hasAutoSynced) {
        setHasAutoSynced(true)
        // Fetch up to 500 emails (enough for most users)
        // The sync will process them in batches of 15 automatically
        startSync(500).catch((err) => setSyncError(err.message))
      }
    } else {
      setUserProfile(null)
      setHasAutoSynced(false)
      setSyncStatus(null)
      setSyncInProgress(false)
      setSyncTarget(null)
      setSyncBaseline(0)
    }
    // Intentionally only react to auth state changes. Including the function
    // refs caused this effect to re-run on every render (because their
    // identity changes when state inside them changes), causing a fetch storm.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, hasAutoSynced])

  const shouldPoll = syncInProgress || (syncStatus?.processing ?? false)

  useEffect(() => {
    if (!shouldPoll) return

    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      fetchSyncStatus()
    }, 90000) // 90s; pauses when tab hidden to cut idle requests

    return () => {
      clearInterval(interval)
    }
  }, [shouldPoll, fetchSyncStatus])

  useEffect(() => {
    if (!isConnected) return
    if (syncStatus?.processing && !syncInProgress) {
      setHideSyncToast(false)
      startSync(500).catch((err) => {
        console.error("Error resuming sync:", err)
        setSyncError(err instanceof Error ? err.message : "Failed to resume sync")
      })
    }
    // Same reason as above — keep startSync identity out of the dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, syncStatus?.processing, syncInProgress])

  // Background sync removed: Gmail Pub/Sub webhook (/api/webhooks/gmail)
  // delivers new emails in real-time, and the nightly cron in vercel.json
  // covers any gaps. The in-app interval was duplicating that work and
  // burning Vercel edge requests for every connected user.

  const checkAuthStatus = async () => {
    try {
      // First, check for a valid Gmail connection (legacy logic)
      const hasLocalConnection =
        typeof window !== "undefined" &&
        window.localStorage.getItem(LOCAL_STORAGE_KEY) === "true"

      // If Gmail connected, verify tokens
      if (hasLocalConnection) {
        const response = await fetch("/api/emails?type=inbox&maxResults=1")
        if (response.ok) {
          setIsConnected(true)
          setCheckingAuth(false)
          return
        } else {
          // Gmail tokens expired/invalid - clean up flag but DO NOT set isConnected=false
          // yet, because we still need to check if a valid business session exists below.
          // Setting false here would race against checkUserSelection and trigger a
          // premature redirect to /welcome before the business-session check completes.
          try {
            window.localStorage.removeItem(LOCAL_STORAGE_KEY)
          } catch { }
        }
      }

      // Otherwise, check for a valid business/session login
      const userResponse = await fetch("/api/auth/current-user")
      if (userResponse.ok) {
        const userData = await userResponse.json()
        if (userData.user) {
          setIsConnected(true)
        } else {
          setIsConnected(false)
        }
      } else {
        setIsConnected(false)
      }
    } catch {
      setIsConnected(false)
    } finally {
      setCheckingAuth(false)
    }
  }

  const fetchProfile = async () => {
    try {
      const response = await fetch("/api/auth/profile")
      if (response.ok) {
        const data = await response.json()
        setUserProfile(data)
      }
    } catch {
      // ignore errors for profile
    }
  }

  const handleConnect = () => {
    // GmailConnect handles redirect
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } finally {
      // CRITICAL: Clear ALL caches to prevent showing previous account's data
      if (typeof window !== "undefined") {
        // Clear sessionStorage for this tab
        sessionStorage.removeItem("current_user_id")
        sessionStorage.removeItem("current_user_name")
        sessionStorage.removeItem("current_user_role")
        sessionStorage.removeItem("current_user_business_id")
        sessionStorage.removeItem("current_user_email")

        // Clear localStorage items that may contain stale email references
        localStorage.removeItem("inbox_selected_account")

        // CRITICAL FIX: Clear browser cache for email endpoints
        // This prevents showing cached emails from previous account
        try {
          // Clear all API cache entries for email-related routes
          if ('caches' in window) {
            caches.keys().then((names) => {
              names.forEach((name) => {
                caches.delete(name)
              })
            })
          }
        } catch (e) {
          console.warn('Failed to clear browser caches:', e)
        }

        // CRITICAL FIX: Set a flag to force fresh data on next login
        // This timestamp ensures React components fetch fresh data
        sessionStorage.setItem('logout_timestamp', Date.now().toString())
      }

      setIsConnected(false)
      setCurrentUserId(null)
      setCurrentUser(null)
      setActiveView("inbox")
      setSelectedEmail(null)
      setUserProfile(null)
      setDraftsVersion((v) => v + 1)

      // Reset sync state to prevent showing stale sync data
      setSyncStatus(null)
      setSyncInProgress(false)
      setSyncTarget(null)
      setSyncBaseline(0)
      setSyncError(null)
      setHideSyncToast(true)
      setHasAutoSynced(false)

      // Keep the logging overlay visible briefly to show feedback
      setTimeout(() => setLoggingOut(false), 600)
    }
  }

  const handleDraftGenerated = () => {
    setDraftsVersion((v) => v + 1)
  }

  const handleClearGlobalSearch = useCallback(() => {
    setGlobalSearch("")
  }, [])

  const renderView = () => {
    switch (activeView) {
      case "settings":
        return (
          <SettingsView
            status={syncStatus}
            syncing={syncStatus?.processing ?? syncInProgress}
            onSync={startSync}
            error={syncError}
            currentUserId={currentUserId}
            currentUserRole={currentUser?.role as "admin" | "manager" | "agent" | null}
          />
        )
      case "users":
        return (
          <div className="p-6">
            <UserManagement currentUserId={currentUserId} />
          </div>
        )
      case "team":
        return <TeamManagement currentUser={currentUser} />
      case "drafts":
        return <DraftsView key={currentUserId || "no-user"} refreshKey={draftsVersion} currentUserId={currentUserId} />
      case "compose":
        return <ComposeView key={currentUserId || "no-user"} currentUserId={currentUserId} onEmailSent={() => setTicketsVersion(v => v + 1)} setActiveView={setActiveView} />
      case "quick-replies":
        return <QuickRepliesView key={currentUserId || "no-user"} currentUserId={currentUserId} />
      case "tickets":
        return (
          <TicketsView
            key={`${currentUserId || "no-user"}-${ticketsVersion}`}
            currentUserId={currentUserId}
            currentUserRole={currentUser?.role as "admin" | "manager" | "agent" | null}
            globalSearchTerm={globalSearch}
            onClearGlobalSearch={handleClearGlobalSearch}
            refreshKey={ticketsVersion}
            initialTicketId={deepLinkTicketId || undefined}
            ticketNavKey={ticketNavKey}
          />
        )
      case "ai-settings":
        return <AISettings />
      case "departments":
        return <DepartmentsView currentUser={currentUser} />
      case "analytics":
        return (
          <div className="p-6">
            <AnalyticsDashboard currentUserRole={currentUser?.role as "admin" | "manager" | "agent" | null} />
          </div>
        )
      case "sent":
        return (
          <InboxView
            selectedEmail={selectedEmail}
            onSelectEmail={setSelectedEmail}
            onDraftGenerated={handleDraftGenerated}
            viewType="sent"
            globalSearchTerm={globalSearch}
          />
        )
      case "spam":
        return (
          <InboxView
            selectedEmail={selectedEmail}
            onSelectEmail={setSelectedEmail}
            onDraftGenerated={handleDraftGenerated}
            viewType="spam"
            globalSearchTerm={globalSearch}
          />
        )
      case "trash":
        return (
          <InboxView
            selectedEmail={selectedEmail}
            onSelectEmail={setSelectedEmail}
            onDraftGenerated={handleDraftGenerated}
            viewType="trash"
            globalSearchTerm={globalSearch}
          />
        )
      default:
        return (
          <InboxView
            selectedEmail={selectedEmail}
            onSelectEmail={setSelectedEmail}
            onDraftGenerated={handleDraftGenerated}
            viewType="inbox"
            globalSearchTerm={globalSearch}
          />
        )
    }
  }

  const renderMobileTabs = () => {
    if (!isConnected) return null

    const tabs: { id: View; label: string }[] = [
      { id: "inbox", label: "Inbox" },
      { id: "sent", label: "Sent" },
      { id: "tickets", label: "Tickets" },
      { id: "drafts", label: "Drafts" },
      { id: "settings", label: "Settings" },
    ]

    // Add Team tab for admins
    if (currentUser?.role === "admin") {
      tabs.push({ id: "users", label: "Team" })
    }

    // Add AI tab for admin/manager
    if (currentUser?.role === "admin" || currentUser?.role === "manager") {
      tabs.push({ id: "ai-settings", label: "AI" })
      tabs.push({ id: "analytics", label: "Analytics" })
    }

    return (
      <div className="md:hidden border-b border-border">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                // CRITICAL: Force fresh ticket data when navigating to tickets page
                if (tab.id === 'tickets') {
                  setTicketsVersion(v => v + 1)
                }
                setActiveView(tab.id)
              }}
              className={`flex-1 py-3 text-sm font-medium ${activeView === tab.id ? "text-primary border-b-2 border-primary" : "text-muted-foreground"
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const embeddedCount = syncStatus?.sentWithEmbeddings ?? 0
  const pendingCount = syncStatus?.pendingReplies ?? 0
  const processedDisplay = embeddedCount
  const toastTarget = (() => {
    if (pendingCount > 0) {
      return embeddedCount + pendingCount
    }
    if (syncStatus?.queued && syncStatus.queued > 0) {
      return syncStatus.queued
    }
    if (syncTarget && syncTarget > 0) {
      return syncTarget
    }
    return embeddedCount > 0 ? embeddedCount : null
  })()

  // Check if sync is complete (not processing and no pending emails)
  const isSyncComplete = !syncStatus?.processing && !syncInProgress &&
    pendingCount === 0 &&
    processedDisplay > 0 &&
    !syncError

  // Auto-hide toast after 3 seconds when sync completes
  useEffect(() => {
    if (isSyncComplete && !hideSyncToast) {
      const timer = setTimeout(() => {
        setHideSyncToast(true)
        setSyncInProgress(false)
      }, 3000) // Hide after 3 seconds
      return () => clearTimeout(timer)
    }
  }, [isSyncComplete, hideSyncToast])

  // NEW: Trigger auto-classification after initial sync
  useEffect(() => {
    if (isSyncComplete && typeof window !== 'undefined') {
      const shouldTriggerBackfill = sessionStorage.getItem('trigger_backfill_after_sync')
      if (shouldTriggerBackfill === 'true') {
        sessionStorage.removeItem('trigger_backfill_after_sync')
        console.log('[Backfill] Initial sync complete, triggering auto-classification...')
        fetch('/api/departments/backfill', {
          method: 'POST',
          body: JSON.stringify({ limit: 10 })
        })
          .then(res => res.json())
          .then(data => {
            console.log('[Backfill] Auto-classification result:', data)
            // Refresh tickets view if we're on that screen
            if (activeView === 'tickets') {
              setTicketsVersion(v => v + 1)
            }
          })
          .catch(err => console.error('[Backfill] Auto-classification failed:', err))
      }
    }
  }, [isSyncComplete, activeView])

  // Cost guard: do not trigger backfill directly on connection.
  // Classification should happen after sync or via cron.
  useEffect(() => {
    if (typeof window === 'undefined') return
    sessionStorage.removeItem('trigger_backfill_on_connect')
  }, [isConnected])

  // NEW: Automatic periodic auto-classification (every hour)
  useEffect(() => {
    if (!isConnected) return
    
    // DISABLE on Vercel - use cron jobs instead to avoid excessive CPU usage
    if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      console.log('[Auto-Classify] Disabled in production - using cron jobs instead')
      return
    }

    const AUTO_CLASSIFY_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
    let intervalId: NodeJS.Timeout

    const runAutoClassify = async () => {
      try {
        console.log('[Auto-Classify] Running periodic auto-classification...')
        const response = await fetch('/api/departments/backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 10 }) // Cost guard for periodic runs
        })

        if (response.ok) {
          const data = await response.json()
          console.log('[Auto-Classify] Result:', data)

          // Refresh tickets view if we're on that screen
          if (activeView === 'tickets') {
            setTicketsVersion(v => v + 1)
          }
        } else {
          console.warn('[Auto-Classify] Failed:', await response.text())
        }
      } catch (error) {
        console.error('[Auto-Classify] Error:', error)
      }
    }

    // Start interval
    intervalId = setInterval(runAutoClassify, AUTO_CLASSIFY_INTERVAL_MS)

    // Run once after a delay (to avoid running on initial load, but after initial connection classification)
    const initialTimeout = setTimeout(() => {
      runAutoClassify()
    }, 10 * 60 * 1000) // Run after 10 minutes (after initial connection classification)

    return () => {
      clearInterval(intervalId)
      clearTimeout(initialTimeout)
    }
  }, [isConnected, activeView])

  const showSyncToast = ((syncStatus?.processing ?? syncInProgress) || syncError || isSyncComplete) && !hideSyncToast

  return (
    <>
      {/* Only show full layout if user is selected, otherwise show UserSelector in a centered card */}
      {/* Don't show main layout while checking auth to prevent double spinners */}
      {(!isConnected || !currentUserId || checkingAuth || (checkingUser && !currentUser)) ? (
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
          <div className="max-w-md w-full">
            {checkingAuth || checkingUser ? (
              <div className="flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-3 animate-in fade-in duration-500">
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {checkingAuth ? "Checking authentication..." : "Loading..."}
                  </p>
                </div>
              </div>
            ) : !isConnected ? (
              <div className="flex items-center justify-center h-full p-4">
                <div className="text-center">
                  <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="mt-4 text-muted-foreground">Redirecting...</p>
                </div>
              </div>
            ) : (
              <UserSelector
                onUserSelected={handleUserSelected}
                currentUserId={currentUserId}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-screen bg-background text-foreground overflow-x-hidden">
          {isConnected && (
            <Sidebar
              activeView={activeView}
              setActiveView={(view) => {
                // CRITICAL: Force fresh ticket data when navigating to tickets page
                if (view === 'tickets') {
                  setTicketsVersion(v => v + 1)
                }
                setActiveView(view)
              }}
              onLogout={handleLogout}
              currentUser={currentUser}
            />
          )}
          <div className="flex flex-col flex-1 h-full min-h-0">
            <TopNav
              isConnected={isConnected}
              userProfile={userProfile}
              currentUser={currentUser}
              onLogout={handleLogout}
              onSwitchUser={handleSwitchUser}
              onSearch={(query) => {
                setGlobalSearch(query)
              }}
              searchValue={globalSearch}
            />
            {renderMobileTabs()}
            <main className="flex-1 overflow-auto min-h-0">
              {renderView()}
            </main>
          </div>
        </div>
      )}

      {loggingOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 animate-in fade-in duration-300">
            <div className="flex gap-1.5">
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <p className="text-sm text-muted-foreground">Logging you out...</p>
          </div>
        </div>
      )}

      {showSyncToast && (
        <SyncToast
          syncing={syncInProgress}
          status={syncStatus}
          processed={processedDisplay}
          target={toastTarget}
          error={syncError}
          onDismiss={() => setHideSyncToast(true)}
        />
      )}

      {/* Personal Account Welcome Dialog */}
      <Dialog open={showPersonalAccountDialog} onOpenChange={setShowPersonalAccountDialog}>
        <DialogContent className="max-w-md text-center p-8">
          <DialogHeader>
            <div className="mx-auto w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
              <User className="w-8 h-8 text-blue-500" />
            </div>
            <DialogTitle className="text-2xl font-bold">Welcome to Personal Account!</DialogTitle>
            <DialogDescription className="text-base pt-2">
              You've successfully created your personal MailAssist account. You can now manage your emails and tickets individually.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-muted/50 rounded-xl p-4 my-6 text-left border border-border/50">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Upgrade to Business Plan
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Unlock powerful team collaboration, multiple Gmail connections, custom roles, and advanced AI automation by upgrading to our Business Plan.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 font-semibold"
              onClick={() => {
                setActiveView('settings')
                setShowPersonalAccountDialog(false)
              }}
            >
              Go to Settings & Upgrade
            </Button>
            <Button
              variant="outline"
              className="w-full h-11"
              onClick={() => setShowPersonalAccountDialog(false)}
            >
              Continue with Personal Plan
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PageContent />
    </Suspense>
  )
}
