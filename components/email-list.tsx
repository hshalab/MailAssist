"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Mail, Plus, Paperclip } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ConnectImapForm } from "./connect-imap-form"

interface Email {
  id: string
  from: string
  to: string
  subject: string
  snippet: string
  body: string
  date: string
  threadId: string
  accountEmail?: string // Legacy field
  ownerEmail?: string // New field
  departmentName?: string | null // NEW: Department name from ticket
  attachments?: { id: string; filename: string; mimeType: string; size: number }[] // Attachments
}

interface EmailListProps {
  selectedEmail: string | null
  onSelectEmail: (id: string, email?: Partial<Email>) => void
  onLoadingChange?: (loading: boolean) => void
  viewType?: "inbox" | "sent" | "spam" | "trash"
  onRefreshReady?: (refreshFn: () => void) => void
  selectedAccount?: string  // NEW: Filter by account email
  searchQuery?: string  // NEW: Search query for filtering
  hasConnectedAccounts?: boolean  // NEW: Whether user has connected accounts
}

export default function EmailList({ selectedEmail, onSelectEmail, onLoadingChange, viewType = "inbox", onRefreshReady, selectedAccount, searchQuery = "", hasConnectedAccounts = false }: EmailListProps) {
  const [emails, setEmails] = useState<Email[]>([])
  // loading state is now initialized above with showSkeleton check
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(50) // Start with 50 emails for faster initial load
  const [hasMore, setHasMore] = useState(true)
  const [showImapForm, setShowImapForm] = useState(false)
  const listContainerRef = useRef<HTMLDivElement>(null)

  // PRODUCTION FIX: Use state instead of recalculating from sessionStorage to fix race condition
  // CRITICAL: Check sessionStorage immediately on mount to catch OAuth return
  // Also check URL params for OAuth return indicators
  // Set initial loading state to true to prevent empty state flash
  const [showSkeleton, setShowSkeleton] = useState(() => {
    if (typeof window !== 'undefined') {
      // Check sessionStorage flag
      const skeletonFlag = sessionStorage.getItem('show_inbox_skeleton_on_return') === 'true'
      // Also check URL params for OAuth return
      const urlParams = new URLSearchParams(window.location.search)
      const isOAuthReturn = urlParams.get('auth') === 'success' || urlParams.get('connected') === 'true'
      return skeletonFlag || isOAuthReturn
    }
    return false
  })

  // CRITICAL: Set initial loading state to prevent empty state flash
  // Always start with loading=true to prevent empty state from flashing
  // Also check URL params immediately to catch OAuth return
  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const isOAuthReturn = urlParams.get('auth') === 'success' || urlParams.get('connected') === 'true'
      const skeletonFlag = sessionStorage.getItem('show_inbox_skeleton_on_return') === 'true'
      return isOAuthReturn || skeletonFlag || true // Always start with true
    }
    return true
  })

  // Check sessionStorage flag and URL params on mount to ensure skeleton shows immediately
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const skeletonFlag = sessionStorage.getItem('show_inbox_skeleton_on_return') === 'true'
      const urlParams = new URLSearchParams(window.location.search)
      const isOAuthReturn = urlParams.get('auth') === 'success' || urlParams.get('connected') === 'true'

      if (skeletonFlag || isOAuthReturn) {
        setShowSkeleton(true)
        setLoading(true) // Also ensure loading is true
        onLoadingChange?.(true)
      }
    }
  }, []) // Run only on mount

  // Client-side cache for email details to make clicking instant
  // PERFORMANCE: Limit cache size to prevent memory leaks
  const MAX_CACHE_SIZE = 50 // Limit to 50 emails in cache
  const emailCacheRef = useRef<Map<string, any>>(new Map())
  const prefetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // CRITICAL FIX: Track last logout timestamp to clear cache on account switch
  const [lastLogoutCheck, setLastLogoutCheck] = useState(() => {
    if (typeof window !== 'undefined') {
      return sessionStorage.getItem('logout_timestamp') || '0'
    }
    return '0'
  })

  // Clear email cache when logout is detected (account switch)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const currentLogoutTimestamp = sessionStorage.getItem('logout_timestamp') || '0'

      // If logout timestamp changed, clear all caches
      if (currentLogoutTimestamp !== lastLogoutCheck && currentLogoutTimestamp !== '0') {
        console.log('[EmailList] Logout detected, clearing email cache')
        setEmails([]) // Clear email list immediately
        emailCacheRef.current.clear() // Clear prefetch cache
        setLastLogoutCheck(currentLogoutTimestamp)

        // Clear the logout timestamp after processing to avoid repeated clears
        sessionStorage.removeItem('logout_timestamp')
      }
    }
  }, [lastLogoutCheck])

  const fetchEmails = async (newLimit = limit, isLoadMore = false, silent = false, retryCount = 0) => {
    try {
      if (!silent) {
        if (isLoadMore) {
          setLoadingMore(true)
        } else {
          setLoading(true)
        }
        onLoadingChange?.(true)
      }
      setError(null)
      let url = `/api/emails?maxResults=${newLimit}`
      if (viewType === "sent") {
        url = `/api/emails?type=sent&maxResults=${newLimit}`
      } else if (viewType === "spam") {
        // Use Gmail search query to only retrieve spam (in:spam is the standard Gmail syntax)
        url = `/api/emails?type=inbox&maxResults=${newLimit}&q=in:spam`
      } else if (viewType === "trash") {
        // Use Gmail search query to only retrieve trash (in:trash is the standard Gmail syntax)
        url = `/api/emails?type=inbox&maxResults=${newLimit}&q=in:trash`
      } else {
        // default inbox view; backend already filters out SPAM/TRASH when creating tickets
        url = `/api/emails?type=inbox&maxResults=${newLimit}`
      }

      // Add account filter if specified
      if (selectedAccount) {
        url += `&account=${encodeURIComponent(selectedAccount)}`
      }

      // Cache strategy:
      // - Initial loads: Use 'no-cache' to revalidate with server (can use stale-while-revalidate)
      // - Load more: Use 'default' to leverage browser cache for faster pagination
      // The API response includes Cache-Control headers (30s cache, 60s stale-while-revalidate)
      const response = await fetch(url, {
        cache: isLoadMore ? 'default' : 'no-cache',
        // CRITICAL: Add credentials to ensure cookies are sent
        credentials: 'include'
      })

      // PERFORMANCE: Removed retry logic - cookies should be ready before redirect
      // If 401 occurs, it's a real auth issue, not a race condition
      if (!response.ok) {
        console.error(`[EmailList] API error: ${response.status} ${response.statusText}`);

        // Try to parse error response first to check for specific error codes
        let errorData: any = null;
        try {
          errorData = await response.json();
          console.log('[EmailList] Error details:', errorData);
        } catch (e) {
          console.log('[EmailList] Could not parse error response');
        }

        // Check for TOKEN_EXPIRED first (can be 400 or 401)
        if (errorData?.code === 'TOKEN_EXPIRED') {
          setError('Gmail connection expired. Please reconnect your account in Settings.')
          return
        }

        // Check for GMAIL_NOT_CONNECTED
        if (errorData?.code === 'GMAIL_NOT_CONNECTED') {
          setError('No email accounts connected. Please connect your Gmail account.')
          return
        }

        // Generic 401 error — session expired, redirect to login
        if (response.status === 401) {
          if (typeof window !== 'undefined') {
            window.location.href = '/auth/landing?view=login'
          }
          return
        }

        // Generic error with message from server if available
        const errorMessage = errorData?.error || `Failed to fetch emails: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

      const data = await response.json()
      setEmails(data.emails || [])
      setLimit(newLimit)

      // Cache the result if this is a fresh load (not load more)
      if (!isLoadMore && data.emails?.length > 0) {
        try {
          const cacheKey = `email_list_${viewType}_${selectedAccount || 'all'}`
          sessionStorage.setItem(cacheKey, JSON.stringify({
            emails: data.emails,
            timestamp: Date.now()
          }))
        } catch (e) {
          // Ignore storage quota errors
        }
      }

      // PRODUCTION FIX: Clear skeleton AFTER emails are successfully loaded
      // This prevents the empty state from flashing before emails appear
      if (showSkeleton) {
        setShowSkeleton(false)
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('show_inbox_skeleton_on_return')
        }
      }

      // If we received at least as many as we asked for, assume there might be more
      setHasMore(Array.isArray(data.emails) && data.emails.length >= newLimit)

      // PERFORMANCE: Prefetch the first 3 emails for instant loading
      if (!isLoadMore && data.emails?.length > 0) {
        const topEmails = data.emails.slice(0, 3)
        topEmails.forEach((email: Email, idx: number) => {
          // Stagger prefetch slightly to avoid overwhelming the API
          setTimeout(() => prefetchEmailDetails(email.id), idx * 100)
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails')
      console.error('Error fetching emails:', err)
    } finally {
      if (!silent) {
        setLoading(false)
        setLoadingMore(false)
        onLoadingChange?.(false)
      }
    }
  }

  // Prefetch email details for instant loading when clicked
  const prefetchEmailDetails = async (emailId: string) => {
    // Skip if already cached
    if (emailCacheRef.current.has(emailId)) return

    try {
      const response = await fetch(`/api/emails/${emailId}`, {
        // Use force-cache to store in browser cache
        cache: 'force-cache'
      })
      if (response.ok) {
        const data = await response.json()

        // PERFORMANCE: Limit cache size - remove oldest entries if cache is full
        if (emailCacheRef.current.size >= MAX_CACHE_SIZE) {
          // Remove first (oldest) entry
          const firstKey = emailCacheRef.current.keys().next().value
          if (firstKey) {
            emailCacheRef.current.delete(firstKey)
          }
        }

        emailCacheRef.current.set(emailId, data.email)
      }
    } catch (err) {
      // Silent fail - not critical
      console.debug('Prefetch failed for', emailId, err)
    }
  }

  // Handle hover to prefetch email details
  const handleEmailHover = (emailId: string) => {
    if (prefetchTimeoutRef.current) {
      clearTimeout(prefetchTimeoutRef.current)
    }
    // Prefetch after 200ms hover to avoid prefetching on quick scrolls
    prefetchTimeoutRef.current = setTimeout(() => {
      prefetchEmailDetails(emailId)
    }, 200)
  }

  // Memoized refresh function to prevent infinite loops (silent refresh)
  const handleRefresh = useCallback(() => {
    fetchEmails(limit, false, true)
  }, [limit])

  // Expose refresh function to parent component
  useEffect(() => {
    if (onRefreshReady) {
      onRefreshReady(handleRefresh)
    }
  }, [onRefreshReady, handleRefresh])

  // Auto-poll for new emails every 30 seconds (silent refresh)
  // PERFORMANCE: Skip polling if user has an email selected (reduces load)
  useEffect(() => {
    // Don't poll if user is viewing an email (reduces unnecessary requests)
    if (selectedEmail) {
      return () => { } // Return empty cleanup function to keep dependency array consistent
    }

    const pollInterval = setInterval(() => {
      console.log('Auto-polling for new emails...')
      fetchEmails(limit, false, true)
    }, 30000) // 30 seconds

    return () => clearInterval(pollInterval)
  }, [limit, selectedEmail])

  // Initial fetch on mount and when viewType or selectedAccount changes
  useEffect(() => {
    // CRITICAL FIX: Check for skeleton flag FIRST before any other logic
    let hasSkeletonFlag = false
    if (typeof window !== 'undefined') {
      hasSkeletonFlag = sessionStorage.getItem('show_inbox_skeleton_on_return') === 'true'
      if (hasSkeletonFlag) {
        setShowSkeleton(true)
        setLoading(true) // Also set loading to ensure skeleton shows
        onLoadingChange?.(true)
      }
    }

    // CHECK CACHE FIRST
    const cacheKey = `email_list_${viewType}_${selectedAccount || 'all'}`
    let cachedData = null
    try {
      const cached = sessionStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached)
        // 1 minute cache validity
        if (Date.now() - parsed.timestamp < 60000) {
          cachedData = parsed.emails
        }
      }
    } catch (e) {
      console.error('Error reading email cache:', e)
    }

    if (cachedData && !hasSkeletonFlag) {
      console.log('Using cached email list for', viewType)
      setEmails(cachedData)
      setLoading(false)
      onLoadingChange?.(false)
      setShowSkeleton(false)
      setHasMore(true) // Assume there's more if we have cached data
      // Silently refresh in background to ensure freshness
      setTimeout(() => fetchEmails(50, false, true), 1000)
      return
    }

    // Ensure loading state is explicitly set to true before any async operations
    setLoading(true)
    onLoadingChange?.(true)
    // Only clear emails if we don't have cache (to avoid flash)
    if (!cachedData) setEmails([])
    setError(null)
    setLimit(50)
    setHasMore(true)

    // Use requestAnimationFrame + setTimeout to ensure React has fully rendered
    let rafId: number
    let timeoutId: NodeJS.Timeout

    rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        timeoutId = setTimeout(() => {
          fetchEmails(50)
        }, 0)
      })
    })

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (timeoutId) clearTimeout(timeoutId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewType, selectedAccount])

  // Listen for account changes to refresh emails
  // This ensures ALL users (agents, managers, admins) see the changes
  useEffect(() => {
    const handleAccountsChanged = () => {
      console.log('[EmailList] Accounts changed event received, refreshing emails')
      // Clear emails and refetch
      setEmails([])
      setLoading(true)
      fetchEmails(150)
    }

    // Also listen for storage events (cross-tab communication)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'accountsChanged') {
        console.log('[EmailList] Accounts changed detected via storage event, refreshing')
        setEmails([])
        setLoading(true)
        fetchEmails(150)
      }
    }

    window.addEventListener('accountsChanged', handleAccountsChanged)
    window.addEventListener('storage', handleStorageChange)

    // Check on mount if accounts changed
    const checkAccountsChanged = () => {
      const accountsChanged = localStorage.getItem('accountsChanged')
      if (accountsChanged) {
        setEmails([])
        setLoading(true)
        fetchEmails(150)
        localStorage.removeItem('accountsChanged')
      }
    }
    checkAccountsChanged()

    return () => {
      window.removeEventListener('accountsChanged', handleAccountsChanged)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, []) // Only set up listener once

  // Auto-load more when scrolling near bottom
  useEffect(() => {
    const container = listContainerRef.current?.closest('.overflow-y-auto')
    if (!container) return

    const handleScroll = () => {
      if (loadingMore || !hasMore) return
      const { scrollTop, scrollHeight, clientHeight } = container as HTMLElement
      // Load more when within 200px of bottom
      if (scrollHeight - scrollTop - clientHeight < 200) {
        handleLoadMore()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [loadingMore, hasMore, limit])

  const handleLoadMore = () => {
    if (loadingMore) return
    const nextLimit = limit + 50 // Load 50 more at a time
    fetchEmails(nextLimit, true)
  }

  const handleConnectGmail = async () => {
    try {
      // CRITICAL FIX: Pass reconnect=true when reconnecting after token expiration
      // This forces consent screen to get a new refresh token
      // For normal connections, mode=connect is sufficient
      const isReconnecting = error?.includes('expired') || error?.includes('reconnect')
      const url = isReconnecting
        ? '/api/auth/gmail?mode=connect&reconnect=true'
        : '/api/auth/gmail?mode=connect'

      const response = await fetch(url)
      if (!response.ok) throw new Error('Failed to get auth URL')
      const { authUrl } = await response.json()
      window.location.href = authUrl
    } catch (error) {
      console.error('Error connecting Gmail:', error)
      alert('Failed to connect Gmail. Please try again.')
    }
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 60) return `${diffMins}m`
      if (diffHours < 24) return `${diffHours}h`
      if (diffDays < 7) return `${diffDays}d`
      return date.toLocaleDateString()
    } catch {
      return dateString
    }
  }

  // CRITICAL FIX: Show skeleton if loading OR if skeleton flag is set (returning from OAuth)
  // PRIORITY: showSkeleton flag takes highest priority - if set, ALWAYS show skeleton
  // This ensures skeleton shows immediately when returning from OAuth, even before accounts load
  // Also show skeleton if accounts are still loading (hasConnectedAccounts === undefined) OR we're actively loading
  // CRITICAL: Check URL params for OAuth return to ensure skeleton shows even if sessionStorage was cleared
  // PRODUCTION FIX: Only show skeleton if we're actually loading - don't show if emails are loaded and loading is false
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const isOAuthReturn = urlParams?.get('auth') === 'success' || urlParams?.get('connected') === 'true'
  // Only show skeleton if: skeleton flag is set, OAuth return, actively loading, OR accounts still loading AND no emails yet
  const shouldShowSkeleton = (showSkeleton || isOAuthReturn || loading || (hasConnectedAccounts === undefined && emails.length === 0)) && !loadingMore;
  if (shouldShowSkeleton) {
    return (
      <div className="p-3 space-y-2 animate-in fade-in duration-300" style={{ paddingTop: '0.75rem' }}>
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div
            key={i}
            className="relative w-full rounded-xl border border-border/40 bg-gradient-to-br from-card via-card to-muted/5 overflow-hidden"
            style={{ animationDelay: `${i * 30}ms`, borderRadius: '0.75rem', overflow: 'hidden' }}
          >
            {/* Shimmer effect overlay */}
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            <div className="flex gap-3 p-3 relative">
              {/* Avatar Skeleton */}
              <div className="w-10 h-10 rounded-full bg-muted/80 flex-shrink-0 shadow-sm" />

              {/* Content Skeleton */}
              <div className="flex-1 min-w-0 space-y-2">
                {/* Row 1: Name and Time */}
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 bg-muted/70 rounded-md w-32" />
                  <div className="h-3 bg-muted/50 rounded w-12" />
                </div>

                {/* Row 2: Subject */}
                <div className="h-4 bg-muted/70 rounded-md w-3/4" />

                {/* Row 3: Snippet */}
                <div className="space-y-1.5">
                  <div className="h-3 bg-muted/50 rounded w-full" />
                  <div className="h-3 bg-muted/50 rounded w-2/3" />
                </div>

                {/* Row 4: Badges */}
                <div className="flex items-center gap-1.5 pt-1">
                  <div className="h-4 bg-muted/40 rounded-md w-20" />
                  <div className="h-5 bg-muted/40 rounded-md w-24" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error && !loadingMore) {
    // Special handling for token expiration - show reconnect UI
    if (error.includes('expired') || error.includes('reconnect')) {
      return (
        <div className="flex items-center justify-center p-12 animate-in fade-in duration-300">
          <div className="text-center space-y-5 max-w-md">
            <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-yellow-500/15 via-orange-500/10 to-yellow-500/5 flex items-center justify-center mx-auto shadow-lg border-2 border-yellow-500/20">
              <svg className="w-12 h-12 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="space-y-3">
              <div className="text-base font-bold text-foreground">Gmail Connection Expired</div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your Gmail access token has expired or been revoked. This can happen if you changed your password, manually revoked access, or the token hasn't been used in 6 months.
              </p>
              <div className="pt-2">
                <Button onClick={handleConnectGmail} className="w-full">
                  <Mail className="mr-2 h-4 w-4" />
                  Reconnect Gmail Account
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    // Generic error display
    return (
      <div className="flex items-center justify-center p-12 animate-in fade-in duration-300">
        <div className="text-center space-y-5 max-w-sm">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-destructive/15 via-destructive/10 to-destructive/5 flex items-center justify-center mx-auto shadow-lg border-2 border-destructive/20">
            <svg className="w-12 h-12 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="space-y-3">
            <div className="text-base font-bold text-destructive">Failed to load emails</div>
            <p className="text-sm text-muted-foreground leading-relaxed">{error}</p>
            <button
              onClick={() => fetchEmails()}
              className="text-sm text-primary hover:underline font-semibold mt-2"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // CRITICAL FIX: Don't show "No emails found" if we're still loading OR have skeleton flag
  // The skeleton flag takes priority - it means we're returning from OAuth and emails are loading
  // If we have connected accounts but emails are empty, we might still be loading (show skeleton)
  // Only show empty state if we're completely done loading AND don't have skeleton flag
  // AND either we have no connected accounts OR we've confirmed emails are actually empty (not just loading)
  // CRITICAL: Never show empty state if skeleton flag is set (returning from OAuth) OR accounts are still loading
  // This prevents the "Connect Gmail" button from flashing before skeleton appears
  if (emails.length === 0 && !loadingMore && !showSkeleton && !loading && hasConnectedAccounts !== undefined) {
    // If hasConnectedAccounts is true and no error, we might still be loading - skeleton handles this above
    // Only show empty state if we explicitly know there are no connected accounts OR we have an error
    if (hasConnectedAccounts !== false && error === null) {
      // Still might be loading - show skeleton as fallback to prevent flash
      return (
        <div className="p-3 space-y-2 animate-in fade-in duration-300" style={{ paddingTop: '0.75rem' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div
              key={i}
              className="relative w-full rounded-xl border border-border/40 bg-gradient-to-br from-card via-card to-muted/5 overflow-hidden"
              style={{ animationDelay: `${i * 30}ms`, borderRadius: '0.75rem', overflow: 'hidden' }}
            >
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              <div className="flex gap-3 p-3 relative">
                <div className="w-10 h-10 rounded-full bg-muted/80 flex-shrink-0 shadow-sm" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-4 bg-muted/70 rounded-md w-32" />
                    <div className="h-3 bg-muted/50 rounded w-12" />
                  </div>
                  <div className="h-4 bg-muted/70 rounded-md w-3/4" />
                  <div className="space-y-1.5">
                    <div className="h-3 bg-muted/50 rounded w-full" />
                    <div className="h-3 bg-muted/50 rounded w-2/3" />
                  </div>
                  <div className="flex items-center gap-1.5 pt-1">
                    <div className="h-4 bg-muted/40 rounded-md w-20" />
                    <div className="h-5 bg-muted/40 rounded-md w-24" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    // Check if we are filtering by a specific account
    const isFiltering = !!selectedAccount;

    // Only show "Connect Gmail" button if:
    // 1. We're in inbox view
    // 2. Not filtering by account
    // 3. We explicitly know there are NO connected accounts (hasConnectedAccounts is false)
    // If hasConnectedAccounts is true or undefined (still loading), don't show connect button
    const shouldShowConnectButton = viewType === 'inbox' && !isFiltering && hasConnectedAccounts === false;

    return (
      <div className="flex items-center justify-center p-12 animate-in fade-in duration-300">
        <div className="text-center space-y-5 max-w-sm">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/15 via-accent/10 to-primary/5 flex items-center justify-center mx-auto shadow-lg border-2 border-primary/20">
            <svg className="w-12 h-12 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="space-y-3">
            <div className="text-base font-bold text-foreground">No emails found</div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {isFiltering
                ? `No emails found for ${selectedAccount}. Try checking another filter or refresh the page.`
                : viewType === 'inbox'
                  ? hasConnectedAccounts
                    ? "Your inbox is empty. New emails will appear here."
                    : "Connect your Gmail account to see your emails here."
                  : "Try checking another folder or refresh the page"}
            </p>
            {shouldShowConnectButton && (
              <div className="flex gap-2 justify-center mt-2">
                <Button onClick={handleConnectGmail}>
                  <Mail className="mr-2 h-4 w-4" />
                  Connect Gmail
                </Button>
                <Button variant="outline" onClick={() => setShowImapForm(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Connect Other
                </Button>
              </div>
            )}

            <Dialog open={showImapForm} onOpenChange={setShowImapForm}>
              <DialogContent className="max-w-md text-left">
                <DialogHeader>
                  <DialogTitle>Connect Email Account</DialogTitle>
                  <DialogDescription>
                    Connect any email provider using IMAP/SMTP
                  </DialogDescription>
                </DialogHeader>
                <ConnectImapForm
                  onSuccess={() => {
                    setShowImapForm(false)
                    fetchEmails()
                  }}
                  onCancel={() => setShowImapForm(false)}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>
    )
  }

  const getInitials = (from: string) => {
    // Strip quotes and get name part before email
    const name = from.split("<")[0].trim().replace(/["']/g, "") || from.replace(/["']/g, "");
    // Get first letter of each word, filtering out non-letters
    const initials = name.split(" ").map(n => n.replace(/[^a-zA-Z]/g, "")[0] || "").filter(Boolean).join("").slice(0, 2).toUpperCase();
    return initials || "?";
  };

  const getAvatarColor = (from: string) => {
    const colors = [
      "bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-green-500",
      "bg-yellow-500", "bg-red-500", "bg-indigo-500", "bg-teal-500"
    ];
    const hash = from.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  };

  // Filter emails based on search query
  const filteredEmails = searchQuery
    ? emails.filter(email =>
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.snippet.toLowerCase().includes(searchQuery.toLowerCase())
    )
    : emails

  return (
    <div className="p-3 space-y-2 overflow-x-hidden max-w-full" style={{ paddingTop: '0.75rem' }}>
      {filteredEmails.map((email, index) => (
        <button
          key={`${email.id}-${index}`}
          onClick={() => {
            // Get cached full email data if available
            const cachedEmail = emailCacheRef.current.get(email.id)
            onSelectEmail(email.id, {
              subject: email.subject,
              from: email.from,
              to: email.to,
              date: email.date,
              snippet: email.snippet,
              body: cachedEmail?.body || email.body,
              threadId: email.threadId,
              departmentName: email.departmentName,
              attachments: cachedEmail?.attachments,
            })
          }}
          onMouseEnter={() => handleEmailHover(email.id)}
          onMouseLeave={() => {
            if (prefetchTimeoutRef.current) {
              clearTimeout(prefetchTimeoutRef.current)
            }
          }}
          className={`w-full text-left rounded-xl transition-all duration-200 ease-out border animate-in fade-in slide-in-from-left-2 group relative overflow-hidden ${selectedEmail === email.id
            ? "border-primary/50 bg-accent/10 shadow-lg ring-1 ring-primary/20"
            : "border-border/40 hover:border-primary/30 hover:bg-accent/5 hover:shadow-md bg-card/80"
            }`}
          style={{ animationDelay: `${index * 15}ms` }}
        >
          <div className="flex gap-3 p-3 relative z-10">
            {/* Avatar */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0 ${getAvatarColor(email.from)
              } shadow-md`}>
              {getInitials(email.from)}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 space-y-2">
              {/* Row 1: Sender name and time */}
              <div className="flex items-center justify-between gap-2">
                <h3 className={`font-semibold text-sm truncate transition-colors flex-1 min-w-0 ${selectedEmail === email.id ? "text-primary" : "text-foreground group-hover:text-primary"
                  }`}>
                  {(() => {
                    // Get current user email from session storage if available
                    const currentUserEmail = typeof window !== 'undefined' ? sessionStorage.getItem('current_user_email') : null;

                    // Check if the email is from the current user
                    if (currentUserEmail && email.from.includes(currentUserEmail)) {
                      return "Me";
                    }

                    // Parse the from field
                    const nameMatch = email.from.match(/^"?(.*?)"? <.*>$/);
                    if (nameMatch && nameMatch[1]) {
                      return nameMatch[1];
                    }

                    // If no name, format the email address
                    const emailAddress = email.from.replace(/[<>]/g, '');
                    const localPart = emailAddress.split('@')[0];

                    // Convert "john.doe" to "John Doe"
                    if (localPart) {
                      return localPart
                        .split(/[._]/)
                        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
                        .join(' ');
                    }

                    return emailAddress;
                  })()}
                </h3>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-xs text-muted-foreground/80 font-medium tabular-nums">
                    {formatDate(email.date)}
                  </span>
                  {selectedEmail === email.id && (
                    <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  )}
                </div>
              </div>

              {/* Row 2: Subject */}
              <p className="text-sm font-medium text-foreground/90 line-clamp-1 leading-tight">
                {email.subject || "(No subject)"}
              </p>

              {/* Row 3: Snippet */}
              <p className="text-xs text-muted-foreground/70 line-clamp-1 leading-relaxed">
                {email.snippet || "No preview available"}
              </p>

              {/* Row 4: Badges */}
              <div className="flex items-center gap-1.5 pt-1">
                {email.ownerEmail && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/50 text-muted-foreground/80 font-medium max-w-[100px] truncate"
                    title={`Received by ${email.ownerEmail}`}
                  >
                    {email.ownerEmail.split('@')[0]}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className={`text-[10px] h-5 px-2 font-medium ${email.departmentName
                    ? "bg-primary/10 text-primary border-primary/20"
                    : "bg-muted/30 text-muted-foreground/70 border-border/30"
                    }`}
                >
                  {email.departmentName || "No Department"}
                </Badge>
                {email.attachments && email.attachments.length > 0 && (
                  <div
                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                    title={`${email.attachments.length} attachment${email.attachments.length > 1 ? 's' : ''}`}
                  >
                    <Paperclip className="w-3 h-3" />
                    <span className="font-medium">{email.attachments.length}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </button>
      ))}

      {hasMore && (
        <div className="flex justify-center p-4 pt-6">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="text-sm px-8 py-3 rounded-xl border-2 border-border/60 bg-card text-primary hover:bg-accent/10 hover:border-primary/60 hover:shadow-lg transition-colors duration-200 ease-out disabled:opacity-60 disabled:cursor-not-allowed font-semibold"
          >
            {loadingMore ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Loading more...
              </div>
            ) : (
              "Load more emails"
            )}
          </button>
        </div>
      )}
    </div>
  )
}
