"use client"

import { useState, useEffect, useCallback } from "react"
import EmailList from "@/components/email-list"
import EmailDetail from "@/components/email-detail"
import ShopifySidebar from "@/components/shopify-sidebar"
import { Button } from "@/components/ui/button"
import { RefreshCw, Mail } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface InboxViewProps {
  selectedEmail: string | null
  onSelectEmail: (id: string | null, emailData?: {
    subject?: string
    from?: string
    to?: string
    date?: string
    snippet?: string
    body?: string
    threadId?: string
  }) => void
  onDraftGenerated?: () => void
  viewType?: "inbox" | "sent" | "spam" | "trash"
  selectedAccount?: string | null  // Filter by account
  globalSearchTerm?: string  // Global search from top nav
}

interface ConnectedAccount {
  email: string
  provider: string
}

export default function InboxView({ selectedEmail, onSelectEmail, onDraftGenerated, viewType = "inbox", selectedAccount: propSelectedAccount, globalSearchTerm }: InboxViewProps) {
  const [listLoading, setListLoading] = useState(true)
  const [selectedEmailData, setSelectedEmailData] = useState<{
    subject?: string
    from?: string
    to?: string
    date?: string
    snippet?: string
    body?: string
    threadId?: string
  } | null>(null)
  const [showShopifySidebar, setShowShopifySidebar] = useState(false)
  const [ticketId, setTicketId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [emailListRefresh, setEmailListRefresh] = useState<(() => void) | null>(null)
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true) // Track if accounts are still loading
  // Always start with 'all' - no localStorage persistence to avoid stale data issues
  const [selectedAccount, setSelectedAccount] = useState<string>(propSelectedAccount || 'all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(Date.now())
  const showDetail = Boolean(selectedEmail)

  // Sync global search to local search query
  useEffect(() => {
    if (globalSearchTerm !== undefined) {
      setSearchQuery(globalSearchTerm)
    }
  }, [globalSearchTerm])

  // Fetch connected accounts
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        setAccountsLoading(true)
        // Add cache-busting and no-cache to prevent stale data after login/logout
        const res = await fetch(`/api/auth/accounts?_=${Date.now()}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          }
        })
        if (res.ok) {
          const data = await res.json()
          setConnectedAccounts(data.accounts || [])
        }
      } catch (error) {
        console.error('Failed to fetch accounts:', error)
      } finally {
        setAccountsLoading(false)
      }
    }
    fetchAccounts()
    
    // Listen for account changes (e.g., after disconnecting)
    // This ensures ALL users (agents, managers, admins) see the changes
    const handleAccountsChanged = () => {
      console.log('[InboxView] Accounts changed event received, refreshing accounts list')
      fetchAccounts()
      // Also check localStorage for cross-tab communication
      const accountsChanged = localStorage.getItem('accountsChanged')
      if (accountsChanged) {
        console.log('[InboxView] Accounts changed detected via localStorage, refreshing')
        fetchAccounts()
        localStorage.removeItem('accountsChanged')
      }
    }
    
    window.addEventListener('accountsChanged', handleAccountsChanged)
    
    // Also listen for storage events (cross-tab communication)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'accountsChanged') {
        console.log('[InboxView] Accounts changed detected via storage event, refreshing')
        fetchAccounts()
      }
    }
    
    window.addEventListener('storage', handleStorageChange)
    
    // Check on mount if accounts changed
    const checkAccountsChanged = () => {
      const accountsChanged = localStorage.getItem('accountsChanged')
      if (accountsChanged) {
        fetchAccounts()
        localStorage.removeItem('accountsChanged')
      }
    }
    checkAccountsChanged()
    
    return () => {
      window.removeEventListener('accountsChanged', handleAccountsChanged)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  // Fetch ticket for the selected email
  useEffect(() => {
    const fetchTicket = async () => {
      if (!selectedEmailData?.threadId) {
        setTicketId(null)
        return
      }

      try {
        console.log('Fetching ticket for threadId:', selectedEmailData.threadId)
        const response = await fetch(`/api/tickets?threadId=${encodeURIComponent(selectedEmailData.threadId)}`)
        if (response.ok) {
          const data = await response.json()
          const ticket = data.tickets?.[0]
          console.log('Found ticket:', ticket?.id, 'status:', ticket?.status)
          setTicketId(ticket?.id || null)
        } else {
          console.log('No ticket found or error response')
          setTicketId(null)
        }
      } catch (error) {
        console.error('Error fetching ticket:', error)
        setTicketId(null)
      }
    }

    fetchTicket()
  }, [selectedEmailData?.threadId])

  // Listen for ticket updates from Send & Close
  useEffect(() => {
    const handleTicketUpdate = () => {
      console.log('📨 Inbox received ticket update, silently refreshing list...')
      if (emailListRefresh) {
        emailListRefresh()
      }
    }

    window.addEventListener('ticketUpdated', handleTicketUpdate)
    window.addEventListener('ticketsForceRefresh', handleTicketUpdate)

    return () => {
      window.removeEventListener('ticketUpdated', handleTicketUpdate)
      window.removeEventListener('ticketsForceRefresh', handleTicketUpdate)
    }
  }, [emailListRefresh])

  // Handle email selection with data
  const handleSelectEmail = (id: string | null, emailData?: {
    subject?: string
    from?: string
    to?: string
    date?: string
    snippet?: string
    body?: string
    threadId?: string
  }) => {
    setSelectedEmailData(emailData || null)
    onSelectEmail(id, emailData)
  }

  // When switching between Inbox/Sent/Spam/Trash, clear the current selection
  // so the detail view doesn't show stale data from the previous view.
  useEffect(() => {
    onSelectEmail(null)
  }, [viewType, onSelectEmail])

  // Auto-refresh every 30 seconds to pick up department classifications
  // PERFORMANCE: Skip auto-refresh if user has an email selected (reduces load)
  useEffect(() => {
    // Don't auto-refresh if user is viewing an email (reduces unnecessary requests)
    if (selectedEmail) {
      return () => {} // Return empty cleanup function to keep dependency array consistent
    }

    const interval = setInterval(() => {
      if (emailListRefresh && !listLoading) {
        emailListRefresh()
        setLastRefreshTime(Date.now())
      }
    }, 30000) // 30 seconds

    return () => clearInterval(interval)
  }, [emailListRefresh, listLoading, selectedEmail])

  // Memoized callback to prevent infinite loops
  const handleRefreshReady = useCallback((refreshFn: () => void) => {
    setEmailListRefresh(() => refreshFn)
  }, [])

  return (
    <div className="flex flex-col md:flex-row h-full bg-muted/20 overflow-hidden">
      <div
        className={`border-b md:border-b-0 md:border-r border-border bg-background overflow-hidden flex flex-col transition-all duration-300 flex-shrink-0 ${showDetail ? "hidden md:flex md:w-96" : "flex w-full md:w-96"
          }`}
      >
        <div className="bg-card border-b border-border px-6 py-5 flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-xl font-bold capitalize text-foreground">{viewType || "Inbox"}</h2>
              <p className="text-sm text-muted-foreground mt-1">Manage your messages</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Account Filter Dropdown */}
              {connectedAccounts.length > 0 && (
                <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                  <SelectTrigger className="w-[200px] h-9">
                    <Mail className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="All Accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {/* Deduplicate accounts by email to prevent duplicate key errors */}
                    {Array.from(new Map(connectedAccounts.map(a => [a.email, a])).values()).map((account, idx) => (
                      <SelectItem key={`${account.email}-${idx}`} value={account.email}>
                        {account.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRefreshing(true)
                  if (emailListRefresh) {
                    emailListRefresh()
                  }
                  setTimeout(() => setRefreshing(false), 1000)
                }}
                disabled={refreshing}
                className="h-8 w-8 p-0"
                title="Refresh emails"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0" style={{ paddingTop: '0.75rem' }}>
          <EmailList
            selectedEmail={selectedEmail}
            onSelectEmail={handleSelectEmail}
            onLoadingChange={setListLoading}
            viewType={viewType}
            onRefreshReady={handleRefreshReady}
            selectedAccount={selectedAccount === 'all' ? undefined : selectedAccount}
            searchQuery={searchQuery}
            hasConnectedAccounts={accountsLoading ? undefined : (connectedAccounts.length > 0 ? true : false)}
          />
        </div>
      </div>

      <div className={`flex-1 overflow-hidden flex flex-col ${showDetail ? "flex" : "hidden md:flex"}`}>
        {selectedEmail ? (
          <EmailDetail
            emailId={selectedEmail}
            ticketId={ticketId}
            onDraftGenerated={onDraftGenerated}
            onBack={() => {
              setSelectedEmailData(null)
              onSelectEmail(null)
            }}
            initialEmailData={selectedEmailData || undefined}
            onToggleShopify={(email) => {
              setShowShopifySidebar(!showShopifySidebar)
            }}
            showShopifySidebar={showShopifySidebar}
            hideCloseButton={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full px-8 py-12 bg-muted/10">
            <div className="text-center space-y-5 max-w-md">
              <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/15 via-accent/10 to-primary/5 flex items-center justify-center mx-auto border-2 border-primary/20 shadow-lg">
                <svg
                  className="w-12 h-12 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="space-y-3">
                <h3 className="text-lg font-bold text-foreground">Select an email to get started</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">Choose a message from the list to view the conversation and generate AI-powered replies</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Shopify Sidebar */}
      {
        showShopifySidebar && selectedEmailData && (
          <div className="w-80 border-l border-border bg-background overflow-hidden flex-shrink-0">
            <ShopifySidebar
              customerEmail={selectedEmailData.from || ''}
              onClose={() => setShowShopifySidebar(false)}
            />
          </div>
        )
      }
    </div >
  )
}
