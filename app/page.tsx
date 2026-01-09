"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
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
  const [syncContinueCount, setSyncContinueCount] = useState(0) // Safety counter
  const LOCAL_STORAGE_KEY = "gmail_connected"
  const [loggingOut, setLoggingOut] = useState(false)
  const [globalSearch, setGlobalSearch] = useState<string>("")
  const [deepLinkTicketId, setDeepLinkTicketId] = useState<string | null>(null)
  const [ticketNavKey, setTicketNavKey] = useState(0) // Force re-selection on navigation
  const [showPersonalAccountDialog, setShowPersonalAccountDialog] = useState(false)
  const searchParams = useSearchParams()

  useEffect(() => {
    checkAuthStatus()
    checkUserSelection()

    const params = new URLSearchParams(window.location.search)
    if (params.get("auth") === "success") {
      setIsConnected(true)
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, "true")
      } catch {
        // Ignore localStorage errors (e.g. in private mode)
      }

      if (params.get("newAccount") === "true") {
        setShowPersonalAccountDialog(true)
        // Trigger sync and auto-classification for new accounts
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('trigger_sync_after_connect', 'true')
          sessionStorage.setItem('trigger_backfill_after_sync', 'true')
        }
      }

      window.history.replaceState({}, "", window.location.pathname)
      // After Gmail auth, check if user is selected
      checkUserSelection()
      return
    }

    // Check if user came from business auth
    const businessAuth = params.get("businessAuth")
    if (businessAuth === "true") {
      setIsConnected(true)
      checkUserSelection()
      window.history.replaceState({}, "", window.location.pathname)
      return
    }

    // Check if user just connected Gmail (from connect mode)
    const justConnected = params.get("connected")
    if (justConnected === "true") {
      setIsConnected(true)
      // Store flag to trigger sync and auto-classification after component is ready
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('trigger_sync_after_connect', 'true')
        sessionStorage.setItem('trigger_backfill_after_sync', 'true')
      }
      window.history.replaceState({}, "", window.location.pathname)
      return
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
  }, [])

  // Listen to ticketId in the URL to deep-link into a specific ticket from notifications
  useEffect(() => {
    const ticketId = searchParams.get("ticketId")
    if (ticketId) {
      setActiveView("tickets")
      setDeepLinkTicketId(ticketId)
      setTicketNavKey(prev => prev + 1) // Increment to force re-selection
    }
  }, [searchParams])

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

  // Re-check admin status when currentUser changes
  useEffect(() => {
    if (currentUser && isConnected) {
      checkAdminExists()
    }
  }, [currentUser, isConnected])

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

      // First check sessionStorage (per-tab)
      // But verify with API to ensure user belongs to current Gmail account
      if (typeof window !== "undefined") {
        const storedUserId = sessionStorage.getItem("current_user_id")
        const storedUserName = sessionStorage.getItem("current_user_name")
        const storedUserRole = sessionStorage.getItem("current_user_role")
        const storedBusinessId = sessionStorage.getItem("current_user_business_id")

        if (storedUserId && storedUserName && storedUserRole) {
          // Verify user still belongs to current account
          const verifyResponse = await fetch("/api/auth/current-user")
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
      const response = await fetch("/api/auth/current-user")
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
        }
      } else if (response.status === 403 || response.status === 404) {
        // User doesn't belong to current account or not found - clear sessionStorage
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("current_user_id")
          sessionStorage.removeItem("current_user_name")
          sessionStorage.removeItem("current_user_role")
          sessionStorage.removeItem("current_user_business_id")
        }
        setCurrentUserId(null)
        setCurrentUser(null)
      }
      // If 404, no user selected - that's okay, we'll show selector
    } catch {
      // Ignore errors
    } finally {
      setCheckingUser(false)
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
      setSyncStatus(data)
      if (typeof data.processing === "boolean") {
        setSyncInProgress(data.processing)
        if (!data.processing) {
          setSyncTarget(null)
          setSyncBaseline(0)
        } else if (typeof data.queued === "number") {
          setSyncTarget(data.queued)
        }
      }
      return data
    } catch {
      return null
    }
  }, [isConnected])

  const startSync = useCallback(
    async (maxResults = 300) => {
      if (!isConnected) throw new Error("Connect Gmail first to sync emails.")
      setSyncError(null)
      setHideSyncToast(false)

      const response = await fetch(`/api/emails/sync?maxResults=${maxResults}`, { method: "POST" })
      const data = await response.json().catch(() => ({}))

      if (response.status === 202 && data?.processing) {
        setSyncInProgress(true)
        setSyncTarget(data.queued ?? syncTarget ?? maxResults)
        setSyncBaseline(syncStatus?.sentWithEmbeddings ?? 0)
        return
      }

      if (!response.ok) {
        const message = data?.error || "Failed to start sync"
        setSyncInProgress(false)
        setSyncTarget(null)
        setSyncBaseline(0)
        setSyncError(message)
        throw new Error(message)
      }

      const baseline = syncStatus?.sentWithEmbeddings ?? 0
      setSyncBaseline(baseline)
      setSyncTarget(data?.queued ?? maxResults)
      setSyncInProgress(true)
      await fetchSyncStatus()

      if (data?.continue) {
        setSyncContinueCount(prev => prev + 1)
        setTimeout(() => {
          startSync(maxResults)
        }, 1000)
      } else if (!data?.continue) {
        // Reset counter when sync completes
        setSyncContinueCount(0)
      }
    },
    [isConnected, syncStatus, fetchSyncStatus, syncTarget]
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
  }, [isConnected, hasAutoSynced, fetchSyncStatus, startSync])

  const shouldPoll = syncInProgress || (syncStatus?.processing ?? false)

  useEffect(() => {
    if (!shouldPoll) return

    const interval = setInterval(() => {
      fetchSyncStatus()
    }, 5000)

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
  }, [isConnected, syncStatus?.processing, syncInProgress, startSync])

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
          setIsConnected(false)
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
      // Clear sessionStorage for this tab
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("current_user_id")
        sessionStorage.removeItem("current_user_name")
        sessionStorage.removeItem("current_user_role")
        sessionStorage.removeItem("current_user_business_id")
        sessionStorage.removeItem("current_user_email")
        // Clear localStorage items that may contain stale email references
        localStorage.removeItem("inbox_selected_account")
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
            key={currentUserId || "no-user"}
            currentUserId={currentUserId}
            currentUserRole={currentUser?.role as "admin" | "manager" | "agent" | null}
            globalSearchTerm={globalSearch}
            onClearGlobalSearch={() => setGlobalSearch("")}
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
              onClick={() => setActiveView(tab.id)}
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
          body: JSON.stringify({ limit: 50 })
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

  const showSyncToast = ((syncStatus?.processing ?? syncInProgress) || syncError || isSyncComplete) && !hideSyncToast

  return (
    <>
      {/* Only show full layout if user is selected, otherwise show UserSelector in a centered card */}
      {(!isConnected || !currentUserId || (checkingUser && !currentUser)) ? (
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
              // Redirect to welcome page when not connected at all
              <div className="flex items-center justify-center h-full p-4">
                {(() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/welcome'
                  }
                  return (
                    <div className="text-center">
                      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="mt-4 text-muted-foreground">Redirecting...</p>
                    </div>
                  )
                })()}
              </div>
            ) : (
              // Show UserSelector when connected but no user selected
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
              setActiveView={setActiveView}
              onLogout={handleLogout}
              currentUser={currentUser}
            />
          )}
          <div className="flex flex-col flex-1 min-h-0">
            <TopNav
              isConnected={isConnected}
              userProfile={userProfile}
              currentUser={currentUser}
              onLogout={handleLogout}
              onSwitchUser={handleSwitchUser}
              onSearch={(query) => {
                setGlobalSearch(query)
              }}
            />
            {renderMobileTabs()}
            <main className="flex-1 overflow-auto">
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
    <Suspense fallback={<div className="flex items-center justify-center h-screen"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>}>
      <PageContent />
    </Suspense>
  )
}
