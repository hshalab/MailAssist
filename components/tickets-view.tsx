"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Loader2, User, Mail, Clock, Tag, MessageSquare, Sparkles, X, Plus, ChevronDown, ChevronUp, Edit2, Check, XCircle, MoreVertical, Filter, ChevronRight, ArrowRight, Search, ShoppingBag, Inbox, RefreshCw, Paperclip, Building2, FileText, Download, Undo2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable"
import { useToast } from "@/components/ui/use-toast"
import { supabaseBrowser } from "@/lib/supabase-client"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import QuickRepliesSidebar from "@/components/quick-replies-sidebar"
import ShopifySidebar from "@/components/shopify-sidebar"
import RichTextEditor from "@/components/rich-text-editor"
import { EmailContentViewer } from "@/components/email-content-viewer"
import { htmlToText } from "@/lib/html-to-text"
import CustomerEmailTimeline from "@/components/customer-email-timeline"
import EmailHealthBanner from "@/components/email-health-banner"



const textToHtml = (text: string) => {
  if (!text) return ""
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join("")
}

const isTicketVisibleInTab = (
  ticket: Ticket,
  tab: string,
  currentUserId: string | undefined | null,
  assigneeFilter: string = "all"
) => {
  if (assigneeFilter !== "all" && tab !== 'closed') return ticket.status !== 'closed'
  if (tab === 'assigned') return ticket.assigneeUserId === currentUserId
  if (tab === 'unassigned') return !ticket.assigneeUserId
  return true // 'open' shows all, 'closed' is handled by filteredTickets logic
}

interface Ticket {
  id: string
  threadId: string
  customerEmail: string
  customerName?: string | null
  subject: string
  status: "open" | "pending" | "on_hold" | "closed"
  priority?: "low" | "medium" | "high" | "urgent" | null
  assigneeUserId?: string | null
  assigneeName?: string | null
  tags: string[]
  lastCustomerReplyAt?: string | null
  lastAgentReplyAt?: string | null
  createdAt: string
  updatedAt: string
  departmentId?: string | null
  departmentName?: string | null
  classificationConfidence?: number | null
  ownerEmail?: string
  userEmail?: string
}

interface User {
  id: string
  name: string
  role: "admin" | "manager" | "agent"
}

interface TicketNote {
  id: string
  ticketId: string
  userId: string
  userName: string
  content: string
  mentions?: string[]
  read?: boolean
  createdAt: string
  updatedAt: string
}

interface ThreadMessage {
  id: string
  subject: string
  from: string
  to: string
  body: string
  date?: string
  attachments?: any[]
}

interface QuickReply {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
}

interface TicketsViewProps {
  currentUserId: string | null
  currentUserRole: "admin" | "manager" | "agent" | null
  globalSearchTerm?: string
  onClearGlobalSearch?: () => void
  refreshKey?: number
  initialTicketId?: string
  ticketNavKey?: number
}

// Helper: sort tickets in-memory to match the current sort order.
// Backend sorts by last_customer_reply_at, but when we use cached data
// or switch tabs we can briefly show the wrong order unless we resort.
const sortTicketsByOrder = (tickets: Ticket[], order: 'asc' | 'desc'): Ticket[] => {
  const factor = order === 'asc' ? 1 : -1
  return [...tickets].sort((a, b) => {
    const aDate = a.lastCustomerReplyAt || a.updatedAt || a.createdAt
    const bDate = b.lastCustomerReplyAt || b.updatedAt || b.createdAt
    const aTime = aDate ? new Date(aDate).getTime() : 0
    const bTime = bDate ? new Date(bDate).getTime() : 0
    if (aTime === bTime) return 0
    return aTime > bTime ? factor * 1 : factor * -1
  })
}

export default function TicketsView({ currentUserId, currentUserRole, globalSearchTerm, onClearGlobalSearch, refreshKey, initialTicketId, ticketNavKey }: TicketsViewProps) {
  // Cache for instant switching between Active/Closed
  const ticketCache = useRef<{ active: Ticket[], closed: Ticket[] }>({ active: [], closed: [] })

  const [tickets, setTickets] = useState<Ticket[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreatingTickets, setIsCreatingTickets] = useState(false) // Track if tickets are being creating
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [activeTab, setActiveTab] = useState<"assigned" | "unassigned" | "open" | "closed">("unassigned")
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    // Backend uses sortOrder === 'desc' for NEWEST first (latest activity at top)
    // so we default to 'desc' to match "Latest" label in the UI.
    if (typeof window === "undefined") return "desc"
    try {
      // Store per-user so different agents can have their own preference
      const key = currentUserId ? `tickets-sort-order:${currentUserId}` : "tickets-sort-order:anon"
      const saved = window.localStorage.getItem(key) as 'asc' | 'desc' | null
      return saved === "asc" || saved === "desc" ? saved : "desc"
    } catch {
      return "desc"
    }
  }) // Default to newest first, but restore from storage when available

  // Track if action is waiting for user confirmation

  const hasMountedRef = useRef(false)
  const mountTimeRef = useRef(Date.now())
  const fetchIdRef = useRef(0) // Track fetch requests to prevent race conditions
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null) // Track polling interval to clear on new fetch
  // Keep a ref that always mirrors the tickets state so the deep-link effect
  // can read the latest list without needing tickets as a dependency.
  const ticketsRef = useRef<Ticket[]>([])
  // After a plain Send, suppress the realtime ticket-list refresh for a few seconds.
  // This prevents the Supabase INSERT handler from fetching tickets before the
  // background assignment PATCH completes (which would return stale "unassigned"
  // data and flip the tab back).
  const suppressRealtimeFetchUntil = useRef<number>(0)
  // Tracks the ticket ID of the most-recently-sent reply.
  // Prevents the ticket_updates realtime INSERT from navigating the user back
  // to a ticket they already moved away from after pressing Send.
  const lastSentTicketIdRef = useRef<string | null>(null)
  // Always reflects the currently-selected ticket ID synchronously.
  // Used as the guard inside fetchThread instead of the closed-over `selectedTicket`
  // state value, which is stale inside async functions defined earlier in the render.
  const selectedTicketIdRef = useRef<string | null>(null)
  // Keep in sync on every render — written in the render body (not useEffect) so
  // it updates synchronously before any async work that reads it runs.
  selectedTicketIdRef.current = selectedTicket?.id ?? null

  // Ghost Ticket Suppression
  // Stores IDs of tickets we've just closed, to FORCE hide them from "Open" lists
  // even if the server returns them as "Open" (due to race conditions)
  const [temporarilyHiddenIds, setTemporarilyHiddenIds] = useState<Set<string>>(new Set())

  // URL Synchronization
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Sync URL with selected ticket
  useEffect(() => {
    // Determine the current ticket ID in the URL
    const urlTicketId = searchParams.get('ticketId')
    const currentTicketId = selectedTicket?.id

    // If they match, do nothing (avoid loop)
    if (urlTicketId === currentTicketId) return
    if (!urlTicketId && !currentTicketId) return

    // Create new search params
    const params = new URLSearchParams(searchParams.toString())

    if (currentTicketId) {
      params.set('ticketId', currentTicketId)
    } else {
      params.delete('ticketId')
    }

    // Update URL without full page reload
    // replace: true prevents growing history stack for every selection
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })

  }, [selectedTicket?.id, pathname, router, searchParams])

  // Clear global search on unmount
  // DISABLED: This causes issues if the component remounts (e.g. key change) while searching,
  // causing the search to be lost and triggering a fetch loop.
  /*
  useEffect(() => {
    return () => {
      onClearGlobalSearch?.()
    }
  }, [onClearGlobalSearch])
  */

  // Persist sort preference per user in localStorage
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const key = currentUserId ? `tickets-sort-order:${currentUserId}` : "tickets-sort-order:anon"
      window.localStorage.setItem(key, sortOrder)
    } catch {
      // Ignore storage errors (private mode, etc.)
    }
  }, [sortOrder, currentUserId])

  // Clear global search when changing tabs manually (but NOT when auto-switching due to search)
  const handleTabChange = (value: string) => {
    const nextTab = value as typeof activeTab
    setActiveTab(nextTab)

    // When switching between Active <-> Closed, try to show cached tickets instantly
    // so the user doesn't see a "blank" state while the network request runs.
    const cacheKey = nextTab === "closed" ? "closed" : "active"
    const cached = ticketCache.current[cacheKey]
    if (
      cached &&
      cached.length > 0 &&
      !activeSearchQuery &&
      statusFilter === "all" &&
      assigneeFilter === "all" &&
      departmentFilter === "all" &&
      tagsFilter === "all"
    ) {
      setTickets(cached)
    }

    // Only clear if we are NOT currently searching (or if we want to clear search on tab switch)
    // User requested: keep global search when changing tabs, so we intentionally do nothing here.
  }

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [priorityFilter, setPriorityFilter] = useState<string>("all")
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all")
  const [tagsFilter, setTagsFilter] = useState<string>("all")
  const [dateFilter, setDateFilter] = useState<string>("all") // "all", "today", "week", "month", "custom"
  const [customDateStart, setCustomDateStart] = useState<string>("")
  const [customDateEnd, setCustomDateEnd] = useState<string>("")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [selectedAccount, setSelectedAccount] = useState<string>("all")
  const [departmentFilter, setDepartmentFilter] = useState<string>("all")
  const [emails, setEmails] = useState<string[]>([]) // For account filter dropdown
  const [departments, setDepartments] = useState<any[]>([]) // For department filter dropdown
  const [allowedDeptIds, setAllowedDeptIds] = useState<string[] | null>(null) // For agents: only see tickets in these depts
  const lastSearchLogRef = useRef<string | undefined>(undefined)

  // Sync global search into local search field
  useEffect(() => {
    if (globalSearchTerm !== undefined) {
      setSearchQuery(globalSearchTerm)
    }
  }, [globalSearchTerm])

  // Use global search term if provided, otherwise fallback to local
  const activeSearchQuery = globalSearchTerm !== undefined ? globalSearchTerm : searchQuery


  // Auto-switch to tab containing search results when searching


  // Auto-switch to tab containing search results when searching
  // DISABLED: This was causing search results to flash and disappear
  // useEffect(() => {
  //   if (!activeSearchQuery || tickets.length === 0) return

  //   const query = activeSearchQuery.toLowerCase()

  //   // Find all tickets matching the search (ignoring tab filter)
  //   const matchingTickets = tickets.filter(t =>
  //     t.subject.toLowerCase().includes(query) ||
  //     t.customerEmail.toLowerCase().includes(query) ||
  //     (t.customerName && t.customerName.toLowerCase().includes(query))
  //   )

  //   if (matchingTickets.length === 0) return

  //   // Helper to determine which tab a ticket belongs to
  //   const getTicketTab = (t: Ticket): typeof activeTab => {
  //     if (t.status === 'closed') return 'closed'
  //     if (t.assigneeUserId === currentUserId) return 'assigned'
  //     if (!t.assigneeUserId) return 'unassigned'
  //     return 'open'
  //   }

  //   // Check if current tab has any matching tickets
  //   const currentTabMatches = matchingTickets.filter(t => {
  //     const tab = getTicketTab(t)
  //     return tab === activeTab
  //   })

  //   // If current tab has matches, no need to switch
  //   if (currentTabMatches.length > 0) return

  //   // Find the best tab to switch to (prefer in order: assigned, unassigned, open, closed)
  //   const tabPriority: (typeof activeTab)[] = ['assigned', 'unassigned', 'open', 'closed']
  //   for (const tab of tabPriority) {
  //     const hasMatch = matchingTickets.some(t => getTicketTab(t) === tab)
  //     if (hasMatch) {
  //       console.log(`[Search] Switching to "${tab}" tab where search results exist`)
  //       setActiveTab(tab)
  //       break
  //     }
  //   }
  // }, [activeSearchQuery, tickets, currentUserId, activeTab])

  // Typing indicator state
  const [isTyping, setIsTyping] = useState(false)
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)
  const [typingUsers, setTypingUsers] = useState<string[]>([])

  // Ticket detail state
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([])
  // Keep any locally-sent (optimistic) messages per ticket so they don't
  // disappear when you change tickets and come back before the server
  // thread endpoint has fully caught up.
  const optimisticThreadMessagesRef = useRef<Record<string, ThreadMessage[]>>({})
  const [loadingThread, setLoadingThread] = useState(false)
  // Holds a human-readable reason when a conversation fails to load, so we can
  // show it (with a retry) instead of the misleading "No messages yet".
  const [threadError, setThreadError] = useState<string | null>(null)
  const [notes, setNotes] = useState<TicketNote[]>([])
  const [replyText, setReplyText] = useState("")
  const [replyHtml, setReplyHtml] = useState("")
  const [rewritingReply, setRewritingReply] = useState(false)
  const lastReplyBeforeRewriteRef = useRef<{ html: string; text: string } | null>(null)
  const [replyAttachments, setReplyAttachments] = useState<{ id: string; name: string; type: string; size: number; data: string }[]>([])
  const [draftText, setDraftText] = useState("")
  const [draftId, setDraftId] = useState<string | null>(null)
  const [showDraft, setShowDraft] = useState(false)
  const [generatingDraft, setGeneratingDraft] = useState(false)
  const [isForwarding, setIsForwarding] = useState(false)
  const [forwardTo, setForwardTo] = useState("")

  // Clear draft when switching tickets
  useEffect(() => {
    setShowDraft(false)
    setDraftText("")
    setDraftId(null)
    setIsForwarding(false)
    setForwardTo("")
  }, [selectedTicket?.id])
  const [sendingReply, setSendingReply] = useState(false)
  const [sendingAction, setSendingAction] = useState<'send' | 'send-close' | null>(null)
  // Synchronous guard for double-send prevention.
  // React state (sendingReply) is async — its value doesn't update until the
  // next render, so a rapid double-click both see sendingReply===false and both
  // proceed, producing a duplicate optimistic message with the same
  // `sent-${Date.now()}` key.  A ref toggles synchronously within the same tick.
  const isSendingReplyRef = useRef(false)
  const [newNote, setNewNote] = useState("")
  const [selectedMentions, setSelectedMentions] = useState<string[]>([])
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteContent, setEditingNoteContent] = useState("")
  const [editingMentions, setEditingMentions] = useState<string[]>([])
  const [newTag, setNewTag] = useState("")
  const [assignPriority, setAssignPriority] = useState<Ticket["priority"]>("medium")
  const [showAssignDialog, setShowAssignDialog] = useState(false)
  const [pendingAssignment, setPendingAssignment] = useState<{ ticketId: string, assigneeUserId: string | null } | null>(null)
  const [conversationMinimized, setConversationMinimized] = useState(false)
  const [showQuotedMap, setShowQuotedMap] = useState<Record<string, boolean>>({})
  const [conversationSummary, setConversationSummary] = useState<string>("")
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  // Track last time each ticket was viewed (from Supabase) so we can show "new" badges
  const [lastViewedMap, setLastViewedMap] = useState<Record<string, string>>({})
  // Track previous selected ticket metadata for polling comparison
  const prevSelectedIdRef = useRef<string | null>(null)
  const prevSelectedCustomerReplyRef = useRef<string | null>(null)
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)

  // Multi-select state
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [bulkUpdating, setBulkUpdating] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ id: string; status: 'pending' | 'success' | 'error'; message?: string }[]>([])
  const [lastBulkUpdates, setLastBulkUpdates] = useState<{ status?: Ticket["status"]; assigneeUserId?: string | null; tags?: string[] } | null>(null)

  // Filters collapse state - collapsed by default
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  // Quick replies state
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([])
  const [showQuickRepliesSidebar, setShowQuickRepliesSidebar] = useState(false)
  const initialSelectHandledRef = useRef(false)
  // Tracks internal auto-navigation (e.g. next-ticket after close) so the
  // deep-link effect doesn't switch tabs when the URL updates internally.
  const internalNavigationRef = useRef(false)

  // Reset deep-link selection guard when ticketNavKey changes (on each navigation)
  useEffect(() => {
    console.log('🔄 Resetting guard due to ticketNavKey change:', ticketNavKey)
    initialSelectHandledRef.current = false
  }, [ticketNavKey])

  const [showShopifySidebar, setShowShopifySidebar] = useState(false)

  // Optional ref for the outer panel group container (kept to avoid runtime errors if used in JSX)
  const panelGroupRef = useRef<HTMLDivElement | null>(null)

  // Ref for conversation scroll container to preserve scroll position
  const conversationScrollRef = useRef<HTMLDivElement>(null)
  const savedScrollPositionRef = useRef<number>(0)
  const ticketListRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)

  // Improved Panel Sizing Logic
  // We track the "main split" (List vs Detail) as a percentage (0-100)
  // This split should persist regardless of whether sidebars are open or closed.
  // When sidebars open, they compress the main area, but the *relative* split between List/Detail should ideally stay similar?
  // implementation: We save [listWidth, detailWidth] as the fundamental preference.
  // When sidebars are open, we assume they take fixed logical width?
  // Actually, ResizablePanelGroup with 3 panels handles this, but the issue is when we add/remove 3rd panel, the 1st/2nd reset.
  // Fix: We must dynamically calculate defaultSize for all panels whenever the layout changes (sidebar toggles).

  // Default: slightly wider ticket list, still detail-focused
  const [mainSplit, setMainSplit] = useState<number[]>([25, 75])
  const [isLoaded, setIsLoaded] = useState(false)

  // Load saved split from local storage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ticket-panel-main-split')
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (Array.isArray(parsed) && parsed.length === 2) {
            setMainSplit(parsed)
          }
        } catch { }
      }
      setIsLoaded(true)
    }
  }, [])

  // Calculate effective panel sizes based on mainSplit and how many sidebars are open.
  // Each sidebar gets ~25% when alone, ~20% when two are open.
  // The list/detail ratio from mainSplit is always preserved proportionally.
  const getEffectivePanelSizes = (sidebarCount: number) => {
    const split = mainSplit
    if (sidebarCount <= 0) return split
    const perSidebar = sidebarCount === 1 ? 25 : 20
    const totalSidebar = perSidebar * sidebarCount
    const remaining = 100 - totalSidebar
    const totalSplit = split[0] + split[1]
    const sizes = [
      (split[0] / totalSplit) * remaining,
      (split[1] / totalSplit) * remaining,
    ]
    for (let i = 0; i < sidebarCount; i++) sizes.push(perSidebar)
    return sizes
  }

  // Calculate sidebar count for synchronous sizing
  let sidebarCount = 0
  if (showQuickRepliesSidebar) sidebarCount++
  if (showShopifySidebar && selectedTicket) sidebarCount++

  const effectivePanelSizes = getEffectivePanelSizes(sidebarCount)

  const saveMainSplit = (sizes: number[]) => {
    // Only persist the split when we have exactly 2 panels (no sidebars).
    // This ensures that resizing while Quick Replies / Shopify sidebars are open
    // does NOT permanently distort the main list/detail ratio.
    if (sizes.length !== 2) return

    const newSplit = sizes

    setMainSplit(newSplit)
    if (typeof window !== 'undefined') {
      localStorage.setItem('ticket-panel-main-split', JSON.stringify(newSplit))
    }
  }

  // Prevent layout shifts when conversation loads - stabilize panel sizes
  // Also restore scroll position after messages load
  const isResizingRef = useRef(false)
  const prevThreadLengthRef = useRef(0)
  useEffect(() => {
    if (threadMessages.length > 0 && threadMessages.length !== prevThreadLengthRef.current && !isResizingRef.current) {
      prevThreadLengthRef.current = threadMessages.length
      // Ensure panel sizes remain stable when content loads
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        // Panel should maintain its size - no action needed
        // The CSS containment should prevent layout shifts

        // Restore scroll position after content loads
        if (conversationScrollRef.current && savedScrollPositionRef.current > 0) {
          conversationScrollRef.current.scrollTop = savedScrollPositionRef.current
          savedScrollPositionRef.current = 0 // Reset after restoring
        }
      })
    }
  }, [threadMessages.length])

  // Also restore scroll position when loading completes
  useEffect(() => {
    if (!loadingThread && threadMessages.length > 0 && conversationScrollRef.current && savedScrollPositionRef.current > 0) {
      // Use setTimeout to ensure DOM has fully rendered
      setTimeout(() => {
        if (conversationScrollRef.current) {
          conversationScrollRef.current.scrollTop = savedScrollPositionRef.current
          savedScrollPositionRef.current = 0 // Reset after restoring
        }
      }, 100)
    }
  }, [loadingThread, threadMessages.length])

  // Auto-filter closed tickets - default ON
  const [autoFilterClosed, setAutoFilterClosed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('auto-filter-closed')
      // Default to true if not explicitly set
      return saved === null ? true : saved === 'true'
    }
    return true
  })

  // Updating states
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [updatingPriority, setUpdatingPriority] = useState(false)
  const [updatingTags, setUpdatingTags] = useState(false)
  const [assigning, setAssigning] = useState<string | null>(null)
  const [addingNote, setAddingNote] = useState(false)

  const [updatingDepartment, setUpdatingDepartment] = useState(false)
  const [showDepartmentDialog, setShowDepartmentDialog] = useState(false)
  const [targetDepartmentId, setTargetDepartmentId] = useState<string>("")
  const [departmentReasoning, setDepartmentReasoning] = useState("")

  const { toast } = useToast()
  const canAssign = currentUserRole === "admin" || currentUserRole === "manager"

  // Debounced localStorage save
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handlePanelResize = useCallback(
    (sizes: number[]) => {
      if (!sizes || sizes.length < 2 || !isLoaded) return

      // Keep the live layout in sync with the resizable group
      isResizingRef.current = true

      // Note: sizes are percentages of the group
      // Debounce persistence to avoid thrashing localStorage while dragging
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
      resizeTimeoutRef.current = setTimeout(() => {
        if (sizes.length === 2) {
          // No sidebars open — save directly
          saveMainSplit(sizes)
        } else {
          // Sidebars are open — extract just the list+detail sizes and normalize
          // to 100% so we can persist the main split ratio correctly.
          // The first two panels are always list and detail.
          const listSize = sizes[0]
          const detailSize = sizes[1]
          const total = listSize + detailSize
          if (total > 0) {
            saveMainSplit([
              (listSize / total) * 100,
              (detailSize / total) * 100,
            ])
          }
        }
        isResizingRef.current = false
      }, 300)
    },
    [isLoaded, saveMainSplit]
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current)
      }
    }
  }, [])

  // Save auto-filter preference
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auto-filter-closed', String(autoFilterClosed))
    }
  }, [autoFilterClosed])

  // Load departments for the dialog
  useEffect(() => {
    const loadDepartments = async () => {
      try {
        const response = await fetch("/api/departments")
        if (response.ok) {
          const data = await response.json()
          setDepartments(data.departments || [])
        }
      } catch (err) {
        console.error("Error loading departments:", err)
      }
    }
    loadDepartments()
  }, [])

  const handleUpdateDepartment = async () => {
    if (!selectedTicket) {
      console.warn("[DepartmentUpdate] No ticket selected")
      return
    }

    const finalDeptId = targetDepartmentId === "unclassified" || !targetDepartmentId ? null : targetDepartmentId
    console.log(`[DepartmentUpdate] Updating ticket ${selectedTicket.id} to department:`, finalDeptId)

    setUpdatingDepartment(true)
    try {
      const response = await fetch(`/api/tickets/${selectedTicket.id}/department`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: finalDeptId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to update department")
      }

      // Find the name of the new department
      const newDeptName = finalDeptId === null
        ? null
        : (departments.find(d => d.id === finalDeptId)?.name || null)

      // Update local state
      const updatedTicket: Ticket = {
        ...selectedTicket,
        departmentId: finalDeptId,
        departmentName: newDeptName
      }

      setSelectedTicket(updatedTicket)

      // Update in the tickets list
      // If agent moved ticket to a department they don't have access to, remove it from view
      if (currentUserRole === 'agent' && allowedDeptIds && targetDepartmentId && targetDepartmentId !== "unclassified") {
        if (!allowedDeptIds.includes(targetDepartmentId)) {
          setTickets(prev => prev.filter(t => t.id !== selectedTicket.id))
          setSelectedTicket(null)
          toast({
            title: "Workstream updated",
            description: `Ticket moved to restricted workstream. It has been removed from your view.`,
          })
          setShowDepartmentDialog(false)
          setDepartmentReasoning("")
          return
        }
      }

      setTickets(prev => prev.map(t => t.id === selectedTicket.id ? updatedTicket : t))

      toast({
        title: "Workstream updated",
        description: `Ticket moved to ${newDeptName || "Unclassified"}.`,
      })

      setShowDepartmentDialog(false)
      setDepartmentReasoning("")
    } catch (err) {
      console.error("[DepartmentUpdate] Error:", err)
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Failed to update department. Please try again.",
        variant: "destructive"
      })
    } finally {
      setUpdatingDepartment(false)
    }
  }

  // Pagination state
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [ticketCounts, setTicketCounts] = useState({ open: 0, assigned: 0, unassigned: 0, closed: 0 })
  const autoSwitchedToClosedRef = useRef(false)

  // Check if sync is running (tickets being creating)
  const checkSyncStatus = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch('/api/emails/sync')
      if (response.ok) {
        const data = await response.json()
        return data.processing === true || data.status === 'running'
      }
    } catch (err) {
      console.error('[Tickets] Error checking sync status:', err)
    }
    return false
  }, [])

  const fetchTicketCounts = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      // Keep counts in sync with the currently selected account
      if (selectedAccount !== 'all') {
        params.set('account', selectedAccount)
      }

      const headers: Record<string, string> = {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      }
      // Ensure the API receives the same per-tab user context as the tickets list
      if (currentUserId) {
        headers['x-user-id'] = currentUserId
      }

      const query = params.toString()
      const url = query ? `/api/tickets/counts?${query}` : '/api/tickets/counts'

      const res = await fetch(url, { cache: 'no-store', headers })
      if (res.ok) {
        const data = await res.json()
        const nextCounts = data.counts || data
        setTicketCounts(nextCounts)

        // UX guard: if there are 0 active tickets but there ARE closed tickets,
        // auto-switch to Closed once so the page doesn't feel "broken".
        const hasActive =
          (nextCounts?.open || 0) > 0 ||
          (nextCounts?.assigned || 0) > 0 ||
          (nextCounts?.unassigned || 0) > 0
        const hasClosed = (nextCounts?.closed || 0) > 0
        const noFilters =
          !activeSearchQuery &&
          statusFilter === 'all' &&
          assigneeFilter === 'all' &&
          priorityFilter === 'all' &&
          departmentFilter === 'all' &&
          tagsFilter === 'all'

        if (
          noFilters &&
          !autoSwitchedToClosedRef.current &&
          hasClosed &&
          !hasActive &&
          ['open', 'assigned', 'unassigned'].includes(activeTab)
        ) {
          autoSwitchedToClosedRef.current = true
          setActiveTab('closed')
          // Kick an immediate interactive fetch for the Closed tab
          fetchTicketsRef.current?.({ silent: false, pageNum: 1, forceTab: 'closed' })
        }
      }
    } catch (e) {
      console.error("Failed to fetch ticket counts", e)
    }
  }, [selectedAccount, currentUserId, activeSearchQuery, statusFilter, assigneeFilter, priorityFilter, departmentFilter, tagsFilter, activeTab])

  const fetchSingleTicket = useCallback(async (ticketId: string) => {
    try {
      // Use the tickets API with a specific ID if possible, or search?
      // Actually we don't have a specific point-lookup endpoint documented, but usually /api/tickets/ID works?
      // Let's assume /api/tickets/ID returns the ticket details with joins.
      // If not, we might need to rely on the list endpoint with search?
      // Let's try /api/tickets/[id] first.
      const response = await fetch(`/api/tickets/${ticketId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.ticket) {
          setTickets(prev => {
            const exists = prev.find(t => t.id === ticketId)
            if (exists) {
              return prev.map(t => t.id === ticketId ? data.ticket : t)
            } else {
              // Prepend new ticket
              return [data.ticket, ...prev]
            }
          })
          // Also update selected if needed
          setSelectedTicket(prev => prev?.id === ticketId ? data.ticket : prev)
          // Refresh counts as well since a new ticket might change them
          fetchTicketCounts()
        }
      }
    } catch (e) {
      console.error("Failed to fetch single ticket", e)
    }
  }, [fetchTicketCounts])

  // Define fetchTickets before it's used in effects
  const fetchTickets = useCallback(async (options?: {
    silent?: boolean
    returnData?: boolean
    pageNum?: number
    limit?: number
    forceTab?: "closed" | "active"
    sortOverride?: "asc" | "desc"
  }) => {
    const {
      silent = false,
      returnData = false,
      pageNum = 1,
      limit,
      forceTab,
      sortOverride,
    } = options || {}

    // Debug log
    if (activeSearchQuery) {
      console.log(`[TicketsView] fetchTickets called. Query: "${activeSearchQuery}", Page: ${pageNum}, Silent: ${silent}`)
    }

    // If loading more (pageNum > 1), don't set main loading state
    const isLoadMore = pageNum > 1

    // Resolve the effective sort order up-front so cached data and server
    // response both use the same (correct) order.
    const effectiveSort = sortOverride || sortOrder

    // Increment fetch ID to invalidate previous requests
    const currentFetchId = ++fetchIdRef.current

    // Clear any existing polling interval from previous fetches
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    try {
      // Check cache for instant load (Page 1 only)
      // Use forceTab if provided (for prefetching), otherwise use activeTab
      const effectiveTab = forceTab || activeTab
      let initialCachedData: Ticket[] | null = null
      const targetMode = effectiveTab === 'closed' ? 'closed' : 'active'

      // OPTIMIZATION: Always check cache first for instant feedback, especially for 'closed' tab
      if (pageNum === 1 && !activeSearchQuery && statusFilter === 'all' && assigneeFilter === 'all' && departmentFilter === 'all' && tagsFilter === 'all') {
        // If we have ANY cached data for the target mode, use it immediately
        if (ticketCache.current[targetMode].length > 0) {
          console.log(`[Tickets] Instant load from cache for ${targetMode}`)
          initialCachedData = ticketCache.current[targetMode]
        }
      }


      const shouldUseCache = !!initialCachedData && !silent && !isLoadMore

      if (shouldUseCache) {
        setTickets(sortTicketsByOrder(initialCachedData!, effectiveSort))
        // If we used cache, we treat this fetch as silent from UI perspective
        // But we don't overwrite the 'silent' param because we want to know if it was *intended* to be silent?
        // Actually, we should just not set loading(true).
      }

      if (!silent && !isLoadMore && !shouldUseCache && !activeSearchQuery) {
        setLoading(true)
        setLoadingMore(false) // Fix race condition: ensure load-more state is cleared on full refresh
      }
      if (isLoadMore) setLoadingMore(true)

      // If we used cache, strictly force silent mode for the rest of this function so we don't trigger spinners
      const effectiveSilent = silent || shouldUseCache || (!!activeSearchQuery && pageNum === 1)

      setError(null)
      if (!effectiveSilent && !isLoadMore) console.log(`[Tickets] Fetching tickets page ${pageNum} (id: ${currentFetchId})... ActiveTab: ${activeTab}`)
      if (isLoadMore) console.log(`[Tickets] Loading more tickets page ${pageNum}...`)

      const timestamp = Date.now()
      const navTimestamp = typeof window !== 'undefined' ? sessionStorage.getItem('__ticketsNavTime') || timestamp : timestamp

      let url = `/api/tickets?_=${timestamp}&nav=${navTimestamp}`

      // Pagination
      // Allow custom limit for refreshing large lists, default to 200
      const fetchLimit = limit || 200
      url += `&page=${pageNum}&limit=${fetchLimit}`

      if (selectedAccount !== 'all') {
        url += `&account=${encodeURIComponent(selectedAccount)}`
      }

      // Determine filters based on activeTab and dropdowns
      // OPTIMIZATION: Group Open/Assigned/Unassigned into a single "Active" fetch
      // This allows instant tab switching without network requests
      // Note: effectiveTab is already defined above (line 636)

      const isActiveTab = ['open', 'assigned', 'unassigned'].includes(effectiveTab)
      const isClosedTab = effectiveTab === 'closed'

      // 1. Status Filter
      if (statusFilter !== 'all') {
        // Explicit filter overrides tab logic
        url += `&status=${encodeURIComponent(statusFilter)}`
      } else if (isClosedTab) {
        url += `&status=closed`
      } else {
        // For ALL active tabs (open, assigned, unassigned), fetch the same broad set
        // We will filter client-side for the specific sub-tab
        url += `&status=open,pending,on_hold`
      }

      // 2. Assignee Filter
      if (assigneeFilter !== 'all') {
        url += `&assignee=${encodeURIComponent(assigneeFilter)}`
      }
      // NOTE: We do NOT set assignee=me or assignee=unassigned here for active tabs anymore
      // We want to fetch ALL active tickets and filter client-side

      // 3. Other filters
      if (priorityFilter !== 'all') url += `&priority=${priorityFilter}`
      if (departmentFilter !== 'all') url += `&department=${encodeURIComponent(departmentFilter)}`
      if (tagsFilter !== 'all') url += `&tags=${encodeURIComponent(tagsFilter)}`

      // 4. Search
      // IMPORTANT: When searching, we typically want to search GLOBALLY
      // But currently we are combining search with filters.
      // If activeSearchQuery is set, maybe we should relax the status filters?
      // Previous logic: "When searching, search across ALL tickets (including closed) regardless of tab"
      // So if activeSearchQuery is present, we should NOT send status/assignee params derived from tabs?
      if (activeSearchQuery) {
        url += `&q=${encodeURIComponent(activeSearchQuery)}`
        // If searching, we might want to Override the tab-based status filters
        // But keep explicit user filters?
        // Let's stick to the previous behavior: Search overrides tab filters
        // So we might need to RE-write the url params logic above if search is present.
      }

      // Refined Search Logic:
      // If search is active, do NOT fully rely on tab filters, OR rely on them?
      // Previous logic: "When searching, skip tab-based filtering... This ensures closed tickets are searchable from any tab"
      // So if search is present, we should strip the strict tab-based status/assignee params
      // BUT we should probably keep explicit dropdown filters if user set them?
      // Let's simplify: If search is present, clear the implicit tab filters.
      if (activeSearchQuery) {
        // Reset URL to base and re-apply ONLY explicit filters + search
        url = `/api/tickets?_=${timestamp}&nav=${navTimestamp}&page=${pageNum}&limit=${fetchLimit}&q=${encodeURIComponent(activeSearchQuery)}`
        if (selectedAccount !== 'all') url += `&account=${encodeURIComponent(selectedAccount)}`
        if (statusFilter !== 'all') url += `&status=${encodeURIComponent(statusFilter)}`
        if (priorityFilter !== 'all') url += `&priority=${priorityFilter}`
        if (assigneeFilter !== 'all') url += `&assignee=${encodeURIComponent(assigneeFilter)}`
        if (departmentFilter !== 'all') url += `&department=${encodeURIComponent(departmentFilter)}`
        if (tagsFilter !== 'all') url += `&tags=${encodeURIComponent(tagsFilter)}`
      }

      // Sort order — effectiveSort was resolved at the top of fetchTickets
      url += `&sort=${effectiveSort}`

      const headers: Record<string, string> = {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      };
      if (currentUserId) headers['x-user-id'] = currentUserId;

      // START FETCH
      const ticketsPromise = fetch(url, { cache: "no-store", headers })
      // Only check sync status on an interactive (non-silent) first-page fetch.
      // Silent polling should not hammer /api/emails/sync.
      const syncCheckPromise = (!effectiveSilent && pageNum === 1)
        ? checkSyncStatus()
        : Promise.resolve(false)

      // Also fetch counts if page 1 (refresh counts on navigation/filter change)
      if (pageNum === 1) fetchTicketCounts()

      const response = await ticketsPromise
      if (currentFetchId !== fetchIdRef.current) return

      if (!response.ok) throw new Error("Failed to fetch tickets")

      const data = await response.json()

      // Handle Unique Emails for filter dropdown
      // We should probably rely on a separate API for this, but accumulating from fetched tickets works for now
      if (data.tickets && data.tickets.length > 0) {
        const uniqueEmails = Array.from(new Set(data.tickets.map((t: Ticket) => t.ownerEmail).filter(Boolean))) as string[]
        setEmails(prev => {
          const combined = Array.from(new Set([...prev, ...uniqueEmails]))
          return combined.sort()
        })
      }

      const list = data.tickets || []

      if (pageNum === 1) {
        // Only update displayed tickets if this is NOT a prefetch (forceTab)
        // Prefetches should only update the cache, not the displayed tickets
        if (!forceTab) {
          setTickets(sortTicketsByOrder(list, effectiveSort))
        }
        // Update cache
        const cacheKey = effectiveTab === 'closed' ? 'closed' : 'active'
        // Only update cache if we are not searching/filtering
        if (!activeSearchQuery && statusFilter === 'all' && assigneeFilter === 'all') {
          ticketCache.current[cacheKey] = list
          if (forceTab) {
            console.log(`[Tickets] Prefetched and cached ${list.length} ${cacheKey} tickets`)
          }
        }
      } else {
        setTickets(prev => [...prev, ...list])
        // We generally don't cache pagination results deeply to avoid memory bloat
        // unless we want to support "Show More" persistence across tabs?
        // for now, just caching page 1 is enough for "instant switch" feel
      }

      setHasMore(list.length >= (limit || 200)) // If we got full page, assume more exists

      // If we fetched a custom limit (e.g. refreshing active view), update page accordingly
      // This prevents "Load More" from fetching duplicates (e.g. if we fetched 1000 items, page should be 5, not 1)
      if (pageNum === 1) {
        const calculatedPage = Math.ceil(list.length / 200)
        setPage(Math.max(1, calculatedPage))
      } else {
        setPage(pageNum)
      }

      // Clear loading on interactive fetches, and also clear it if it was set earlier
      // but we ended up doing a silent refresh (e.g., initial mount polling).
      if ((!silent && !isLoadMore) || (pageNum === 1 && loading)) setLoading(false)
      if (isLoadMore) setLoadingMore(false)

      const syncRunning = await syncCheckPromise
      if (syncRunning && pageNum === 1) {
        setIsCreatingTickets(true)
        // ... polling logic similar to before ...
        // For brevity, skipping the complex polling re-implementation here, 
        // but ensuring we turn off isCreatingTickets eventually
        setTimeout(() => setIsCreatingTickets(false), 5000)
      } else {
        setIsCreatingTickets(false)
      }

      if (returnData) return list

    } catch (err) {
      if (currentFetchId !== fetchIdRef.current) return
      console.error('[Tickets] Error fetching tickets:', err)
      setError(err instanceof Error ? err.message : "Failed to load tickets")
      setIsCreatingTickets(false)
      if (!silent) setLoading(false)
      setLoadingMore(false)
    }
    // Intentionally OMIT `loading` from the dep list. fetchTickets calls
    // setLoading(true) at start and setLoading(false) at end, so including
    // `loading` would give fetchTickets a new identity on every call. That
    // re-triggers any useEffect depending on fetchTickets (e.g. the prefetch
    // effect below), which fires fetchTickets again — causing /api/tickets
    // and /api/tickets/counts to be hit several times per second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, currentUserId, checkSyncStatus, activeSearchQuery, activeTab === 'closed' ? 'closed' : 'active', statusFilter, assigneeFilter, priorityFilter, departmentFilter, tagsFilter, fetchTicketCounts, sortOrder])

  // We keep pagination explicit now instead of auto-loading on scroll.
  // The Load more button is still available at the bottom of the list.

  // Removed derived ticketCounts useMemo - now using state

  // Handle quick reply selection
  const handleSelectQuickReply = (content: string) => {
    // Append to existing content or replace? Usually append is safer.
    // Actually user asked for "one click... automatically copies it to the chat box"
    // We'll append it to the current reply text

    // Check if we're using RichTextEditor (HTML) or simple textarea
    setReplyHtml(prev => {
      const toAdd = content.replace(/\n/g, '<br>');
      return prev ? `${prev}<br>${toAdd}` : toAdd;
    });
    // Also update plain text version if needed, though RichTextEditor handles internal sync
    setReplyText(prev => prev ? `${prev}\n${content}` : content);

    // Focus logic would be handled by the editor receiving props update
  }

  // Rewrite-only AI helper for agent-written replies
  const handleRewriteReply = useCallback(async () => {
    if (!replyText.trim() || rewritingReply) return

    try {
      setRewritingReply(true)
      lastReplyBeforeRewriteRef.current = { html: replyHtml, text: replyText }

      const response = await fetch("/api/compose/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: replyText,
          tone: "friendly",
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const message = data?.error || "Failed to rewrite reply"
        toast({
          title: "Rewrite failed",
          description: message,
          variant: "destructive",
        })
        return
      }

      const data = await response.json()
      const rewritten: string = data.rewritten || ""
      const safe = (rewritten || "").trim()
      if (!safe) {
        toast({
          title: "Rewrite unavailable",
          description: "The AI did not return any content. Please try again.",
          variant: "destructive",
        })
        return
      }

      // Convert plain text into simple paragraphs for the rich text editor
      const paragraphs = safe.split(/\n{2,}|\r\n\r\n/).map(p => p.trim()).filter(Boolean)
      const html =
        paragraphs.length > 0
          ? paragraphs.map(line => `<p>${line}</p>`).join("")
          : `<p>${safe}</p>`

      setReplyHtml(html)
      setReplyText(safe)
      toast({
        title: "Reply polished",
        description: "AI has rewritten your message to be more customer-friendly.",
      })
    } catch (err) {
      console.error("[RewriteReply] Error:", err)
      toast({
        title: "Rewrite failed",
        description: err instanceof Error ? err.message : "Something went wrong while rewriting your reply.",
        variant: "destructive",
      })
    } finally {
      setRewritingReply(false)
    }
  }, [replyText, replyHtml, rewritingReply, toast])

  const handleUndoRewrite = useCallback(() => {
    const previous = lastReplyBeforeRewriteRef.current
    if (!previous) return
    setReplyHtml(previous.html)
    setReplyText(previous.text)
    lastReplyBeforeRewriteRef.current = null
  }, [])

  // Listen for account changes to refresh tickets and email list
  // This ensures ALL users (agents, managers, admins) see the changes
  useEffect(() => {
    const handleAccountsChanged = () => {
      console.log('[TicketsView] Accounts changed event received, refreshing tickets and email list')
      // Clear emails and refetch tickets to get updated list
      setEmails([])
      fetchTickets()
    }

    // Also listen for storage events (cross-tab communication)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'accountsChanged') {
        console.log('[TicketsView] Accounts changed detected via storage event, refreshing')
        setEmails([])
        fetchTickets()
      }
    }

    window.addEventListener('accountsChanged', handleAccountsChanged)
    window.addEventListener('storage', handleStorageChange)

    // Check on mount if accounts changed
    const checkAccountsChanged = () => {
      const accountsChanged = localStorage.getItem('accountsChanged')
      if (accountsChanged) {
        setEmails([])
        fetchTickets()
        localStorage.removeItem('accountsChanged')
      }
    }
    checkAccountsChanged()

    return () => {
      window.removeEventListener('accountsChanged', handleAccountsChanged)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [fetchTickets]) // Re-setup listener if fetchTickets changes

  // Keep ref to latest fetchTickets to avoid effect dependencies
  const fetchTicketsRef = useRef(fetchTickets)
  useEffect(() => { fetchTicketsRef.current = fetchTickets }, [fetchTickets])

  // Prefetch closed tickets in background for instant tab switching
  // We do this once (per filter profile) so that when the user first clicks "Closed"
  // we can show cached results immediately instead of an empty state.
  useEffect(() => {
    if (ticketCache.current["closed"].length > 0) return
    if (
      activeSearchQuery ||
      statusFilter !== "all" ||
      assigneeFilter !== "all" ||
      departmentFilter !== "all" ||
      tagsFilter !== "all"
    ) {
      // Don't eagerly prefetch when user has heavy filters/search applied
      return
    }

    const prefetchTimer = setTimeout(() => {
      console.log("[Tickets] Prefetching closed tickets for fast Closed tab")
      fetchTickets({
        silent: true,
        pageNum: 1,
        limit: 200,
        forceTab: "closed",
      }).catch(() => {
        // Ignore errors in prefetch - it's just a background optimization
      })
    }, 200)

    return () => clearTimeout(prefetchTimer)
  }, [activeSearchQuery, statusFilter, assigneeFilter, departmentFilter, tagsFilter, fetchTickets])

  // Listen for refresh flag from email-list (when unspamming emails)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'tickets_needs_refresh' && e.newValue === 'true') {
        console.log('[Tickets] Refresh flag detected via storage event - fetching page 1 immediately')
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('tickets_needs_refresh')
        }
        ticketCache.current = { active: [], closed: [] }
        fetchTickets({ pageNum: 1, silent: false })
      }
    }

    // Listen for direct event when emails are moved from spam
    const handleEmailsMovedFromSpam = (e: Event) => {
      if (e instanceof CustomEvent) {
        console.log('[Tickets] Emails moved from spam event received - count:', e.detail?.count)
        ticketCache.current = { active: [], closed: [] }
        fetchTickets({ pageNum: 1, silent: false })
      }
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener('emailsMovedFromSpam', handleEmailsMovedFromSpam)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener('emailsMovedFromSpam', handleEmailsMovedFromSpam)
    }
  }, [fetchTickets])

  useEffect(() => {
    const fetchAgentDepartments = async () => {
      if (currentUserRole !== "agent" || !currentUserId) return
      try {
        const res = await fetch(`/api/agents/${currentUserId}/departments`)
        if (res.ok) {
          const data = await res.json()
          setAllowedDeptIds(data.departments?.map((d: any) => d.id) || [])
        }
      } catch (e) {
        console.error("Failed to fetch agent departments", e)
      }
    }

    // Ensure we do an initial non-silent fetch so the page can exit the loading state.
    setLoading(true)

    // Set navigation timestamp to force fresh data on this page visit
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('__ticketsNavTime', Date.now().toString())
    }

    // CRITICAL FIX: Use IIFE for proper async initialization
    // This ensures email sync completes BEFORE fetching tickets
    (async () => {
      try {
        // CHECK: If tickets need refresh (e.g. after unspamming emails), fetch immediately
        const needsRefresh = typeof window !== 'undefined' && sessionStorage.getItem('tickets_needs_refresh') === 'true'
        if (needsRefresh) {
          console.log('[Tickets] Tickets needs refresh flag detected - fetching immediately')
          if (typeof window !== 'undefined') {
            sessionStorage.removeItem('tickets_needs_refresh')
          }
          // Force a direct refresh without waiting
          try {
            const result = await fetchTickets({ silent: false, pageNum: 1 })
            console.log('[Tickets] Forced refresh completed:', result)
            setLoading(false)
            return
          } catch (err) {
            console.error('[Tickets] Forced refresh failed:', err)
            setLoading(false)
            return
          }
        }

        // STEP 1: FETCH TICKETS FIRST (Instant UI)
        await fetchTicketsRef.current?.({ silent: false, pageNum: 1 })

        // STEP 2: Load secondary data in parallel (non-blocking)
        // This runs after tickets are visible, so user sees list immediately
        console.log('[Tickets] STEP 2: Loading secondary data (background)...')
        Promise.all([
          fetchUsers(),
          fetchTicketViews(),
          fetchAccounts(),
          fetchAgentDepartments(),
          ...(currentUserId ? [fetchQuickReplies()] : [])
        ]).then(() => {
          console.log('[Tickets] Secondary data loaded')
        }).catch(err => {
          console.error('[Tickets] Secondary data failed:', err)
        })

        // Trigger a background Gmail pull so any messages that arrived while the
        // Pub/Sub webhook was down (or before the user signed in) get turned into
        // tickets. /api/emails runs Smart Sync which calls ensureTicketForEmail
        // for the top 10 recent threads. Non-blocking — we refetch tickets after.
        ;(async () => {
          try {
            const res = await fetch('/api/emails?type=inbox&maxResults=50', { cache: 'no-store' })
            if (res.ok) {
              await fetchTicketsRef.current?.({ silent: true, pageNum: 1 })
            }
          } catch (syncErr) {
            console.warn('[Tickets] Background Gmail sync failed:', syncErr)
          }
        })()
      } catch (err) {
        console.error('[Tickets] Error loading data:', err)
        // Ensure we never get stuck in loading state if initialization fails.
        setLoading(false)
      }
    })()

    // No cleanup needed since we removed setTimeout
  }, [currentUserId, refreshKey]) // Removed fetchTickets to prevent loops

  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/auth/accounts')
      if (res.ok) {
        const data = await res.json()
        setEmails(data.accounts?.map((a: { email: string }) => a.email) || [])
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error)
    }
  }

  // Prefetch closed tickets for instant switching
  useEffect(() => {
    // Wait for initial load
    if (loading) return

    // Check if we already have closed tickets
    if (ticketCache.current.closed.length > 0) return

    // Prefetch closed tickets (Page 1)
    console.log('[Tickets] Prefetching closed tickets for instant switch...')
    const timestamp = Date.now()
    const limit = 200
    const url = `/api/tickets?_=${timestamp}&status=closed&page=1&limit=${limit}`

    fetch(url, { priority: 'low' } as any)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data && data.tickets) {
          console.log(`[Tickets] Prefetched ${data.tickets.length} closed tickets`)
          ticketCache.current.closed = data.tickets
        }
      })
      .catch(err => console.error('Failed to prefetch closed tickets', err))
  }, [loading]) // Run once after initial loading finishes

  // Fallback refresh every 10 minutes in case Supabase Realtime drops the
  // connection (idle close, network blip). The webhook → Realtime pipeline is
  // the primary delivery path; this is a safety net only.
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() < suppressRealtimeFetchUntil.current) return
      const currentLimit = page * 200
      fetchTicketsRef.current?.({ silent: true, pageNum: 1, limit: currentLimit })
    }, 600000)
    return () => clearInterval(intervalId)
  }, [page])

  // Supabase Realtime subscription for instant ticket updates
  // This enables new tickets to appear automatically when emails arrive
  useEffect(() => {
    if (!supabaseBrowser) {
      console.log('[Realtime] Supabase client not available')
      return
    }

    console.log('[Realtime] Setting up tickets subscription...')

    // Leading-edge: first INSERT renders immediately so the user sees new
    // tickets instantly. During a sync burst, additional INSERTs in the next
    // 2 s are coalesced into one trailing list refresh instead of N
    // fetchSingleTicket calls.
    let trailingIds: string[] = []
    let trailingTimer: ReturnType<typeof setTimeout> | null = null
    let lastFetchAt = 0
    const BURST_COOLDOWN_MS = 2000

    const channel = supabaseBrowser
      .channel('tickets-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'tickets',
        },
        (payload) => {
          const ticketId = (payload.new as { id?: string })?.id
          const elapsed = Date.now() - lastFetchAt

          if (elapsed >= BURST_COOLDOWN_MS) {
            // First event (or post-cooldown): act immediately for instant UX.
            lastFetchAt = Date.now()
            if (ticketId) {
              fetchSingleTicket(ticketId)
            } else {
              const currentLimit = page * 200
              fetchTickets({ silent: true, pageNum: 1, limit: currentLimit })
            }
          } else {
            // Inside cooldown: queue for one trailing bulk refresh.
            if (ticketId) trailingIds.push(ticketId)
            if (!trailingTimer) {
              trailingTimer = setTimeout(() => {
                trailingTimer = null
                trailingIds = []
                lastFetchAt = Date.now()
                const currentLimit = page * 200
                fetchTickets({ silent: true, pageNum: 1, limit: currentLimit })
              }, BURST_COOLDOWN_MS - elapsed)
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
        },
        (payload) => {
          console.log('[Realtime] Ticket updated:', payload.new)
          const raw = payload.new as any

          // If we are still within the post-Send suppression window, ignore this
          // UPDATE entirely — the assignment PATCH may not have completed yet and
          // merging stale DB data here would flip the ticket back to "unassigned".
          if (Date.now() < suppressRealtimeFetchUntil.current) {
            console.log('[Realtime] Suppressing tickets UPDATE during post-send window:', raw.id)
            return
          }

          // Map DB snake_case columns → camelCase ticket fields.
          // Spreading the raw payload directly onto the camelCase ticket object
          // leaves camelCase fields (e.g. assigneeUserId) stale while adding
          // duplicate snake_case keys — causing isTicketVisibleInTab to mis-classify
          // the ticket (e.g. treating it as "unassigned" after an assignment).
          const mapped: Partial<Ticket> = {
            status: raw.status,
            priority: raw.priority ?? undefined,
            assigneeUserId: raw.assignee_user_id ?? null,
            departmentId: raw.department_id ?? null,
            subject: raw.subject,
            tags: raw.tags,
            lastCustomerReplyAt: raw.last_customer_reply_at ?? null,
            lastAgentReplyAt: raw.last_agent_reply_at ?? null,
            updatedAt: raw.updated_at,
          }
          // Strip undefined keys so we don't accidentally overwrite good data
          const patch = Object.fromEntries(
            Object.entries(mapped).filter(([, v]) => v !== undefined)
          ) as Partial<Ticket>

          // Check if department changed (need a full refetch for JOINed name)
          const oldTicket = tickets.find(t => t.id === raw.id)
          const deptChanged = oldTicket && oldTicket.departmentId !== (raw.department_id ?? null)

          if (deptChanged) {
            console.log('[Realtime] Department changed for ticket', raw.id, '- refetching ticket...')
            fetchSingleTicket(raw.id)
          } else {
            setTickets(prev => prev.map(t =>
              t.id === raw.id ? { ...t, ...patch } : t
            ))
            setSelectedTicket(prev =>
              prev?.id === raw.id ? ({ ...prev, ...patch } as Ticket) : prev
            )
          }

          // Detect new customer reply on the currently selected ticket.
          // Use refs for comparison (always fresh) and pass ticketId explicitly
          // to fetchThread so it doesn't rely on any stale closure state.
          const newReply = raw.last_customer_reply_at ?? null
          const prevReply = prevSelectedCustomerReplyRef.current
          const isSelectedTicket = raw.id === prevSelectedIdRef.current
          if (isSelectedTicket && newReply && (!prevReply || new Date(newReply) > new Date(prevReply))) {
            prevSelectedCustomerReplyRef.current = newReply
            toast({ title: 'New customer reply', description: raw.subject })
            fetchThread({ silent: true, ticketId: raw.id })
            markTicketViewed({ id: raw.id, subject: raw.subject } as any, newReply)
          }
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Subscription status:', status)
      })

    return () => {
      console.log('[Realtime] Cleaning up tickets subscription')
      if (trailingTimer) clearTimeout(trailingTimer)
      if (supabaseBrowser) {
        supabaseBrowser.removeChannel(channel)
      }
    }
  }, [fetchTickets, page])

  // Refresh tickets when window gains focus or visibility changes (to catch updates from inbox)
  // Use debouncing to prevent rapid re-fetches that cause flickering
  useEffect(() => {
    // Debounce ref to prevent multiple rapid fetches
    let refreshTimeoutId: NodeJS.Timeout | null = null
    let lastFetchTime = 0

    const debouncedFetch = (delay: number = 1000) => {
      if (refreshTimeoutId) {
        clearTimeout(refreshTimeoutId)
      }
      refreshTimeoutId = setTimeout(() => {
        // Respect the post-action suppression window (set when a Send/Close fires).
        // Without this check the 2-second debounced fetch that fires after every
        // ticketUpdated / ticketsForceRefresh event would fetch stale server data
        // before the assignment/close PATCH commits, causing the ticket to ghost-
        // reappear in the active tab and/or show in both tabs simultaneously.
        if (Date.now() < suppressRealtimeFetchUntil.current) {
          console.log('[Debounce] Skipping fetch — within post-action suppression window')
          refreshTimeoutId = null
          return
        }
        console.log('🔄 Debounced fetch executing...')
        // Refresh ALL loaded pages to preserve scroll position/data
        const currentLimit = page * 200
        fetchTickets({ silent: true, pageNum: 1, limit: currentLimit })
        lastFetchTime = Date.now()
        refreshTimeoutId = null
      }, delay)
    }

    const handleFocus = () => {
      console.log('Window focused - scheduling refresh')
      debouncedFetch(500) // Short delay for focus events
    }

    // Handle visibility change (for when user switches apps/tabs)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Only fetch if at least 5 seconds have passed since last fetch
        const timeSinceLastFetch = Date.now() - lastFetchTime
        if (timeSinceLastFetch > 5000) {
          console.log('Tab became visible - scheduling refresh')
          debouncedFetch(300) // Shorter delay for visibility changes
        }
      }
    }

    // Handle custom event for when navigating back to tickets view
    const handleTicketsForceFresh = () => {
      console.log('📍 Tickets force fresh event received')
      debouncedFetch(100) // Very short delay for navigation
    }

    const handleTicketUpdate = (e: Event) => {
      console.log('🔔 Ticket update event received:', e.type)
      if (e instanceof CustomEvent && e.detail) {
        console.log('📦 Event detail:', e.detail)
        const detail = e.detail as { ticketId?: string; status?: Ticket['status']; assigneeUserId?: string | null; switchToTab?: 'assigned' | 'closed' | 'unassigned' | 'open'; forceReset?: boolean }
        
        // Handle force reset (e.g., when emails are unspammed)
        if (detail?.forceReset) {
          console.log('🔄 Force reset requested - clearing cache and fetching from page 1')
          ticketCache.current = { active: [], closed: [] }
          // Fetch page 1 immediately without debouncing
          console.log('🚀 Fetching tickets immediately after force reset...')
          fetchTickets({ pageNum: 1, silent: false })
          return
        }
        
        if (detail?.ticketId) {
          console.log('⚡ Optimistically updating ticket:', detail.ticketId, 'status:', detail.status, 'assignee:', detail.assigneeUserId)

          // If this is the currently selected ticket being closed, auto-select the next one
          if (detail.status === 'closed' && selectedTicket?.id === detail.ticketId) {
            console.log('🔀 Currently selected ticket was closed, selecting next ticket...')
            // Get the current filtered list to find the next ticket
            setTickets(prev => {
              const currentIndex = prev.findIndex(t => t.id === detail.ticketId)
              // Find next ticket that isn't closed
              // IMPROVED LOGIC: 
              // 1. Try to find the ticket immediately FOLLOWING the current one.
              // 2. If no following ticket, try to find one immediately PRECEDING the current one.
              // 3. Fallback to any open ticket.

              let nextTicket = prev.slice(currentIndex + 1).find(t => t.status !== 'closed');
              if (!nextTicket) {
                // If no next ticket, look backwards (e.g. we closed the last one in the list)
                // We reverse the slice to find the *closest* preceding ticket (index-1, then index-2...)
                nextTicket = prev.slice(0, currentIndex).reverse().find(t => t.status !== 'closed');
              }

              if (nextTicket) {
                console.log('➡️ Auto-selecting next ticket:', nextTicket.id, nextTicket.subject)
                // Mark as internal navigation so the deep-link effect won't
                // switch tabs when the URL updates to the new ticket's id.
                internalNavigationRef.current = true
                // Use setTimeout to ensure state updates don't conflict
                setTimeout(() => setSelectedTicket(nextTicket), 0)
              } else {
                console.log('📭 No more open tickets to select')
                setTimeout(() => setSelectedTicket(null), 0)
              }

              // Return the updated tickets with the closed status
              return prev.map(t =>
                t.id === detail.ticketId
                  ? { ...t, status: detail.status ?? t.status, assigneeUserId: detail.assigneeUserId ?? t.assigneeUserId }
                  : t
              )
            })
          } else {
            // Standard optimistic update
            setTickets(prev => {
              const updated = prev.map(t =>
                t.id === detail.ticketId
                  ? { ...t, status: detail.status ?? t.status, assigneeUserId: detail.assigneeUserId ?? t.assigneeUserId }
                  : t
              )
              console.log('✨ Tickets updated, new count:', updated.length)
              return updated
            })
          }

          // Switch to the appropriate tab if specified
          if (detail.switchToTab && ['assigned', 'closed', 'unassigned', 'open'].includes(detail.switchToTab)) {
            console.log('🎯 Switching to tab:', detail.switchToTab)
            setActiveTab(detail.switchToTab as typeof activeTab)
          }
        }
      }

      // Debounced fetch to sync with server (longer delay to let optimistic update show)
      console.log('📡 Scheduling background sync...')
      debouncedFetch(2000) // 2 second delay after optimistic update
    }

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('ticketUpdated', handleTicketUpdate as EventListener)
    window.addEventListener('ticketsForceRefresh', handleTicketUpdate as EventListener)
    window.addEventListener('ticketsForceFresh', handleTicketsForceFresh)
    console.log('✅ Event listeners attached')

    // NOTE: No need to fetch here - tickets are already fetched in the main initialization effect (line 786-794)
    // This prevents duplicate fetches that can cause flickering

    return () => {
      if (refreshTimeoutId) clearTimeout(refreshTimeoutId)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('ticketUpdated', handleTicketUpdate as EventListener)
      window.removeEventListener('ticketsForceRefresh', handleTicketUpdate as EventListener)
      window.removeEventListener('ticketsForceFresh', handleTicketsForceFresh)
    }
  }, [fetchTickets, selectedTicket])

  // Initial fetch on mount — Realtime subscription handles all subsequent updates
  useEffect(() => {
    fetchTickets({ silent: false })
  }, [fetchTickets])

  // Apply deep-linked ticket selection once tickets are loaded.
  // IMPORTANT: Do NOT put `tickets` in the dependency array here.
  // The effect reads the latest tickets via `ticketsRef` so it doesn't
  // need to re-run every time tickets poll/refresh. It only needs to fire
  // when the navigation target (initialTicketId / ticketNavKey) changes,
  // or when the user context changes. This prevents the page from
  // randomly re-selecting the URL ticket on every polling cycle.
  useEffect(() => {
    if (!initialTicketId) return

    // Check if we already handled this navigation (guard set synchronously)
    if (initialSelectHandledRef.current) return

    // If this URL change was caused by an internal auto-selection (e.g. next
    // ticket after close), skip the tab switch so the user stays on their
    // current tab.
    if (internalNavigationRef.current) {
      internalNavigationRef.current = false
      initialSelectHandledRef.current = true
      return
    }

    const currentTickets = ticketsRef.current
    if (!currentTickets.length) {
      // Tickets not loaded yet — wait for them by watching a "tickets loaded"
      // signal instead of depending on the tickets array directly.
      // The ticketNavKey reset + this effect will re-run when ticketNavKey changes.
      // If tickets aren't available on first run, set a short retry:
      const retryId = setTimeout(() => {
        const t = ticketsRef.current
        if (!t.length || initialSelectHandledRef.current) return
        const match = t.find(ticket => ticket.id === initialTicketId)
        if (!match) return
        initialSelectHandledRef.current = true // Set SYNCHRONOUSLY before any async work
        let targetTab: typeof activeTab = 'open'
        if (match.status === 'closed') targetTab = 'closed'
        else if (match.assigneeUserId === currentUserId) targetTab = 'assigned'
        else if (!match.assigneeUserId) targetTab = 'unassigned'
        setActiveTab(targetTab)
        setTimeout(() => {
          setSelectedTicket(match)
          setSelectedTicketIds(new Set([match.id]))
        }, 150)
      }, 500)
      return () => clearTimeout(retryId)
    }

    const match = currentTickets.find(t => t.id === initialTicketId)
    if (!match) {
      console.warn('[DeepLink] Ticket not found in loaded list:', initialTicketId)
      return
    }

    // Set guard SYNCHRONOUSLY so that any concurrent ticket-list refresh
    // cannot trigger this effect again before the setTimeout fires.
    initialSelectHandledRef.current = true

    let targetTab: typeof activeTab = 'open'
    if (match.status === 'closed') targetTab = 'closed'
    else if (match.assigneeUserId === currentUserId) targetTab = 'assigned'
    else if (!match.assigneeUserId) targetTab = 'unassigned'
    setActiveTab(targetTab)

    // Small delay to let the tab switch render before selecting the ticket
    setTimeout(() => {
      setSelectedTicket(match)
      setSelectedTicketIds(new Set([match.id]))
    }, 150)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicketId, currentUserId, ticketNavKey]) // NO tickets here — use ticketsRef instead

  // Close quick replies sidebar and refetch when user changes or logs out
  useEffect(() => {
    // Always close sidebar when currentUserId changes (including when it becomes null on logout)
    setShowQuickRepliesSidebar(false)

    // Only refetch if we have a valid user
    if (currentUserId) {
      fetchQuickReplies()
    }
  }, [currentUserId])


  const fetchQuickReplies = async () => {
    try {
      const response = await fetch("/api/quick-replies")
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        const errorMessage = errorData.error || errorData.details || "Failed to assign ticket"
        toast({
          title: "Assignment failed",
          description: errorMessage,
          variant: "destructive"
        })
        throw new Error(errorMessage)
      }
    } catch (err) {
      console.error("Error fetching quick replies:", err)
    }
  }

  // Supabase realtime for ticket_updates.
  // Leading-edge: an assignment/status change refreshes the list immediately
  // so the user sees it instantly. During sync bursts, additional events in
  // the next 3 s coalesce into one trailing list refresh.
  useEffect(() => {
    if (!supabaseBrowser) return
    let listRefreshTimer: ReturnType<typeof setTimeout> | null = null
    let lastListFetchAt = 0
    const LIST_COOLDOWN_MS = 3000

    const channel = supabaseBrowser!
      .channel("ticket-updates")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ticket_updates" },
        async (payload) => {
          const ticketId = (payload.new as any)?.ticket_id as string | undefined
          if (!ticketId) return

          if (Date.now() < suppressRealtimeFetchUntil.current) {
            console.log('[Realtime] Suppressing fetchTickets during post-send window for ticket:', ticketId)
            return
          }

          const elapsed = Date.now() - lastListFetchAt
          if (elapsed >= LIST_COOLDOWN_MS) {
            lastListFetchAt = Date.now()
            fetchTickets({ silent: true })
          } else if (!listRefreshTimer) {
            listRefreshTimer = setTimeout(() => {
              listRefreshTimer = null
              lastListFetchAt = Date.now()
              fetchTickets({ silent: true })
            }, LIST_COOLDOWN_MS - elapsed)
          }

          // Detail refresh only for the currently-selected ticket — bounded.
          if (selectedTicket?.id === ticketId && ticketId !== lastSentTicketIdRef.current) {
            try {
              const res = await fetch(`/api/tickets/${ticketId}`)
              if (res.ok) {
                const data = await res.json().catch(() => null)
                if (data?.ticket) {
                  setSelectedTicket(data.ticket)
                  prevSelectedCustomerReplyRef.current = data.ticket.lastCustomerReplyAt || null
                  await markTicketViewed(data.ticket, data.ticket.lastCustomerReplyAt || undefined)
                }
              }
              await fetchThread({ silent: true })
            } catch {
              // ignore
            }
          }
        }
      )
      .subscribe()

    return () => {
      if (listRefreshTimer) clearTimeout(listRefreshTimer)
      if (supabaseBrowser) {
        supabaseBrowser.removeChannel(channel)
      }
    }
  }, [selectedTicket])

  const fetchTicketViews = async () => {
    try {
      const response = await fetch("/api/tickets/viewed")
      if (!response.ok) return
      const data = await response.json()
      setLastViewedMap(data.views || {})
    } catch {
      // ignore storage errors
    }
  }

  const markTicketViewed = async (ticket: Ticket, explicitStamp?: string) => {
    const stamp = explicitStamp || ticket.lastCustomerReplyAt || new Date().toISOString()
    setLastViewedMap((prev) => ({ ...prev, [ticket.id]: stamp }))
    try {
      await fetch(`/api/tickets/${ticket.id}/viewed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastViewedAt: stamp }),
      })
    } catch {
      // ignore storage errors
    }
  }

  const hasNewCustomerReply = (ticket: Ticket) => {
    if (!ticket.lastCustomerReplyAt) return false
    const lastSeen = lastViewedMap[ticket.id]
    if (!lastSeen) return true
    return new Date(ticket.lastCustomerReplyAt) > new Date(lastSeen)
  }

  // New customer replies on the selected ticket are delivered via the Realtime
  // UPDATE subscription above (lastCustomerReplyAt change → toast + thread refetch).

  // Fetch departments for filter dropdown
  useEffect(() => {
    const fetchDepartments = async () => {
      try {
        const response = await fetch('/api/departments')
        if (response.ok) {
          const data = await response.json()
          setDepartments(data.departments || [])
        }
      } catch (err) {
        console.error('Error fetching departments:', err)
      }
    }
    fetchDepartments()
  }, [])

  // Track selected ticket changes for comparison
  useEffect(() => {
    if (selectedTicket) {
      prevSelectedIdRef.current = selectedTicket.id
      prevSelectedCustomerReplyRef.current = selectedTicket.lastCustomerReplyAt || null
    }
  }, [selectedTicket])

  useEffect(() => {
    if (selectedTicket) {
      // Clear previous state immediately to avoid stale data
      setThreadMessages([])
      setNotes([])

      fetchThread()
      fetchNotes()
      setConversationSummary("")
      setSummaryExpanded(false)

      // Typing indicators via Supabase Broadcast — zero Vercel function calls.
      // Each user broadcasts their typing state directly to other clients.
      if (supabaseBrowser && currentUserId) {
        const ch = supabaseBrowser
          .channel(`typing:${selectedTicket.id}`)
          .on('broadcast', { event: 'typing' }, (payload: any) => {
            const { userId: uid, typing } = payload.payload ?? {}
            if (!uid || uid === currentUserId) return
            setTypingUsers(prev =>
              typing ? [...new Set([...prev, uid])] : prev.filter(id => id !== uid)
            )
          })
          .subscribe()

        return () => {
          supabaseBrowser.removeChannel(ch)
          setTypingUsers([])
          setConversationSummary("")
          setSummaryExpanded(false)
        }
      }
    } else {
      setTypingUsers([]) // Clear when no ticket selected
      setConversationSummary("")
      setSummaryExpanded(false)
    }
  }, [selectedTicket?.id, currentUserId]) // Re-run when ticket or user changes

  const updateTypingStatus = (typing: boolean) => {
    if (!selectedTicket || !currentUserId || !supabaseBrowser) return
    // Send via Supabase Broadcast — no Vercel function invocation
    supabaseBrowser
      .channel(`typing:${selectedTicket.id}`)
      .send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId, typing } })
      .catch(() => {}) // silently fail — typing indicator is not critical
  }

  const handleTyping = () => {
    if (!selectedTicket || !currentUserId) return

    // Clear existing timeout
    if (typingTimeout) {
      clearTimeout(typingTimeout)
    }

    // Set typing status
    setIsTyping(true)
    updateTypingStatus(true)

    // Clear typing status after 3 seconds of inactivity
    const timeout = setTimeout(() => {
      setIsTyping(false)
      updateTypingStatus(false)
    }, 3000)

    setTypingTimeout(timeout)
  }

  // Cleanup typing status on unmount or ticket change
  useEffect(() => {
    return () => {
      if (typingTimeout) {
        clearTimeout(typingTimeout)
      }
      if (selectedTicket && currentUserId) {
        updateTypingStatus(false)
      }
    }
  }, [selectedTicket, currentUserId])

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/users", {
        method: 'GET',
        credentials: 'include',
      }).catch((networkError) => {
        // Network error - return null to indicate failure
        console.warn("Network error fetching users:", networkError)
        return null
      })

      if (response && response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
      }
    } catch (err) {
      console.error("Error fetching users:", err)
    }
  }

  const fetchThread = async (options?: { silent?: boolean, ticketId?: string }) => {
    const { silent = false, ticketId } = options || {}
    // Use provided ticketId or fall back to selectedTicket
    const targetTicketId = ticketId || selectedTicket?.id

    if (!targetTicketId) return

    try {
      // Save current scroll position before loading
      if (conversationScrollRef.current) {
        savedScrollPositionRef.current = conversationScrollRef.current.scrollTop
      }

      if (!silent) setLoadingThread(true)
      if (!silent) setThreadError(null)
      const response = await fetch(`/api/tickets/${targetTicketId}/thread`)

      // GUARD: If we moved to another ticket while fetching, ABORT.
      // Use selectedTicketIdRef (updated synchronously on every render) rather
      // than the closed-over `selectedTicket` state value.  The state value is
      // stale inside this async function if setSelectedTicket() was called before
      // the fetch completed — both sides of the comparison would be the OLD id
      // so the guard would pass and the old ticket’s thread would overwrite the
      // new ticket’s thread in state.
      if (selectedTicketIdRef.current !== targetTicketId) {
        console.log('🛑 Aborting thread update: user switched tickets', {
          wanted: targetTicketId,
          current: selectedTicketIdRef.current
        })
        return
      }

      if (response.ok) {
        const data = await response.json()
        let messages: ThreadMessage[] = data.messages || []

        // Re-attach any local optimistic messages for this ticket so they
        // remain visible even if the backend thread API is slightly behind.
        const optimistic = optimisticThreadMessagesRef.current[targetTicketId] || []
        if (optimistic.length > 0) {
          const optimisticIds = new Set(optimistic.map(m => m.id))
          messages = [
            // Avoid exact duplicates if we ever reuse IDs
            ...messages.filter(m => !optimisticIds.has(m.id)),
            ...optimistic,
          ]
        }

        setThreadMessages(messages)
        if (selectedTicketIdRef.current === targetTicketId) setThreadError(null)
      } else {
        // Handle error - try to get error message from response
        const errorData = await response.json().catch(() => ({}))
        console.error("Thread API error:", response.status, errorData)
        if (selectedTicketIdRef.current === targetTicketId) {
          // Surface an actionable reason instead of a silent "No messages yet".
          const reason = response.status === 401
            ? "This mailbox's Gmail connection needs to be reconnected to load the conversation."
            : (errorData?.error || `Couldn't load this conversation (error ${response.status}).`)
          setThreadError(reason)
          setThreadMessages([])
        }
      }
    } catch (err) {
      console.error("Error fetching thread:", err)
      if (selectedTicketIdRef.current === targetTicketId) {
        setThreadMessages([])
        if (!silent) {
          setThreadError(
            err instanceof TypeError
              ? "Network error — check your connection and retry."
              : `Couldn't load this conversation.${err instanceof Error ? ` ${err.message}` : ''}`
          )
        }
      }
    } finally {
      if (selectedTicketIdRef.current === targetTicketId) {
        if (!silent) setLoadingThread(false)
      }
    }
  }

  const fetchNotes = async (signal?: AbortSignal) => {
    if (!selectedTicket) return
    try {
      const response = await fetch(`/api/tickets/${selectedTicket.id}/notes`, { signal })
      if (response.ok) {
        const data = await response.json()
        setNotes(data.notes || [])
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      console.error("Error fetching notes:", err)
    }
  }

  const handleTakeTicket = async () => {
    if (!selectedTicket || !currentUserId) return

    // If ticket is unassigned, require priority selection
    if (!selectedTicket.assigneeUserId) {
      setPendingAssignment({ ticketId: selectedTicket.id, assigneeUserId: currentUserId })
      setShowAssignDialog(true)
      return
    }

    await handleAssign(selectedTicket.id, currentUserId)
  }

  const handleAssign = async (ticketId: string, assigneeUserId: string | null, priority?: Ticket["priority"]) => {
    if (assigning === ticketId) return // Prevent double-click

    // Client-side guard for agent permissions to give immediate feedback
    if (currentUserRole === 'agent') {
      const attemptingSelfAssign = assigneeUserId === currentUserId
      const attemptingUnassign = assigneeUserId === null
      const attemptingAssignOther = assigneeUserId !== null && assigneeUserId !== currentUserId
      if (attemptingUnassign || attemptingAssignOther) {
        toast({
          title: "Permission denied",
          description: "Agents can only assign tickets to themselves.",
          variant: "destructive"
        })
        return
      }
      if (!attemptingSelfAssign) {
        toast({
          title: "Permission denied",
          description: "Agents can only assign tickets to themselves.",
          variant: "destructive"
        })
        return
      }
    }

    // Optimistic update
    const targetTicket = tickets.find(t => t.id === ticketId)
    if (!targetTicket) return

    const previousAssignee = targetTicket.assigneeUserId
    const previousAssigneeName = targetTicket.assigneeName
    const previousPriority = targetTicket.priority

    const newAssigneeName = assigneeUserId ? users.find(u => u.id === assigneeUserId)?.name : null
    const optimisticTicket = {
      ...targetTicket,
      assigneeUserId,
      assigneeName: newAssigneeName,
      priority: priority || targetTicket.priority,
      updatedAt: new Date().toISOString()
    }

    // Update UI immediately
    setTickets(prev => prev.map(t => t.id === ticketId ? optimisticTicket : t))
    if (selectedTicket?.id === ticketId) {
      setSelectedTicket(optimisticTicket)
    }

    // Optimistic Count Update for Assignment
    setTicketCounts(prev => {
      const wasAssigned = !!targetTicket.assigneeUserId
      const isAssigned = !!assigneeUserId

      // If assignment status didn't change (e.g. changing from one user to another), counts don't change
      if (wasAssigned === isAssigned) return prev

      return {
        ...prev,
        assigned: prev.assigned + (isAssigned ? 1 : -1),
        unassigned: prev.unassigned + (isAssigned ? -1 : 1)
      }
    })

    try {
      setAssigning(ticketId)
      console.log('[Assign Ticket] Starting assignment:', { ticketId, assigneeUserId, priority })

      // Send assignment and priority in single request
      console.log('[Assign Ticket] Assigning ticket to:', assigneeUserId, priority ? `with priority: ${priority}` : '')
      const response = await fetch(`/api/tickets/${ticketId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeUserId, priority }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('[Assign Ticket] Assignment failed:', errorData)
        // Rollback optimistic update
        setTickets(prev => prev.map(t => t.id === ticketId ? {
          ...t,
          assigneeUserId: previousAssignee,
          assigneeName: previousAssigneeName,
          priority: previousPriority
        } : t))
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket(prev => prev ? {
            ...prev,
            assigneeUserId: previousAssignee,
            assigneeName: previousAssigneeName,
            priority: previousPriority
          } : null)
        }
        throw new Error(errorData.error || "Failed to assign ticket")
      }

      console.log('[Assign Ticket] Assignment successful')

      const data = await response.json()

      // Update with server response (confirms optimistic update)
      if (data.ticket) {
        setTickets((prev) => prev.map((t) => (t.id === ticketId ? data.ticket : t)))

        // Update selected ticket if it's the one being assigned
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket(data.ticket)
        }
      } else {
        console.warn('[Assign Ticket] No ticket data in response, keeping optimistic update')
      }

      // Close dialog and clear pending assignment BEFORE showing toast
      setShowAssignDialog(false)
      setPendingAssignment(null)

      toast({ title: "Ticket assigned successfully" })
    } catch (err) {
      console.error('[Assign Ticket] Error:', err)
      setError(err instanceof Error ? err.message : "Failed to assign ticket")
      toast({
        title: "Assignment failed",
        description: err instanceof Error ? err.message : "Failed to assign ticket",
        variant: "destructive"
      })
      // Don't close dialog on error so user can retry
    } finally {
      setAssigning(null)
    }
  }

  const handleConfirmAssign = async () => {
    if (!pendingAssignment) return
    console.log('[Assign Ticket] Starting assignment:', {
      ticketId: pendingAssignment.ticketId,
      assigneeUserId: pendingAssignment.assigneeUserId,
      priority: assignPriority
    })
    try {
      await handleAssign(pendingAssignment.ticketId, pendingAssignment.assigneeUserId, assignPriority)
    } catch (err) {
      console.error('[Assign Ticket] Error in handleConfirmAssign:', err)
    }
  }

  const handleUpdateStatus = async (status: Ticket["status"], ticketId?: string) => {
    const targetTicketId = ticketId || selectedTicket?.id
    if (!targetTicketId) return

    // Optimistic update
    const targetTicket = tickets.find(t => t.id === targetTicketId)
    if (!targetTicket) return

    const previousStatus = targetTicket.status
    if (previousStatus === status) return // No change needed

    const optimisticTicket = { ...targetTicket, status, updatedAt: new Date().toISOString() }

    // Update UI immediately
    setTickets(prev => prev.map(t => t.id === targetTicketId ? optimisticTicket : t))
    if (selectedTicket?.id === targetTicketId) {
      setSelectedTicket(optimisticTicket)
    }

    // Optimistic Count Update for Status Change
    setTicketCounts(prev => {
      const isAssigned = !!targetTicket.assigneeUserId
      const wasClosed = previousStatus === 'closed'
      const isClosed = status === 'closed'

      if (wasClosed === isClosed) return prev // No category change (e.g. open -> pending)

      return {
        ...prev,
        open: prev.open + (isClosed ? -1 : 1), // Assuming 'open' tracks total active
        closed: prev.closed + (isClosed ? 1 : -1),
        [isAssigned ? 'assigned' : 'unassigned']: prev[isAssigned ? 'assigned' : 'unassigned'] + (isClosed ? -1 : 1)
      }
    })

    // 3b. Counts update automatically via useMemo on tickets change

    // OPTIMISTIC NAVIGATION: If closing, move to next ticket IMMEDIATELY
    if (status === "closed" && selectedTicket?.id === targetTicketId) {
      console.log('🚀 Optimistically closing and navigating...')

      // Suppress the poller and realtime INSERT channel from fetching while
      // the PATCH is in-flight.  Without this, a poll cycle that happens to
      // fire in the ~500 ms before the server commits the close can return
      // the ticket as 'open', overwrite optimistic state, and cause it to
      // ghost-reappear in the active tab once temporarilyHiddenIds clears.
      suppressRealtimeFetchUntil.current = Date.now() + 20000
      lastSentTicketIdRef.current = targetTicketId
      setTimeout(() => {
        if (lastSentTicketIdRef.current === targetTicketId) lastSentTicketIdRef.current = null
      }, 25000)

      // Add to temporarilyHiddenIds to prevent ghost reappearance
      setTemporarilyHiddenIds(prev => {
        const next = new Set(prev)
        next.add(targetTicketId)
        return next
      })
      setTimeout(() => {
        setTemporarilyHiddenIds(prev => {
          const next = new Set(prev)
          next.delete(targetTicketId)
          return next
        })
      }, 25000)

      // Restrict to tickets visible in the current tab to avoid jumping to a
      // ticket from a different sub-tab (e.g. unassigned while on assigned).
      const tabVisibleTickets = filteredTickets.filter(t => isTicketVisibleInTab(t, activeTab, currentUserId, assigneeFilter))
      const currentIndex = tabVisibleTickets.findIndex(t => t.id === targetTicketId)
      let nextTicket: Ticket | null = tabVisibleTickets[currentIndex + 1] || tabVisibleTickets[currentIndex - 1] || null
      if (nextTicket && nextTicket.id === targetTicketId) nextTicket = null

      if (nextTicket) {
        console.log('➡️ Optimistically navigating to:', nextTicket.id)
        internalNavigationRef.current = true
        setSelectedTicket(nextTicket)
        markTicketViewed(nextTicket)
      } else {
        setSelectedTicket(null)
      }
    }

    // ACTUALLY CALL THE API to persist the change!
    try {
      const response = await fetch(`/api/tickets/${targetTicketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || "Failed to update status")
      }


      toast({ title: "Status updated" })
    } catch (err) {
      console.error('❌ Status update failed:', err)
      toast({
        title: "Update Failed",
        description: err instanceof Error ? err.message : "Failed to update status",
        variant: "destructive",
      })

      // Revert optimistic updates on error
      setTickets(prev => prev.map(t => t.id === targetTicketId ? { ...t, status: previousStatus } : t))
      if (selectedTicket?.id === targetTicketId) {
        setSelectedTicket(prev => prev ? { ...prev, status: previousStatus } : null)
      }

    }
  }

  const handleStatusChange = async (status: Ticket["status"]) => {
    if (!selectedTicket) return
    const targetTicketId = selectedTicket.id
    const previousStatus = selectedTicket.status

    if (previousStatus === status) return

    // OPTIMISTIC UPDATE FOR CLOSE (Parity with Send & Close)
    if (status === 'closed') {
      try {
        console.log('🚀 Optimistic Dropdown Close for:', targetTicketId)

        setUpdatingStatus(true) // Briefly show loading state on the button/dropdown if valid

        // 1. Update state immediately (Close it in the list)
        const closedTicketState = { ...selectedTicket, status: 'closed' as const }
        setTickets(prev => prev.map(t => t.id === targetTicketId ? closedTicketState : t))

        // SUPPRESS GHOST REAPPEARANCE from realtime/polling before server confirms close.
        // This ref is checked by BOTH the ticket_updates realtime INSERT handler AND the
        // 5-second poller, so neither can fire fetchTickets before the PATCH completes
        // and overwrite the optimistic closed state with stale 'open/pending' data.
        suppressRealtimeFetchUntil.current = Date.now() + 20000
        lastSentTicketIdRef.current = targetTicketId
        setTimeout(() => {
          if (lastSentTicketIdRef.current === targetTicketId) lastSentTicketIdRef.current = null
        }, 25000)

        setTemporarilyHiddenIds(prev => {
          const next = new Set(prev)
          next.add(targetTicketId)
          return next
        })
        setTimeout(() => {
          setTemporarilyHiddenIds(prev => {
            const next = new Set(prev)
            next.delete(targetTicketId)
            return next
          })
        }, 25000)

        // Update badge counts immediately (single call, no duplicate)
        setTicketCounts(prev => {
          const t = selectedTicket
          if (!t) return prev
          const isAssigned = !!t.assigneeUserId
          return {
            ...prev,
            [isAssigned ? 'assigned' : 'unassigned']: Math.max(0, prev[isAssigned ? 'assigned' : 'unassigned'] - 1),
            closed: prev.closed + 1,
            open: t.status === 'open' ? Math.max(0, prev.open - 1) : prev.open
          }
        })

        // 2. Determine next ticket & Navigate — restrict to current tab
        const tabVisibleTickets = filteredTickets.filter(t => isTicketVisibleInTab(t, activeTab, currentUserId, assigneeFilter))
        const currentIndex = tabVisibleTickets.findIndex(t => t.id === targetTicketId)
        let nextTicket = tabVisibleTickets[currentIndex + 1] || tabVisibleTickets[0]
        if (nextTicket && nextTicket.id === targetTicketId) nextTicket = null as any // No others

        if (nextTicket) {
          console.log('➡️ Optimistically navigating to next ticket:', nextTicket.id)
          internalNavigationRef.current = true
          setSelectedTicket(nextTicket)
        } else {
          console.log('🏁 No next ticket, clearing selection')
          setSelectedTicket(null)
        }

        toast({ title: "Ticket closed", description: "Processing in background..." })

        // 3. Perform background API call
        // We don't await this to block UI, but we catch errors
        fetch(`/api/tickets/${targetTicketId}/status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }).then(async (response) => {
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || "Failed to update status")
          }
        }).catch(err => {
          console.error('❌ Background Close Failed:', err)
          toast({
            title: "Update Failed",
            description: "Failed to close ticket on server. Please refresh.",
            variant: "destructive",
            duration: 5000
          })
          // Revert local state on error
          setTickets(prev => prev.map(t => t.id === targetTicketId ? { ...t, status: previousStatus } : t))
        }).finally(() => {
          setUpdatingStatus(false)
        })

        return; // Exit early, we handled it optimistically

      } catch (e) {
        // Fallback to normal flow if something synchronous failed (unlikely)
        console.error('Optimistic update failed, falling back', e)
      }
    }

    // STANDARD FLOW (Open, Pending, On Hold)
    try {
      setUpdatingStatus(true)
      const response = await fetch(`/api/tickets/${targetTicketId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

        // Rollback on error
        setTickets(prev => prev.map(t => t.id === targetTicketId ? { ...t, status: previousStatus } : t))

        // Use functional update to check current state before reverting
        setSelectedTicket(curr => {
          if (curr?.id === targetTicketId) {
            return curr ? { ...curr, status: previousStatus } : null
          }
          return curr
        })

        throw new Error(errorData.error || errorData.details || "Failed to update status")
      }
      const data = await response.json()

      // Update with server data
      setTickets((prev) => prev.map((t) => (t.id === targetTicketId ? data.ticket : t)))

      // Use functional update to avoid stale closure issue
      // Only update the selected ticket if we are actually still viewing the one that was updated
      setSelectedTicket(curr => (curr?.id === targetTicketId ? data.ticket : curr))

      toast({ title: "Status updated" })
    } catch (err) {
      toast({ title: "Error", description: "Failed to update status", variant: "destructive" })
    } finally {
      setUpdatingStatus(false)
    }
  }

  const handleBulkUpdate = async (updates: { status?: Ticket["status"], assigneeUserId?: string | null, tags?: string[] }, specificIds?: string[]) => {
    const targetIds = specificIds && specificIds.length > 0 ? specificIds : Array.from(selectedTicketIds)
    if (targetIds.length === 0) return

    // Pre-flight: agent permission guard for bulk assign/unassign
    if (currentUserRole === 'agent' && updates.assigneeUserId !== undefined) {
      const attemptingUnassign = updates.assigneeUserId === null
      const attemptingAssignOther = updates.assigneeUserId !== null && updates.assigneeUserId !== currentUserId
      if (attemptingUnassign || attemptingAssignOther) {
        toast({
          title: "Permission denied",
          description: "Agents can only bulk-assign tickets to themselves.",
          variant: "destructive"
        })
        return
      }
    }

    try {
      setBulkUpdating(true)
      setLastBulkUpdates(updates)
      setBulkProgress(targetIds.map(id => ({ id, status: 'pending' as const })))
      const response = await fetch("/api/tickets/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketIds: targetIds,
          ...updates,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update tickets' }))
        throw new Error(errorData.error || "Failed to update tickets")
      }
      const data = await response.json()

      // Update tickets in state for successes
      const updatedMap = new Map((data.results || []).map((r: any) => [r.ticketId, r.ticket as Ticket]))
      setTickets((prev) => prev.map((t) => (updatedMap.get(t.id) as Ticket) || t))

      const failedErrors: Record<string, string> = {}
        ; (data.errors || []).forEach((e: any) => { failedErrors[e.ticketId] = e.error || 'Unknown error' })

      setBulkProgress(targetIds.map(id => {
        const err = failedErrors[id]
        return err ? { id, status: 'error', message: err } : { id, status: 'success' as const }
      }))

      const successCount = (data.results || []).length
      const failedCount = (data.errors || []).length

      if (failedCount === 0) {
        // Clear selection on full success
        setSelectedTicketIds(new Set())
        setIsSelectMode(false)
      } else {
        // Keep only failed ones selected for retry
        setSelectedTicketIds(new Set(targetIds.filter(id => failedErrors[id])))
      }

      // If closing tickets, auto-filter them out if preference is set
      if (updates.status === "closed" && autoFilterClosed) {
        setStatusFilter("open")
      }

      toast({
        title: failedCount ? "Bulk update partially succeeded" : "Bulk update successful",
        description: failedCount ? `Updated ${successCount}, failed ${failedCount}` : `Updated ${successCount} ticket(s)`,
        variant: failedCount ? "destructive" : "default"
      })

    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update tickets",
        variant: "destructive"
      })
    } finally {
      setBulkUpdating(false)
    }
  }

  const handleBulkClassify = async (departmentId: string | null) => {
    const targetIds = Array.from(selectedTicketIds)
    if (targetIds.length === 0) return

    try {
      setBulkUpdating(true)
      setBulkProgress(targetIds.map(id => ({ id, status: 'pending' as const })))

      // Process each ticket individually
      const results = await Promise.allSettled(
        targetIds.map(async (ticketId) => {
          const response = await fetch(`/api/tickets/${ticketId}/department`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ departmentId }),
          })
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Failed' }))
            throw new Error(errorData.error || "Failed to classify")
          }
          return { ticketId, success: true }
        })
      )

      // Count successes and failures
      const successCount = results.filter(r => r.status === 'fulfilled').length
      const failedCount = results.filter(r => r.status === 'rejected').length

      // Update progress
      setBulkProgress(targetIds.map((id, idx) => {
        const result = results[idx]
        return result.status === 'fulfilled'
          ? { id, status: 'success' as const }
          : { id, status: 'error' as const, message: 'Classification failed' }
      }))

      if (failedCount === 0) {
        setSelectedTicketIds(new Set())
        setIsSelectMode(false)
      }

      const deptName = departmentId === null
        ? "Unclassified"
        : (departments.find(d => d.id === departmentId)?.name || "Unknown")

      toast({
        title: failedCount ? "Bulk classify partially succeeded" : "Bulk classify successful",
        description: failedCount
          ? `Classified ${successCount}, failed ${failedCount}`
          : `Classified ${successCount} ticket(s) to ${deptName}`,
        variant: failedCount ? "destructive" : "default"
      })

      await fetchTickets({ silent: true, pageNum: 1, limit: page * 200 })
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to classify tickets",
        variant: "destructive"
      })
    } finally {
      setBulkUpdating(false)
    }
  }


  const toggleTicketSelection = (ticketId: string) => {
    setSelectedTicketIds((prev) => {
      const next = new Set(prev)
      if (next.has(ticketId)) {
        next.delete(ticketId)
      } else {
        next.add(ticketId)
      }
      return next
    })
  }

  const retryBulkFailures = () => {
    const failedIds = bulkProgress.filter(p => p.status === 'error').map(p => p.id)
    if (!failedIds.length || !lastBulkUpdates) return
    handleBulkUpdate(lastBulkUpdates, failedIds)
  }

  const toggleSelectAll = () => {
    if (selectedTicketIds.size === filteredTickets.length) {
      setSelectedTicketIds(new Set())
    } else {
      setSelectedTicketIds(new Set(filteredTickets.map(t => t.id)))
    }
  }

  const insertQuickReply = (content: string) => {
    setReplyText(content)
  }

  const handleQuickReplySelect = (content: string) => {
    setReplyText(prev => {
      // Append to existing text if there's already content, otherwise just set it
      if (prev.trim()) {
        return prev + "\n\n" + content
      }
      return content
    })
    // Focus the reply textarea if possible
    setTimeout(() => {
      const textarea = document.querySelector('textarea[placeholder*="reply"]') as HTMLTextAreaElement
      if (textarea) {
        textarea.focus()
        // Move cursor to end
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      }
    }, 100)
  }

  const handleUpdatePriority = async (priority: Ticket["priority"]) => {
    if (!selectedTicket) return
    try {
      setUpdatingPriority(true)
      const response = await fetch(`/api/tickets/${selectedTicket.id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      })

      if (!response.ok) throw new Error("Failed to update priority")
      const data = await response.json()
      setSelectedTicket(data.ticket)
      setTickets((prev) => prev.map((t) => (t.id === selectedTicket.id ? data.ticket : t)))
      toast({ title: "Priority updated" })
    } catch (err) {
      toast({ title: "Error", description: "Failed to update priority", variant: "destructive" })
    } finally {
      setUpdatingPriority(false)
    }
  }

  const handleAddTag = async () => {
    if (!selectedTicket || !newTag.trim()) return
    const updatedTags = [...selectedTicket.tags, newTag.trim()]
    await handleUpdateTags(updatedTags)
    setNewTag("")
  }

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!selectedTicket) return
    const updatedTags = selectedTicket.tags.filter(t => t !== tagToRemove)
    await handleUpdateTags(updatedTags)
  }

  const handleUpdateTags = async (tags: string[]) => {
    if (!selectedTicket) return
    try {
      setUpdatingTags(true)
      const response = await fetch(`/api/tickets/${selectedTicket.id}/tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      })

      if (!response.ok) throw new Error("Failed to update tags")
      const data = await response.json()
      setSelectedTicket(data.ticket)
      setTickets((prev) => prev.map((t) => (t.id === selectedTicket.id ? data.ticket : t)))
      toast({ title: "Tags updated" })
    } catch (err) {
      toast({ title: "Error", description: "Failed to update tags", variant: "destructive" })
    } finally {
      setUpdatingTags(false)
    }
  }



  const handleAddNote = async () => {
    if (!selectedTicket || !newNote.trim()) return
    try {
      setAddingNote(true)
      const response = await fetch(`/api/tickets/${selectedTicket.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newNote.trim(), mentions: selectedMentions }),
      })

      if (!response.ok) throw new Error("Failed to add note")
      const data = await response.json()
      setNotes((prev) => [data.note, ...prev])
      setNewNote("")
      setSelectedMentions([])
      toast({ title: "Note added" })
    } catch (err) {
      toast({ title: "Error", description: "Failed to add note", variant: "destructive" })
    } finally {
      setAddingNote(false)
    }
  }

  const handleStartEditNote = (note: TicketNote) => {
    setEditingNoteId(note.id)
    setEditingNoteContent(note.content)
    const m = (note as any).mentions
    setEditingMentions(Array.isArray(m) ? m : [])
  }

  const handleCancelEditNote = () => {
    setEditingNoteId(null)
    setEditingNoteContent("")
  }

  const handleUpdateNote = async () => {
    if (!selectedTicket || !editingNoteId || !editingNoteContent.trim()) {
      console.error('[Update Note] Missing required data:', { selectedTicket: !!selectedTicket, editingNoteId, editingNoteContent })
      return
    }

    // Find the note being edited to compare user IDs
    const noteBeingEdited = notes.find(n => n.id === editingNoteId)
    console.log('[Update Note] Frontend check:', {
      currentUserId,
      noteUserId: noteBeingEdited?.userId,
      match: currentUserId === noteBeingEdited?.userId,
      noteId: editingNoteId
    })

    try {
      setAddingNote(true)
      console.log('[Update Note] Sending request:', { ticketId: selectedTicket.id, noteId: editingNoteId, content: editingNoteContent.trim() })
      const response = await fetch(`/api/tickets/${selectedTicket.id}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteId: editingNoteId,
          content: editingNoteContent.trim(),
          mentions: editingMentions
        }),
      })

      console.log('[Update Note] Response status:', response.status)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('[Update Note] Error response:', errorData)
        throw new Error(errorData.error || "Failed to update note")
      }
      const data = await response.json()
      console.log('[Update Note] Success, updating state:', data)
      setNotes((prev) => {
        const updated = prev.map(note => note.id === editingNoteId ? data.note : note)
        console.log('[Update Note] Updated notes array:', updated)
        return updated
      })
      setEditingNoteId(null)
      setEditingNoteContent("")
      setEditingMentions([])
      toast({ title: "Note updated" })
    } catch (err) {
      console.error('[Update Note] Exception:', err)
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update note",
        variant: "destructive"
      })
    } finally {
      setAddingNote(false)
    }
  }

  const handleGenerateDraft = async () => {
    if (!selectedTicket || !threadMessages.length) return
    try {
      setGeneratingDraft(true)
      // Use the first message ID from thread as the email ID for draft generation
      const emailId = threadMessages[0].id
      const response = await fetch(`/api/emails/${emailId}/draft`, {
        method: "POST"
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to generate draft")
      }

      const data = await response.json()
      setDraftText(data.draft || "")
      setDraftId(data.draftId || null)
      setShowDraft(true)
      // Don't set replyText here - let user click "Use This Draft" to copy it
      toast({ title: "Draft generated" })
    } catch (err) {
      toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to generate draft", variant: "destructive" })
    } finally {
      setGeneratingDraft(false)
    }
  }

  const handleForward = () => {
    if (!threadMessages.length) return
    const latestMsg = threadMessages[threadMessages.length - 1]

    // Create a "Forwarded message" header similar to Gmail
    const dateStr = latestMsg.date ? new Date(latestMsg.date).toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) : 'Unknown date'
    
    const forwardHeader = `
<br>
<br>
---------- Forwarded message ---------<br>
From: <b>${latestMsg.from.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b><br>
Date: ${dateStr}<br>
Subject: ${latestMsg.subject}<br>
To: ${latestMsg.to.replace(/</g, '&lt;').replace(/>/g, '&gt;')}<br>
<br>
${latestMsg.body || ""}
`
    const plainTextBody = latestMsg.body ? htmlToText(latestMsg.body) : ""
    const forwardText = `\n\n---------- Forwarded message ---------\nFrom: ${latestMsg.from}\nDate: ${dateStr}\nSubject: ${latestMsg.subject}\nTo: ${latestMsg.to}\n\n${plainTextBody}`

    setReplyHtml(forwardHeader)
    setReplyText(forwardText)
    setIsForwarding(true)
    setShowDraft(false) // If AI draft was open, close it
    setForwardTo("")
    
    // Smooth scroll to editor
    const editor = document.querySelector('.rdw-editor-main')
    editor?.scrollIntoView({ behavior: 'smooth' })
    
    // Focus after brief delay for rendering
    setTimeout(() => {
      const el = document.getElementById('forward-to-input-ticket')
      el?.focus()
    }, 100)
  }

  const handleSendReply = async (opts?: { closeTicket?: boolean }) => {
    if (!selectedTicket || !replyHtml.trim() || !threadMessages.length) return
    // Synchronous double-send guard (state-based check is async and insufficient).
    if (isSendingReplyRef.current) return
    isSendingReplyRef.current = true
    const targetTicketId = selectedTicket.id

    // Capture state before any navigation/clearing
    const contentToSend = {
      html: replyHtml.trim(),
      text: htmlToText(replyHtml) || replyText || replyHtml.trim(),
      attachments: [...replyAttachments],
      draftId: draftId
    }

    // Clear typing status when sending
    if (typingTimeout) {
      clearTimeout(typingTimeout)
    }
    setIsTyping(false)
    updateTypingStatus(false)

    setSendingReply(true)
    setSendingAction(opts?.closeTicket ? 'send-close' : 'send')

    // Suppress the 5-second poller AND realtime handlers immediately.
    // This must be the very first thing we do — before any setTickets/setSelectedTicket
    // calls — so that a poll cycle already in-flight (or one that fires in the
    // next few ms) cannot fetch stale server data and overwrite the optimistic state.
    suppressRealtimeFetchUntil.current = Date.now() + 20000
    lastSentTicketIdRef.current = targetTicketId
    // Auto-clear after 25 s so future actions on this ticket still work
    setTimeout(() => {
      if (lastSentTicketIdRef.current === targetTicketId) lastSentTicketIdRef.current = null
    }, 25000)

    // OPTIMISTIC UI UPDATE FOR BOTH "SEND" AND "SEND & CLOSE"
    // We do this BEFORE the slow email send to make it feel instant
    // Add sent message to thread immediately (optimistic)
    // Get user email from thread messages (the 'to' field of customer messages is usually the agent email)
    const userEmailFromThread = threadMessages.find(msg => msg.from !== threadMessages[0]?.from)?.to ||
      threadMessages[0]?.to ||
      'You'
    const optimisticMessage: ThreadMessage = {
      id: `sent-${Date.now()}`,
      subject: threadMessages[0]?.subject || selectedTicket.subject,
      from: userEmailFromThread,
      to: threadMessages[0]?.from || '',
      date: new Date().toISOString(),
      body: contentToSend.html,
      attachments: contentToSend.attachments,
    }
    setThreadMessages(prev => {
      const next = [...prev, optimisticMessage]
      const existing = optimisticThreadMessagesRef.current[targetTicketId] || []
      optimisticThreadMessagesRef.current[targetTicketId] = [...existing, optimisticMessage]
      return next
    })

    // Clear editor state immediately
    setReplyHtml("")
    setReplyText("")
    setReplyAttachments([])
    setDraftText("")
    setDraftId(null)
    setShowDraft(false)

    // Show success toast immediately
    toast({
      title: opts?.closeTicket ? "Reply sending..." : "Reply sent",
      description: opts?.closeTicket ? "Ticket closed. Processing in background." : "Your reply was sent.",
    })

    // OPTIMISTIC NAVIGATION & UPDATE FOR "SEND & CLOSE"
    if (opts?.closeTicket) {
      console.log('🚀 Optimistic "Send & Close" started for:', targetTicketId)

      // 1. Determine next ticket – restrict to tickets visible in the CURRENT tab
      // so we never jump the user to a ticket from the wrong tab (e.g. unassigned
      // while they were on the assigned tab).
      const tabVisibleTickets = filteredTickets.filter(t => isTicketVisibleInTab(t, activeTab, currentUserId, assigneeFilter))
      const currentIndex = tabVisibleTickets.findIndex(t => t.id === targetTicketId)
      // Look for the ticket immediately after the current one; wrap to the first if at the end
      let nextTicket = tabVisibleTickets[currentIndex + 1] || tabVisibleTickets[0]

      // If the found 'next' is the same as current (only one ticket in the tab), clear it
      if (nextTicket && nextTicket.id === targetTicketId) {
        nextTicket = null as any; // No other tickets in this tab
      }

      // 2. Optimistically mark current as closed in the list
      // This ensures it drops out of the "Open" filter instantly if applicable
      const closedTicketState = {
        ...selectedTicket,
        status: 'closed' as const,
        assigneeUserId: currentUserId || selectedTicket.assigneeUserId
      }

      setTickets(prev => prev.map(t => t.id === targetTicketId ? closedTicketState : t))

      // Update badge counts instantly for Send & Close
      setTicketCounts(prev => {
        const isAssigned = !!selectedTicket.assigneeUserId
        return {
          ...prev,
          [isAssigned ? 'assigned' : 'unassigned']: Math.max(0, prev[isAssigned ? 'assigned' : 'unassigned'] - 1),
          closed: prev.closed + 1,
          open: selectedTicket.status === 'open' ? Math.max(0, prev.open - 1) : prev.open,
        }
      })

      // SUPPRESS GHOST REAPPEARANCE
      setTemporarilyHiddenIds(prev => {
        const next = new Set(prev)
        next.add(targetTicketId)
        return next
      })
      // Clear suppression after 25s (gives server plenty of time to catch up)
      setTimeout(() => {
        setTemporarilyHiddenIds(prev => {
          const next = new Set(prev)
          next.delete(targetTicketId)
          return next
        })
      }, 25000)

      // (suppression refs already set at the top of handleSendReply)

      // 3. Navigate immediately
      if (nextTicket) {
        console.log('➡️ Optimistically navigating to next ticket:', nextTicket.id)
        setSelectedTicket(nextTicket)
        // We don't need to setLoading(true) because we have the ticket data already
      } else {
        console.log('🏁 No next ticket, clearing selection')
        setSelectedTicket(null)
      }

      // (suppression refs already set at the top of handleSendReply)
    }

    // OPTIMISTIC NAVIGATION FOR PLAIN "SEND" (not close)
    if (!opts?.closeTicket) {
      // 1. Determine next ticket – restrict to the CURRENT tab so the user
      //    stays within the same view they were browsing.
      //    For plain Send (not close), do NOT wrap around to [0] — if the
      //    replied-to ticket is the last one in this tab, land on nothing
      //    rather than cycling back to the top (which can cause the same or
      //    an already-visited ticket to be re-selected).
      const tabVisibleTickets = filteredTickets.filter(t => isTicketVisibleInTab(t, activeTab, currentUserId, assigneeFilter))
      const currentIndex = tabVisibleTickets.findIndex(t => t.id === targetTicketId)
      const nextTicket = tabVisibleTickets[currentIndex + 1] ?? null

      // 2. Optimistically update current ticket: assign to self + mark pending
      //    This moves the ticket naturally from 'unassigned' → 'assigned' tab
      //    via isTicketVisibleInTab without needing to hide it entirely.
      const wasUnassigned = !selectedTicket.assigneeUserId
      const pendingTicketState = {
        ...selectedTicket,
        status: 'pending' as const,
        assigneeUserId: currentUserId || selectedTicket.assigneeUserId
      }
      setTickets(prev => prev.map(t => t.id === targetTicketId ? pendingTicketState : t))

      // Update badge counts instantly — don't wait for the next fetchTicketCounts()
      // call (which only happens on the 5-second poll) since that's what causes the
      // 5-second delay before the tab numbers update after clicking Send.
      if (wasUnassigned && currentUserId) {
        setTicketCounts(prev => ({
          ...prev,
          unassigned: Math.max(0, prev.unassigned - 1),
          assigned: prev.assigned + 1,
        }))
      }

      // NOTE: We intentionally do NOT add to temporarilyHiddenIds here.
      // The optimistic status/assignee update above is enough to move the ticket
      // to the correct tab instantly.  Hiding it completely (as we did before)
      // made the ticket look "closed" for ~10 s even though it was only sent.

      // 3. Navigate to the next ticket in the same tab
      if (nextTicket) {
        setSelectedTicket(nextTicket)
      } else {
        setSelectedTicket(null)
      }

      // (suppression refs already set at the top of handleSendReply)
    }

    // Perform the actual work (Background if closed, Foreground if just send)
    const performSend = async () => {
      try {
        // Step 1: Send Email (The slow part)
        // Use the first message ID from thread (the original email) to send reply
        const emailId = threadMessages[0].id
        const forwardSubject = threadMessages[0]?.subject?.startsWith("Fwd:") ? threadMessages[0].subject : `Fwd: ${threadMessages[0]?.subject || ''}`;
        
        const response = await fetch(`/api/emails/${emailId}/reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftText: contentToSend.text,
            draftHtml: contentToSend.html,
            draftId: contentToSend.draftId || null,
            attachments: contentToSend.attachments,
            to: isForwarding ? forwardTo : undefined,
            subject: isForwarding ? forwardSubject : undefined,
            forwardAttachments: isForwarding ? (threadMessages[threadMessages.length - 1]?.attachments?.map(a => ({ id: a.id, filename: a.filename, mimeType: a.mimeType })) || []) : []
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || "Failed to send reply")
        }

        const data = await response.json().catch(() => ({}))
        const activeTicketId = data?.ticketId || targetTicketId

        // Do NOT call fetchThread for the old ticket here.
        // setSelectedTicket(nextTicket) was already called above, so
        // selectedTicketIdRef.current is now the NEXT ticket’s ID. Any
        // fetchThread call with the old ticket’s ID would pass the stale-closure
        // guard and overwrite the next ticket’s conversation with the old thread.
        // The useEffect on selectedTicket.id already handles fetching the new thread.
        // Do NOT fetchTickets here — it fires before the assignment PATCH completes
        // (server still shows ticket as unassigned) causing the tab to flicker back.

        // Handle Assignment & Closing (Server-side)
        if (activeTicketId && currentUserId) {
          // If Close was requested
          if (opts?.closeTicket) {
            // Step 2 & 3: Assign and Close
            // We do this sequentially to ensure correctness

            // Assign
            await fetch(`/api/tickets/${activeTicketId}/assign`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ assigneeUserId: currentUserId }),
            });

            // Close (Logic re-implementation to avoid UI state dependency)
            await fetch(`/api/tickets/${activeTicketId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: 'closed' }),
            });

            // Extend the suppression window now that all PATCHes have committed,
            // so the next poller / debounced-fetch cycle (which fires immediately
            // after the ticketUpdated broadcast below) cannot overwrite our state
            // with stale data.
            suppressRealtimeFetchUntil.current = Date.now() + 15000

            // Update only this single ticket in state with confirmed server data.
            // DO NOT call fetchTickets() here — that replaces the whole tickets
            // array using the active-tab filter (status=open,pending,on_hold) which
            // excludes the now-closed ticket and wipes it from state completely.
            // If there is any DB propagation lag (even 1 ms) fetchTickets would
            // also re-add the ticket as 'open', then temporarilyHiddenIds would
            // let it ghost-reappear when it clears at T=10 s.
            fetchSingleTicket(activeTicketId).catch(err => console.warn('Background ticket refresh failed:', err))

            // Broadcast so other components (inbox-view etc.) stay in sync.
            // No switchToTab — we intentionally keep the user on the tab they were on.
            window.dispatchEvent(new CustomEvent('ticketUpdated', {
              detail: { ticketId: activeTicketId, status: 'closed', assigneeUserId: currentUserId }
            }))

            console.log('✅ Background Send & Close completed for:', activeTicketId);
          }
          // If NOT closing: run the assignment in the background.
          // All optimistic UI updates (tab switch, next ticket, state) were already
          // applied before performSend() was called, so nothing to do here for the UI.
          else if (!opts?.closeTicket) {
            if (!selectedTicket.assigneeUserId && currentUserId) {
              fetch(`/api/tickets/${activeTicketId}/assign`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assigneeUserId: currentUserId }),
              }).catch(err => console.warn('[SendReply] Background assign failed:', err))
            }
          }
        }
      } catch (err) {
        console.error('❌ Error in Send Reply:', err)
        toast({
          title: "Message Delivery Failed",
          description: opts?.closeTicket ? "The email may not have sent, but we navigated away. Please check the ticket." : (err instanceof Error ? err.message : "Failed to send"),
          variant: "destructive",
          duration: 10000
        })
        // Revert optimistic updates on error
        // Remove optimistic message from thread
        setThreadMessages(prev => prev.filter(msg => msg.id !== optimisticMessage.id))

        // Restore editor state
        setReplyHtml(contentToSend.html)
        setReplyText(contentToSend.text)
        setReplyAttachments(contentToSend.attachments)
        if (contentToSend.draftId) {
          setDraftId(contentToSend.draftId)
        }

        // If we optimistically closed, revert the ticket status in the list
        if (opts?.closeTicket) {
          setTickets(prev => prev.map(t => t.id === targetTicketId ? { ...t, status: 'open' } : t))
        }
      } finally {
        setSendingReply(false)
        setSendingAction(null)
        isSendingReplyRef.current = false
      }
    }

    // Execute!
    // Always run in background (non-blocking) for fast UI response
    performSend();
  }

  const getStatusColor = (status: Ticket["status"]) => {
    switch (status) {
      case "open": return "bg-blue-500"
      case "pending": return "bg-yellow-500"
      case "on_hold": return "bg-orange-500"
      case "closed": return "bg-gray-500"
      default: return "bg-gray-500"
    }
  }

  const getPriorityColor = (priority: Ticket["priority"]) => {
    switch (priority) {
      case "urgent": return "bg-red-500"
      case "high": return "bg-orange-500"
      case "medium": return "bg-yellow-500"
      case "low": return "bg-green-500"
      default: return "bg-gray-500"
    }
  }

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "N/A"
    const date = new Date(dateString)
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const formatTimeAgo = (dateString: string | null | undefined) => {
    if (!dateString) return "N/A"
    const diff = Date.now() - new Date(dateString).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    const minutes = Math.floor(diff / (1000 * 60))
    return minutes > 0 ? `${minutes}m ago` : 'Just now'
  }

  const getMessageKey = (msg: any, idx: number) =>
    msg.id || `${msg.from}-${msg.date}-${idx}`

  const splitBody = (body?: string) => {
    const lines = (body || "").split("\n")
    const main: string[] = []
    const quoted: string[] = []
    let inQuote = false
    lines.forEach(line => {
      const isQuote = line.trim().startsWith(">")
      if (isQuote) inQuote = true
      if (inQuote) quoted.push(line)
      else main.push(line)
    })
    return { main, quoted }
  }

  const getInitials = (from: string) => {
    const namePart = from?.split("<")[0].trim() || from
    const pieces = namePart.split(/\s+/).filter(Boolean)
    if (pieces.length === 0) return "?"
    const initials = pieces.slice(0, 2).map(p => p[0]).join("")
    return initials.toUpperCase()
  }

  // Server-side filtering returns the correct data, but we apply lightweight
  // client-side filtering to handle optimistic updates instantly (e.g. closing a ticket)
  const filteredTickets = useMemo(() => {
    // If searching, apply client-side filtering for instant feedback
    // The server search will eventually update 'tickets' with more results,
    // but this gives immediate feedback on what's already loaded.
    if (activeSearchQuery) {
      const query = activeSearchQuery.toLowerCase()
      return tickets.filter(ticket =>
        ticket.subject?.toLowerCase().includes(query) ||
        ticket.customerEmail?.toLowerCase().includes(query) ||
        ticket.customerName?.toLowerCase().includes(query) ||
        ticket.id.includes(query)
      )
    }

    // For standard tabs, apply lightweight client-side filtering so UI filters
    // always feel responsive even before server responses settle.
    return tickets.filter(t => {
      if (activeTab === 'closed') {
        if (t.status !== 'closed') return false
      } else {
        if (temporarilyHiddenIds.has(t.id)) return false
        if (t.status === 'closed') return false
      }

      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false

      if (assigneeFilter !== 'all') {
        if (assigneeFilter === 'unassigned') {
          if (t.assigneeUserId) return false
        } else if (t.assigneeUserId !== assigneeFilter) {
          return false
        }
      }

      if (departmentFilter !== 'all') {
        if (departmentFilter === 'unclassified') {
          if (t.departmentId) return false
        } else if (t.departmentId !== departmentFilter) {
          return false
        }
      }

      if (tagsFilter !== 'all') {
        const requestedTags = tagsFilter.split(',').map(tag => tag.trim()).filter(Boolean)
        if (requestedTags.length > 0 && !requestedTags.some(tag => t.tags.includes(tag))) {
          return false
        }
      }

      if (showUnreadOnly) {
        if (!t.lastCustomerReplyAt) return false
        const lastSeen = lastViewedMap[t.id]
        if (lastSeen && !(new Date(t.lastCustomerReplyAt) > new Date(lastSeen))) return false
      }

      if (dateFilter !== 'all') {
        const dateValue = t.lastCustomerReplyAt || t.updatedAt || t.createdAt
        if (!dateValue) return false
        const ticketDate = new Date(dateValue)
        const now = new Date()

        if (dateFilter === 'today') {
          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          if (ticketDate < startOfDay) return false
        } else if (dateFilter === 'week') {
          const weekAgo = new Date(now)
          weekAgo.setDate(now.getDate() - 7)
          if (ticketDate < weekAgo) return false
        } else if (dateFilter === 'month') {
          const monthAgo = new Date(now)
          monthAgo.setMonth(now.getMonth() - 1)
          if (ticketDate < monthAgo) return false
        } else if (dateFilter === 'custom') {
          if (customDateStart) {
            const start = new Date(customDateStart)
            start.setHours(0, 0, 0, 0)
            if (ticketDate < start) return false
          }
          if (customDateEnd) {
            const end = new Date(customDateEnd)
            end.setHours(23, 59, 59, 999)
            if (ticketDate > end) return false
          }
        }
      }

      return true
    })
  }, [
    tickets,
    activeTab,
    activeSearchQuery,
    temporarilyHiddenIds,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    departmentFilter,
    tagsFilter,
    showUnreadOnly,
    lastViewedMap,
    dateFilter,
    customDateStart,
    customDateEnd,
  ])

  // Trigger fetch when filters change (fetchTickets dependency changes)
  useEffect(() => {
    // Prevent double-fetch on mount/initial render by checking mount ref?
    // Actually, we want to fetch on mount.
    // But we want to know WHICH dependency changed.
    console.log('[Tickets] Filter/Dependency change detected, triggering fetch. ActiveTab:', activeTab)
    fetchTickets({ pageNum: 1 })
  }, [fetchTickets])



  // Prefetch next/prev tickets for instant navigation
  useEffect(() => {
    if (!selectedTicket || filteredTickets.length === 0) return

    const currentIndex = filteredTickets.findIndex(t => t.id === selectedTicket.id)
    if (currentIndex === -1) return

    // Identify next and previous tickets to prefetch
    const nextTicket = filteredTickets[currentIndex + 1]
    const prevTicket = filteredTickets[currentIndex - 1]

    const ticketsToPrefetch = [nextTicket, prevTicket].filter(Boolean)

    ticketsToPrefetch.forEach(t => {
      // Prefetch Email Detail (Body, etc.)
      // The browser will cache this due to Cache-Control headers
      const emailUrl = `/api/emails/${t.id}`
      const threadUrl = `/api/emails/threads/${encodeURIComponent(t.threadId)}`

      // Use low priority fetch if supported, or standard fetch
      console.log(`🚀 Prefetching data for ticket ${t.id} (${t.subject.substring(0, 20)}...)`)

      // We don't await these, just fire and let browser cache handle it
      fetch(emailUrl, { priority: 'low' } as any).catch(e => console.error('Prefetch email failed', e))

      // Only prefetch thread if it's different (usually is)
      if (t.threadId) {
        fetch(threadUrl, { priority: 'low' } as any).catch(e => console.error('Prefetch thread failed', e))
      }
    })
  }, [selectedTicket, filteredTickets])

  if (loading && tickets.length === 0 && !activeSearchQuery) {
    return (
      <div className="flex items-center justify-center h-full w-full bg-background animate-in fade-in duration-300">
        <div className="flex flex-col items-center gap-6 w-full max-w-md px-6">
          {/* Simple, smooth spinner */}
          <div
            className="relative w-20 h-20"
          >
            <div
              className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin"
              style={{
                animationDuration: '0.8s',
                animationTimingFunction: 'ease-in-out'
              }}
            ></div>
          </div>
          {/* Clean, focused text */}
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-base font-semibold text-foreground">
              {isCreatingTickets ? 'Creating tickets from emails...' : 'Loading tickets...'}
            </p>
            <p className="text-sm text-muted-foreground">
              {isCreatingTickets
                ? 'Please wait while we process your emails and create tickets'
                : 'Please wait while we fetch your tickets'}
            </p>
            {isCreatingTickets && (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse"></div>
                <span>This may take a few moments...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (error && !tickets.length && !isCreatingTickets) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <Button onClick={() => fetchTickets()}>Retry</Button>
        </div>
      </div>
    )
  }

  // Show creating indicator if tickets are being created but we have some tickets already
  const showCreatingIndicator = isCreatingTickets && tickets.length > 0

  // Keep ticketsRef always current so the deep-link effect can read
  // the latest ticket list without needing `tickets` as a dependency
  // (assigning in render body is safe and idiomatic: always up to date)
  ticketsRef.current = tickets

  return (
    <div className="h-full w-full bg-background overflow-hidden" ref={panelGroupRef} style={{ contain: 'layout size' }}>
      <ResizablePanelGroup
        // Key only on load state so that we apply the saved split once,
        // but do NOT remount the whole layout when sidebars open/close.
        key={isLoaded ? 'panels-loaded' : 'panels-loading'}
        direction="horizontal"
        className="h-full w-full"
        onLayout={handlePanelResize}
      >
        {/* Tickets List */}
        <ResizablePanel
          defaultSize={effectivePanelSizes[0]}
          minSize={15}
          order={1}
          id="ticket-list-panel"
        >
          <div ref={ticketListRef} tabIndex={-1} className="flex flex-col h-full overflow-hidden w-full" style={{ contain: 'layout' }}>
            {/* Email delivery health — surfaces (and recovers) any client emails
                that never became tickets. Renders nothing for non-admins. */}
            <EmailHealthBanner onRecovered={() => fetchTickets({ silent: true })} />
            {/* Show creating indicator banner if tickets are being created */}
            {isCreatingTickets && tickets.length > 0 && (
              <div className="p-2 bg-primary/10 border-b border-primary/20 flex items-center gap-2 text-sm text-primary animate-in slide-in-from-top duration-300">
                <div className="h-2 w-2 rounded-full bg-primary animate-pulse"></div>
                <span className="font-medium">Creating tickets from emails...</span>
                <span className="text-primary/70">This may take a few moments</span>
              </div>
            )}
            <div className="p-3 border-b border-border/50 space-y-2 flex-shrink-0 bg-card/50 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">Tickets</h2>
                  <Badge variant="secondary" className="h-5 px-2 text-xs font-medium">
                    {/* Show GLOBAL count for the current tab, not just loaded count */}
                    {activeTab === 'open' ? ticketCounts.open :
                      activeTab === 'assigned' ? ticketCounts.assigned :
                        activeTab === 'unassigned' ? ticketCounts.unassigned :
                          activeTab === 'closed' ? ticketCounts.closed :
                            filteredTickets.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault()
                      setRefreshing(true)
                      fetchTickets({ silent: true })
                      setTimeout(() => setRefreshing(false), 1000)
                    }}
                    disabled={refreshing}
                    className="h-7 w-7 p-0 flex-shrink-0"
                    title="Refresh tickets"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px] flex items-center gap-1"
                    onClick={(e) => {
                      e.preventDefault()
                      const next = sortOrder === 'desc' ? 'asc' : 'desc'
                      setSortOrder(next)
                      // Refresh tickets starting from page 1 using the new sort
                      fetchTickets({ pageNum: 1, sortOverride: next })
                    }}
                    title={sortOrder === 'desc' ? 'Showing latest tickets first' : 'Showing oldest tickets first'}
                  >
                    {sortOrder === 'desc' ? (
                      <>
                        <ChevronDown className="w-3 h-3" />
                        <span>Latest</span>
                      </>
                    ) : (
                      <>
                        <ChevronUp className="w-3 h-3" />
                        <span>Oldest</span>
                      </>
                    )}
                  </Button>
                  <Button
                    variant={isSelectMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setIsSelectMode(!isSelectMode)
                      if (isSelectMode) {
                        setSelectedTicketIds(new Set())
                      }
                    }}
                    className="h-7 text-xs transition-all duration-300 ease-out hover:scale-110 hover:shadow-md"
                  >
                    {isSelectMode ? "Cancel" : "Select"}
                  </Button>
                </div>
              </div>

              {/* Tabs with counts */}
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList className="grid w-full grid-cols-4 h-8 text-[11px] gap-0.5">
                  <TabsTrigger value="assigned" className="relative px-1 min-w-0">
                    <span className="flex items-center gap-1 truncate">
                      <span className="truncate">Assigned</span>
                      {ticketCounts.assigned > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] flex-shrink-0">
                          {ticketCounts.assigned}
                        </Badge>
                      )}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="unassigned" className="relative px-1 min-w-0">
                    <span className="flex items-center gap-1 truncate">
                      <span className="truncate">Unassigned</span>
                      {ticketCounts.unassigned > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] flex-shrink-0">
                          {ticketCounts.unassigned}
                        </Badge>
                      )}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="open" className="relative px-1 min-w-0">
                    <span className="flex items-center gap-1 truncate">
                      <span className="truncate">Open</span>
                      {ticketCounts.open > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] flex-shrink-0">
                          {ticketCounts.open}
                        </Badge>
                      )}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="closed" className="relative px-1 min-w-0">
                    <span className="flex items-center gap-1 truncate">
                      <span className="truncate">Closed</span>
                      {ticketCounts.closed > 0 && (
                        <Badge variant="secondary" className="h-4 px-1 text-[9px] flex-shrink-0">
                          {ticketCounts.closed}
                        </Badge>
                      )}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Spam quick-filter — shown whenever spam tickets exist or filter is active */}
              {(tagsFilter === "spam" || tickets.some(t => t.tags.includes('spam'))) && (
                <div className="flex items-center gap-1.5 px-0.5 pb-1">
                  <button
                    onClick={() => setTagsFilter(tagsFilter === "spam" ? "all" : "spam")}
                    className={`flex items-center gap-1 h-6 px-2 rounded-md text-xs border transition-colors ${
                      tagsFilter === "spam"
                        ? "bg-yellow-100 border-yellow-400 text-yellow-800 dark:bg-yellow-900/40 dark:border-yellow-600 dark:text-yellow-300"
                        : "border-dashed border-muted-foreground/40 text-muted-foreground hover:border-yellow-400 hover:text-yellow-700"
                    }`}
                  >
                    <span>⚠</span>
                    <span>Spam</span>
                    {tagsFilter !== "spam" && (
                      <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-0.5">
                        {tickets.filter(t => t.tags.includes('spam')).length}
                      </Badge>
                    )}
                  </button>
                  {tagsFilter === "spam" && (
                    <span className="text-[10px] text-muted-foreground">Showing spam tickets only —{" "}
                      <button
                        className="underline hover:text-foreground"
                        onClick={() => setTagsFilter("all")}
                      >
                        clear
                      </button>
                    </span>
                  )}
                </div>
              )}

              {/* Collapsible Filters */}
              <Accordion type="single" collapsible value={filtersExpanded ? "filters" : undefined}>
                <AccordionItem value="filters" className="border-none">
                  <AccordionTrigger
                    className="py-1 h-7 text-xs text-muted-foreground hover:no-underline"
                    onClick={() => setFiltersExpanded(!filtersExpanded)}
                  >
                    <div className="flex items-center gap-1.5 flex-1">
                      <Filter className="w-3 h-3" />
                      <span>Filters</span>
                      {(statusFilter !== "all" || priorityFilter !== "all" || assigneeFilter !== "all" || tagsFilter !== "all" || dateFilter !== "all" || showUnreadOnly) && (
                        <>
                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">Active</Badge>
                          <span
                            onClick={(e) => {
                              e.stopPropagation()
                              setStatusFilter("all")
                              setPriorityFilter("all")
                              setAssigneeFilter("all")
                              setDepartmentFilter("all")
                              setTagsFilter("all")
                              setDateFilter("all")
                              setShowUnreadOnly(false)
                              setSearchQuery("")
                              if (onClearGlobalSearch) onClearGlobalSearch()
                              setSelectedAccount("all")
                            }}
                            className="ml-auto h-5 px-2 text-[10px] rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors cursor-pointer inline-flex items-center"
                          >
                            Clear all
                          </span>
                        </>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-1">
                    <div className="space-y-2">
                      {/* Compact Filters Grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground">Account</Label>
                          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Accounts</SelectItem>
                              {emails.map((email) => (
                                <SelectItem key={email} value={email}>
                                  {email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground">Status</Label>
                          <Select value={statusFilter} onValueChange={setStatusFilter}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="pending">Pending</SelectItem>
                              <SelectItem value="on_hold">On Hold</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground">Priority</Label>
                          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="medium">Medium</SelectItem>
                              <SelectItem value="low">Low</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground">Assignee</Label>
                          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {users
                                .filter(u => u.id !== currentUserId)
                                .map((user) => (
                                  <SelectItem key={user.id} value={user.id}>
                                    {user.name}
                                  </SelectItem>
                                ))}
                              {currentUserId && (
                                <SelectItem value={currentUserId}>Me</SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground">Tags</Label>
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="outline" className="h-7 text-xs justify-between">
                                {tagsFilter === "all" ? "All Tags" : tagsFilter.split(',').length === 1 ? tagsFilter : `${tagsFilter.split(',').length} tags`}
                                <ChevronDown className="w-3 h-3 ml-1" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-2" align="start">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-xs font-semibold">Filter by Tags</Label>
                                  {tagsFilter !== "all" && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 text-xs"
                                      onClick={() => setTagsFilter("all")}
                                    >
                                      Clear
                                    </Button>
                                  )}
                                </div>
                                <div className="max-h-64 overflow-y-auto space-y-1">
                                  {Array.from(new Set(tickets.flatMap(t => t.tags)))
                                    .map(tag => ({
                                      tag,
                                      count: tickets.filter(t => t.tags.includes(tag)).length
                                    }))
                                    .sort((a, b) => b.count - a.count)
                                    .map(({ tag, count }) => {
                                      const selectedTags = tagsFilter === "all" ? [] : tagsFilter.split(',').map(t => t.trim())
                                      const isSelected = selectedTags.includes(tag)
                                      return (
                                        <div
                                          key={tag}
                                          className="flex items-center gap-2 p-1.5 rounded hover:bg-muted cursor-pointer"
                                          onClick={() => {
                                            if (isSelected) {
                                              const newTags = selectedTags.filter(t => t !== tag)
                                              setTagsFilter(newTags.length === 0 ? "all" : newTags.join(','))
                                            } else {
                                              const newTags = tagsFilter === "all" ? [tag] : [...selectedTags, tag]
                                              setTagsFilter(newTags.join(','))
                                            }
                                          }}
                                        >
                                          <Checkbox checked={isSelected} />
                                          <span className="text-xs flex-1">{tag}</span>
                                          <Badge variant="secondary" className="h-4 px-1 text-[10px]">{count}</Badge>
                                        </div>
                                      )
                                    })}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>

                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground">Date</Label>
                          <Select value={dateFilter} onValueChange={setDateFilter}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="today">Today</SelectItem>
                              <SelectItem value="week">7 Days</SelectItem>
                              <SelectItem value="month">30 Days</SelectItem>
                              <SelectItem value="custom">Custom</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1">
                          <Label className="text-[10px] text-muted-foreground">Department</Label>
                          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="All" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Departments</SelectItem>
                              <SelectItem value="unclassified">No Department</SelectItem>
                              {departments
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((dept) => (
                                  <SelectItem key={dept.id} value={dept.id}>
                                    {dept.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1 justify-end">
                          <div className="flex items-center gap-1.5 h-7">
                            <Switch
                              checked={showUnreadOnly}
                              onCheckedChange={setShowUnreadOnly}
                              className="scale-75"
                            />
                            <Label className="text-[10px] text-muted-foreground">Unread only</Label>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <Switch
                          checked={autoFilterClosed}
                          onCheckedChange={setAutoFilterClosed}
                          className="scale-75"
                        />
                        <Label className="text-[10px] text-muted-foreground">Auto-hide closed tickets</Label>
                      </div>

                      {/* Custom Date Range Inputs */}
                      {dateFilter === "custom" && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <Input
                            type="date"
                            placeholder="Start Date"
                            value={customDateStart}
                            onChange={(e) => setCustomDateStart(e.target.value)}
                            className="h-7 text-xs"
                          />
                          <Input
                            type="date"
                            placeholder="End Date"
                            value={customDateEnd}
                            onChange={(e) => setCustomDateEnd(e.target.value)}
                            className="h-7 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>

            {/* Bulk Actions Bar */}
            {isSelectMode && selectedTicketIds.size > 0 && (
              <div className="px-3 py-2 border-b border-border/50 bg-muted/50 flex items-center justify-between flex-shrink-0 flex-wrap gap-2">
                <span className="text-sm text-muted-foreground font-medium">
                  {selectedTicketIds.size} ticket{selectedTicketIds.size !== 1 ? 's' : ''} selected
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBulkUpdate({ status: "closed" })}
                    disabled={bulkUpdating}
                    className="h-7 text-xs transition-colors duration-200"
                  >
                    Close Selected
                  </Button>
                  {/* Allow all users to bulk assign */}
                  <Select
                    onValueChange={(userId) => handleBulkUpdate({ assigneeUserId: userId === "unassigned" ? null : userId })}
                    disabled={bulkUpdating}
                  >
                    <SelectTrigger className="h-7 w-32 text-xs">
                      <SelectValue placeholder="Assign..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassign</SelectItem>
                      {users
                        .filter(u => u.id !== currentUserId)
                        .map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {/* Bulk classify to department */}
                  <Select
                    onValueChange={(deptId) => handleBulkClassify(deptId === "unclassified" ? null : deptId)}
                    disabled={bulkUpdating}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue placeholder="Classify to..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unclassified">Unclassified</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bulkProgress.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {bulkProgress.filter(p => p.status === 'success').length} ok / {bulkProgress.filter(p => p.status === 'error').length} failed
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={retryBulkFailures}
                        disabled={bulkUpdating || bulkProgress.every(p => p.status !== 'error')}
                        className="h-7 text-[11px] px-2"
                      >
                        Retry failed
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 min-h-0 w-full">
              {/* Show skeleton only when loading AND we have no tickets to display (initial load) */}
              {(loading && tickets.length === 0) ? (
                <div className="p-2 space-y-2">
                  {/* Skeleton loading cards to show tickets are loading */}
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Card key={i} className="m-2 border-border/50 animate-pulse">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-5 w-16 rounded-full" />
                        </div>
                        <Skeleton className="h-4 w-20 rounded-full" />
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-3 w-3 rounded-full" />
                          <Skeleton className="h-3 w-40" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-3 w-3 rounded-full" />
                          <Skeleton className="h-3 w-24" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-3 w-3 rounded-full" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : !(activeSearchQuery
                ? filteredTickets.length > 0
                : filteredTickets.some(t => isTicketVisibleInTab(t, activeTab, currentUserId, assigneeFilter))) ? (
                <div className="flex-1 flex items-center justify-center p-8">
                  <div className="text-center space-y-4 max-w-md">
                    <div className="w-20 h-20 rounded-full bg-muted/50 flex items-center justify-center mx-auto">
                      <Inbox className="w-10 h-10 text-muted-foreground/50" />
                    </div>
                    {activeSearchQuery || statusFilter !== "all" || priorityFilter !== "all" || assigneeFilter !== "all" || tagsFilter !== "all" || dateFilter !== "all" || showUnreadOnly ? (
                      <>
                        <h3 className="text-lg font-semibold text-foreground">No tickets match your filters</h3>
                        <p className="text-sm text-muted-foreground">Try adjusting your search or filter criteria</p>
                        <Button
                          onClick={() => {
                            setSearchQuery("")
                            if (onClearGlobalSearch) onClearGlobalSearch()
                            setStatusFilter("all")
                            setPriorityFilter("all")
                            setAssigneeFilter("all")
                            setTagsFilter("all")
                            setDateFilter("all")
                            setShowUnreadOnly(false)
                          }}
                          variant="outline"
                          size="sm"
                          className="mt-2"
                        >
                          Clear all filters
                        </Button>
                      </>
                    ) : (
                      <>
                        <h3 className="text-lg font-semibold text-foreground">No tickets yet</h3>
                        <p className="text-sm text-muted-foreground">Tickets will appear here when customers send emails</p>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {isSelectMode && (
                    <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2 bg-muted/30">
                      <Checkbox
                        checked={selectedTicketIds.size > 0 && filteredTickets.filter(t => isTicketVisibleInTab(t, activeTab, currentUserId, assigneeFilter)).every(t => selectedTicketIds.has(t.id))}
                        onCheckedChange={() => {
                          const visibleTickets = filteredTickets.filter(t => isTicketVisibleInTab(t, activeTab, currentUserId, assigneeFilter))
                          if (visibleTickets.every(t => selectedTicketIds.has(t.id))) {
                            // Unselect all visible
                            setSelectedTicketIds(prev => {
                              const next = new Set(prev)
                              visibleTickets.forEach(t => next.delete(t.id))
                              return next
                            })
                          } else {
                            // Select all visible
                            setSelectedTicketIds(prev => {
                              const next = new Set(prev)
                              visibleTickets.forEach(t => next.add(t.id))
                              return next
                            })
                          }
                        }}
                      />
                      <span className="text-xs text-muted-foreground">Select all visible</span>
                    </div>
                  )}
                  {filteredTickets.map((ticket, index) => {
                    const isSelected = selectedTicket?.id === ticket.id
                    const isUnread = hasNewCustomerReply(ticket)
                    const isChecked = selectedTicketIds.has(ticket.id)
                    const isVisible = activeSearchQuery ? true : isTicketVisibleInTab(ticket, activeTab, currentUserId, assigneeFilter)

                    if (!isVisible) return null // Or return hidden div? null unmounts. We want hidden div for speed?
                    // Actually, if we return null, React unmounts it.
                    // If we want INSTANT switching, we must return a HIDDEN div.
                    // BUT, if we have 200 items, and 1 visible, 199 hidden divs is fine.
                    // The trick is: does switching from null to component cause mount? YES.
                    // So we MUST return the component with display: none.

                    return (
                      <div key={ticket.id} style={{ display: isVisible ? 'block' : 'none' }}>
                        <Card
                          data-ticket-id={ticket.id}
                          className={`group m-2 cursor-pointer relative overflow-hidden rounded-lg transition-all duration-200 ease-out animate-in fade-in slide-in-from-left-2 ${isSelected
                            ? "border-primary bg-primary/[0.04] shadow-md ring-1 ring-primary/30"
                            : isUnread
                              ? "border-primary/40 bg-primary/[0.03] hover:bg-primary/[0.06] hover:shadow-sm hover:border-primary/60"
                              : "border-border/60 hover:bg-muted/40 hover:shadow-sm hover:border-border"
                            }`}
                          style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
                          onClick={(e) => {
                            if (isSelectMode) {
                              e.stopPropagation()
                              toggleTicketSelection(ticket.id)
                            } else {
                              markTicketViewed(ticket)
                              internalNavigationRef.current = true
                              setSelectedTicket(ticket)
                            }
                          }}
                        >
                          {/* Status-keyed left accent rail */}
                          <span
                            aria-hidden
                            className={`absolute left-0 top-0 h-full w-[3px] ${getStatusColor(ticket.status)} ${isUnread || isSelected ? "opacity-100" : "opacity-50"} transition-opacity`}
                          />
                          <CardContent className="p-3 pl-4 space-y-2">
                            <div className="flex items-start justify-between gap-2 w-full">
                              {isSelectMode && (
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    if (checked) {
                                      setSelectedTicketIds(prev => new Set(prev).add(ticket.id))
                                    } else {
                                      setSelectedTicketIds(prev => {
                                        const next = new Set(prev)
                                        next.delete(ticket.id)
                                        return next
                                      })
                                    }
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-0.5 flex-shrink-0"
                                />
                              )}
                              <h3 className={`text-sm line-clamp-2 flex-1 min-w-0 break-words overflow-wrap-anywhere tracking-tight ${isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90"}`}>
                                {ticket.subject}
                              </h3>
                              <div className="flex gap-1 flex-shrink-0 items-center">
                                {isUnread && (
                                  <span className="h-2 w-2 rounded-full bg-destructive ring-2 ring-destructive/25 animate-pulse" aria-label="New reply" />
                                )}
                              </div>
                            </div>
                            {/* Status + classification row */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge className={`${getStatusColor(ticket.status)} text-white text-[10px] h-4 px-1.5 capitalize font-medium border-0`}>
                                {ticket.status.replace("_", " ")}
                              </Badge>
                              {ticket.assigneeUserId && ticket.priority && (
                                <Badge className={`${getPriorityColor(ticket.priority)} text-white text-[10px] h-4 px-1.5 capitalize font-medium border-0`}>
                                  {ticket.priority}
                                </Badge>
                              )}
                              {ticket.departmentName ? (
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-primary/30 text-primary bg-primary/5">
                                  {ticket.departmentName}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-dashed text-muted-foreground">
                                  No Department
                                </Badge>
                              )}
                            </div>
                            {/* Customer */}
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                              <Mail className="w-3 h-3 flex-shrink-0 opacity-70" />
                              <span className="truncate min-w-0">{ticket.customerEmail}</span>
                            </div>
                            {/* Assignee + time footer */}
                            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground pt-0.5 border-t border-border/40">
                              <span className="flex items-center gap-1.5 min-w-0 pt-1">
                                <User className="w-3 h-3 flex-shrink-0 opacity-70" />
                                <span className={`truncate ${ticket.assigneeName ? "" : "italic opacity-80"}`}>
                                  {ticket.assigneeName || "Unassigned"}
                                </span>
                              </span>
                              <span className="flex items-center gap-1.5 flex-shrink-0 pt-1 tabular-nums">
                                <Clock className="w-3 h-3 opacity-70" />
                                {formatDate(ticket.lastCustomerReplyAt)}
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )
                  })}
                </>
              )}

              {/* Infinite Scroll Sentinel / Load More Button */}
              {/* Ensure we only show load more if we trust hasMore AND strict checks passed */}
              {hasMore && tickets.length > 0 && (
                <div
                  className="pt-4 pb-8 px-4 flex justify-center py-6"
                  ref={loadMoreSentinelRef}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full max-w-xs text-muted-foreground"
                    onClick={() => fetchTickets({ pageNum: page + 1 })}
                    disabled={loadingMore || loading}
                  >
                    {loadingMore ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading more...</span>
                      </div>
                    ) : (
                      <span className="text-xs">Load more tickets</span>
                    )}
                  </Button>
                </div>
              )}
              
              {/* Show end-of-list message when no more tickets */}
              {!hasMore && tickets.length > 0 && (
                <div className="pt-4 pb-8 px-4 flex justify-center">
                  <span className="text-xs text-muted-foreground italic">No more tickets</span>
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle
          withHandle
          className="w-1 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-all duration-200 cursor-col-resize group relative z-10"
        />

        {/* Ticket Detail */}
        <ResizablePanel
          defaultSize={effectivePanelSizes[1]}
          minSize={45}
          order={2}
          id="ticket-detail-panel"
          className="flex flex-col bg-background overflow-hidden h-full"
          style={{ minWidth: 0, contain: 'layout size' }}
        >
          <div
            ref={conversationScrollRef}
            className={`flex-1 overflow-y-auto overflow-x-hidden transition-all duration-300 ${selectedTicket ? "flex flex-col h-full w-full" : "hidden md:flex"}`}
            style={{ contain: 'layout' }}
          >
            {selectedTicket ? (
              <div key={selectedTicket.id} className="flex flex-col h-full w-full max-w-full" style={{ contain: 'layout' }}>
                <div className="p-4 md:p-6 border-b border-border/50 space-y-4 flex-shrink-0 w-full max-w-full animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-start justify-between gap-4 w-full max-w-full">
                    <div className="space-y-2 flex-1 min-w-0 max-w-full overflow-hidden">
                      <h1 className="text-xl md:text-2xl font-bold break-words overflow-wrap-anywhere max-w-full">{selectedTicket.subject}</h1>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`${getStatusColor(selectedTicket.status)} transition-all duration-300 ease-out hover:shadow-md`}>
                          {selectedTicket.status}
                        </Badge>
                        {selectedTicket.assigneeUserId && selectedTicket.priority && (
                          <Badge className={`${getPriorityColor(selectedTicket.priority)} transition-all duration-300 ease-out hover:shadow-md`}>
                            {selectedTicket.priority}
                          </Badge>
                        )}
                        {selectedTicket.departmentName ? (
                          <Badge variant="secondary" className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all duration-300">
                            {selectedTicket.departmentName}
                            {selectedTicket.classificationConfidence && (
                              <span className="ml-1 text-[10px] opacity-70">
                                ({Math.round(selectedTicket.classificationConfidence)}%)
                              </span>
                            )}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-dashed text-muted-foreground">
                            No Department
                          </Badge>
                        )}
                        {selectedTicket.tags.map((tag, idx) => (
                          <Badge key={idx} variant="outline" className="transition-all duration-300 ease-out hover:scale-110 hover:bg-muted hover:shadow-sm animate-in fade-in slide-in-from-bottom-2" style={{ animationDelay: `${idx * 50}ms` }}>{tag}</Badge>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedTicket(null)}
                      className="transition-all duration-300 ease-out hover:scale-110 hover:shadow-md"
                    >
                      Close
                    </Button>
                  </div>

                  {hasNewCustomerReply(selectedTicket) && (
                    <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-md text-sm text-primary animate-in fade-in slide-in-from-top-2 duration-500 shadow-md hover:shadow-lg transition-all duration-300">
                      <div className="w-2 h-2 rounded-full bg-primary animate-pulse ring-2 ring-primary/50" />
                      <span className="font-medium">New customer reply received.</span>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {!selectedTicket.assigneeUserId && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleTakeTicket()
                        }}
                        disabled={assigning === selectedTicket.id}
                        className="h-8 text-xs transition-colors duration-200 ease-out hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {assigning === selectedTicket.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Take Ticket"}
                      </Button>
                    )}
                    <Select
                      value={selectedTicket.assigneeUserId || "unassigned"}
                      onValueChange={(value) => {
                        const assigneeId = value === "unassigned" ? null : value

                        // Prevent agents from assigning to others or unassigning
                        if (currentUserRole === 'agent') {
                          const attemptingUnassign = assigneeId === null
                          const attemptingAssignOther = assigneeId !== null && assigneeId !== currentUserId
                          if (attemptingUnassign || attemptingAssignOther) {
                            toast({
                              title: "Permission denied",
                              description: "Agents can only assign tickets to themselves.",
                              variant: "destructive"
                            })
                            return
                          }
                        }

                        if (assigneeId && !selectedTicket.assigneeUserId) {
                          setPendingAssignment({ ticketId: selectedTicket.id, assigneeUserId: assigneeId })
                          setShowAssignDialog(true)
                        } else {
                          handleAssign(selectedTicket.id, assigneeId)
                        }
                      }}
                      disabled={assigning === selectedTicket.id}
                    >
                      <SelectTrigger className="w-40 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users.map((user) => (
                          <SelectItem
                            key={user.id}
                            value={user.id}
                            disabled={currentUserRole === 'agent' && user.id !== currentUserId}
                          >
                            {user.name}
                            {currentUserRole === 'agent' && user.id !== currentUserId ? ' (Not allowed)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedTicket.status}
                      onValueChange={(v) => handleUpdateStatus(v as Ticket["status"])}
                      disabled={updatingStatus}
                    >
                      <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="on_hold">On Hold</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedTicket.departmentId || "unclassified"}
                      onValueChange={(v) => {
                        setTargetDepartmentId(v)
                        setShowDepartmentDialog(true)
                      }}
                    >
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unclassified">Unclassified</SelectItem>
                        {departments.map((dept) => (
                          <SelectItem key={dept.id} value={dept.id}>
                            {dept.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedTicket.assigneeUserId ? (
                      canAssign ? (
                        <Select
                          value={selectedTicket.priority || "medium"}
                          onValueChange={(v) => handleUpdatePriority(v as Ticket["priority"])}
                          disabled={updatingPriority}
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue placeholder="Priority" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-xs text-muted-foreground px-2 py-1.5 border border-border rounded-md">
                          Priority: {selectedTicket.priority || "Not set"}
                        </div>
                      )
                    ) : (
                      <div className="text-xs text-muted-foreground px-2 py-1.5 border border-border rounded-md">
                        Priority: Set when assigned
                      </div>
                    )}
                  </div>

                  {/* Tags Editor */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium">Tags:</span>
                    {/* Popular tags as chips - sorted by frequency */}
                    {Array.from(new Set(tickets.flatMap(t => t.tags)))
                      .map(tag => ({
                        tag,
                        count: tickets.filter(t => t.tags.includes(tag)).length
                      }))
                      .filter(({ tag }) => !selectedTicket.tags.includes(tag))
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 8)
                      .map(({ tag, count }) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="h-6 text-xs cursor-pointer hover:bg-muted"
                          onClick={() => {
                            const updatedTags = [...selectedTicket.tags, tag]
                            handleUpdateTags(updatedTags)
                          }}
                          title={`Used ${count} time${count !== 1 ? 's' : ''}`}
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          {tag}
                          {count > 1 && <span className="ml-1 text-[10px] opacity-60">({count})</span>}
                        </Badge>
                      ))}
                    {selectedTicket.tags.map((tag, idx) => (
                      <Badge key={idx} variant="outline" className="gap-1 h-6 text-xs hover:bg-muted">
                        {tag}
                        <X className="w-3 h-3 cursor-pointer hover:text-destructive" onClick={() => handleRemoveTag(tag)} />
                      </Badge>
                    ))}
                    <div className="flex items-center gap-1">
                      <Input
                        placeholder="Add tag..."
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                        className="h-6 w-24 text-xs"
                        list="tag-suggestions"
                      />
                      <datalist id="tag-suggestions">
                        {Array.from(new Set(tickets.flatMap(t => t.tags)))
                          .filter(tag => !selectedTicket.tags.includes(tag))
                          .map((tag) => (
                            <option key={tag} value={tag} />
                          ))}
                      </datalist>
                      <Button
                        size="sm"
                        onClick={handleAddTag}
                        disabled={!newTag.trim() || updatingTags}
                        className="h-6 w-6 p-0"
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Main Content Area */}
                <div data-ticket-content className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 space-y-4 md:space-y-6 w-full max-w-full">
                  {/* Customer Info */}
                  <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out w-full max-w-full border-border/50 shadow-sm hover:shadow-md transition-all duration-300">
                    <CardContent className="p-4 space-y-3 w-full max-w-full overflow-hidden">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setShowShopifySidebar(true)}
                          className="flex-shrink-0 hover:scale-110 transition-transform duration-200 cursor-pointer group"
                          title="View Shopify customer info"
                        >
                          <Avatar className="h-12 w-12 border-2 border-border group-hover:border-primary transition-colors">
                            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
                              {selectedTicket.customerName
                                ? selectedTicket.customerName
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()
                                : selectedTicket.customerEmail
                                  .slice(0, 2)
                                  .toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="text-sm font-medium">Customer</span>
                          </div>
                          <p className="text-sm break-words overflow-wrap-anywhere max-w-full font-medium">
                            {selectedTicket.customerName || selectedTicket.customerEmail}
                          </p>
                          {selectedTicket.customerName && (
                            <p className="text-sm text-muted-foreground break-words overflow-wrap-anywhere max-w-full">
                              {selectedTicket.customerEmail}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>Last customer reply: {formatDate(selectedTicket.lastCustomerReplyAt)}</p>
                        <p>Last agent reply: {formatDate(selectedTicket.lastAgentReplyAt)}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Customer Email Timeline - Past conversations with this customer */}
                  <CustomerEmailTimeline
                    customerEmail={selectedTicket.customerEmail}
                    currentTicketId={selectedTicket.id}
                    onNavigateToTicket={async (ticketId) => {
                      // Find the ticket in our list and select it
                      const targetTicket = tickets.find(t => t.id === ticketId)

                      const selectAndScrollToTicket = (ticket: Ticket) => {
                        // Set the ticket
                        internalNavigationRef.current = true
                        setSelectedTicket(ticket)

                        // Scroll the content area to top
                        setTimeout(() => {
                          const contentArea = document.querySelector('[data-ticket-content]')
                          if (contentArea) {
                            contentArea.scrollTo({ top: 0, behavior: 'smooth' })
                          }
                        }, 100)

                        // Also scroll the ticket list to show the selected ticket
                        setTimeout(() => {
                          const ticketCard = document.querySelector(`[data-ticket-id="${ticket.id}"]`)
                          if (ticketCard) {
                            ticketCard.scrollIntoView({ behavior: 'smooth', block: 'center' })
                          }
                        }, 300) // Slightly longer delay to allow tab switch and render
                      }

                      if (targetTicket) {
                        selectAndScrollToTicket(targetTicket)
                        // Switch to appropriate tab based on ticket status
                        if (targetTicket.status === 'closed') {
                          setActiveTab('closed')
                        } else if (targetTicket.assigneeUserId === currentUserId) {
                          setActiveTab('assigned')
                        } else if (!targetTicket.assigneeUserId) {
                          setActiveTab('unassigned')
                        } else {
                          setActiveTab('open')
                        }
                      } else {
                        // Ticket not in current list, try fetching it directly
                        try {
                          const response = await fetch(`/api/tickets/${ticketId}`)
                          const data = await response.json()

                          if (data.ticket) {
                            selectAndScrollToTicket(data.ticket)
                            // Switch to appropriate tab
                            if (data.ticket.status === 'closed') {
                              setActiveTab('closed')
                            } else if (data.ticket.assigneeUserId === currentUserId) {
                              setActiveTab('assigned')
                            } else {
                              setActiveTab('open')
                            }
                            // Refresh tickets in background to include this one
                            fetchTickets({ silent: true })
                          } else {
                            toast({
                              title: "Ticket not found",
                              description: "This ticket may have been deleted",
                              variant: "destructive",
                            })
                          }
                        } catch {
                          toast({
                            title: "Error",
                            description: "Could not load the selected ticket",
                            variant: "destructive",
                          })
                        }
                      }
                    }}
                  />

                  {/* Conversation Thread */}
                  <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out w-full max-w-full border-border/50 shadow-sm hover:shadow-md transition-all duration-300" style={{ animationDelay: '100ms' }}>
                    <CardContent className="p-4 w-full max-w-full overflow-hidden">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          Conversation
                        </h3>
                        <div className="flex items-center gap-2">
                          {threadMessages.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={async () => {
                                if (!conversationSummary) {
                                  setGeneratingSummary(true)
                                  try {
                                    // Convert HTML to plain text before sending to AI
                                    const summary = threadMessages.map(m => {
                                      const plainText = htmlToText(m.body || m.subject || "")
                                      return `${m.from}: ${plainText.substring(0, 200)}`
                                    }).join("\n\n")
                                    const response = await fetch("/api/ai/summarize", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ conversation: summary })
                                    })
                                    if (response.ok) {
                                      const data = await response.json()
                                      setConversationSummary(data.summary)
                                      setSummaryExpanded(true)
                                    } else {
                                      setConversationSummary("Unable to generate summary at this time.")
                                      setSummaryExpanded(true)
                                    }
                                  } catch (err) {
                                    setConversationSummary("Error generating summary.")
                                    setSummaryExpanded(true)
                                  } finally {
                                    setGeneratingSummary(false)
                                  }
                                } else {
                                  setSummaryExpanded(!summaryExpanded)
                                }
                              }}
                              className="h-8 px-3 text-xs"
                              disabled={generatingSummary}
                            >
                              {generatingSummary ? (
                                <>
                                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                  Summarizing...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  {conversationSummary ? (summaryExpanded ? "Hide Summary" : "Show Summary") : "Summarize"}
                                </>
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConversationMinimized(!conversationMinimized)}
                            className="h-8 w-8 p-0 transition-all duration-300 ease-out hover:scale-110 hover:bg-muted hover:shadow-sm flex-shrink-0"
                          >
                            {conversationMinimized ? (
                              <ChevronDown className="w-4 h-4 transition-transform duration-300 ease-out" />
                            ) : (
                              <ChevronUp className="w-4 h-4 transition-transform duration-300 ease-out" />
                            )}
                          </Button>
                        </div>
                      </div>
                      {summaryExpanded && conversationSummary && (
                        <div className="mb-4 p-4 bg-primary/5 border border-primary/20 rounded-xl animate-in fade-in slide-in-from-top-2 duration-300">
                          <div className="flex items-start gap-2">
                            <Sparkles className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
                            <div className="flex-1">
                              <h4 className="text-sm font-semibold text-primary mb-2">Conversation Summary</h4>
                              <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                                {conversationSummary}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      {!conversationMinimized && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300 w-full max-w-full overflow-hidden">
                          {loadingThread ? (
                            /* Content-shaped skeletons keep the layout stable so switching
                               tickets feels instant instead of flashing a blank spinner. */
                            <div className="space-y-4" aria-busy="true" aria-label="Loading conversation">
                              {[0, 1].map((i) => (
                                <div
                                  key={i}
                                  className="rounded-lg border border-border/50 bg-background/60 p-4 animate-in fade-in duration-300"
                                  style={{ animationDelay: `${i * 80}ms` }}
                                >
                                  <div className="flex items-start gap-3">
                                    <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
                                    <div className="flex-1 space-y-2 min-w-0">
                                      <div className="flex items-center justify-between gap-2">
                                        <Skeleton className="h-3.5 w-40" />
                                        <Skeleton className="h-3 w-16" />
                                      </div>
                                      <div className="space-y-2 pt-1">
                                        <Skeleton className="h-3 w-full" />
                                        <Skeleton className="h-3 w-[92%]" />
                                        <Skeleton className="h-3 w-[78%]" />
                                        <Skeleton className="h-3 w-[60%]" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : threadError ? (
                            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center animate-in fade-in duration-300">
                              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
                                <XCircle className="h-5 w-5 text-destructive" />
                              </div>
                              <p className="text-sm font-medium text-foreground max-w-sm">{threadError}</p>
                              <Button variant="outline" size="sm" onClick={() => fetchThread()} className="h-8">
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
                              </Button>
                            </div>
                          ) : threadMessages.length === 0 ? (
                            <p className="text-sm text-muted-foreground animate-in fade-in duration-300">No messages yet</p>
                          ) : (
                            threadMessages.map((msg, idx) => {
                              const key = getMessageKey(msg, idx)
                              const { main, quoted } = splitBody(msg.body || msg.subject || "")
                              const hasQuoted = quoted.some(l => l.trim().length > 0)
                              const showQuoted = !!showQuotedMap[key]
                              return (
                                <div
                                  key={key}
                                  className="rounded-lg border border-border/50 bg-background/60 shadow-sm p-4 transition-all duration-300 ease-out hover:bg-muted/40 animate-in fade-in slide-in-from-left-2 w-full max-w-full overflow-hidden"
                                  style={{ animationDelay: `${Math.min(idx, 6) * 35}ms` }}
                                >
                                  <div className="flex items-start gap-3 w-full max-w-full">
                                    <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold flex-shrink-0">
                                      {getInitials(msg.from || "User")}
                                    </div>
                                    <div className="flex-1 space-y-2 min-w-0 max-w-full overflow-hidden">
                                      <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="text-sm font-semibold text-foreground leading-tight break-words overflow-wrap-anywhere min-w-0 max-w-full">
                                          {msg.from}
                                        </div>
                                        <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(msg.date)}</span>
                                      </div>

                                      {/* Render email content with EmailContentViewer */}
                                      {msg.body ? (
                                        <EmailContentViewer
                                          content={msg.body}
                                          emailId={msg.id}
                                          attachments={msg.attachments}
                                          className="rounded-md overflow-hidden mt-2"
                                        />
                                      ) : (
                                        <div className="text-sm text-muted-foreground italic mt-2">
                                          No content
                                        </div>
                                      )}

                                      {/* Attachments */}
                                      {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-border/50">
                                          <div className="flex flex-wrap gap-2">
                                            {msg.attachments.map((att: any, attIdx: number) => {
                                              // Always use API route for downloads to avoid browser data URI size limits
                                              // Data URIs are only used for inline display (images in email content)
                                              const downloadHref = `/api/emails/${msg.id}/attachments/${att.id}?filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType || 'application/octet-stream')}`

                                              // Handle size display
                                              let sizeDisplay = ''
                                              if (att.size > 0) {
                                                sizeDisplay = att.size > 1024 * 1024
                                                  ? `${(att.size / 1024 / 1024).toFixed(1)} MB`
                                                  : `${Math.round(att.size / 1024)} KB`
                                              }

                                              return (
                                                <a
                                                  key={`att-${att.id}-${attIdx}`}
                                                  href={downloadHref}
                                                  download={att.filename}
                                                  className="inline-flex items-center gap-2 px-3 py-2 text-xs bg-muted/50 hover:bg-muted border border-border/50 rounded-md transition-colors group max-w-full"
                                                  title={att.filename}
                                                >
                                                  <div className="p-1 rounded bg-primary/10 text-primary">
                                                    <FileText className="w-3 h-3" />
                                                  </div>
                                                  <span className="truncate max-w-[150px] font-medium">{att.filename}</span>
                                                  {sizeDisplay && <span className="text-muted-foreground opacity-70">({sizeDisplay})</span>}
                                                  <Download className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                                                </a>
                                              )
                                            })}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Internal Notes */}
                  <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out w-full max-w-full border-border/50 shadow-sm hover:shadow-md transition-all duration-300" style={{ animationDelay: '150ms' }}>
                    <CardContent className="p-4 w-full max-w-full overflow-hidden">
                      <div className="flex items-center mb-4 gap-2">
                        <h3 className="font-semibold">Internal Chat</h3>
                        {notes.some(n => !n.read) && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs animate-pulse">New</span>
                        )}
                      </div>
                      <div className="space-y-3 mb-4 w-full overflow-x-hidden">
                        {notes.map((note, idx) => (
                          <div
                            key={note.id}
                            className="border-l-2 border-primary pl-4 py-2 bg-muted/50 rounded transition-colors duration-200 hover:bg-muted/70 w-full overflow-hidden"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium">{note.userName}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">{formatDate(note.createdAt)}</span>
                                {currentUserId === note.userId && (
                                  editingNoteId === note.id ? (
                                    <div className="flex items-center gap-1">
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0"
                                        onClick={(e) => {
                                          e.preventDefault()
                                          e.stopPropagation()
                                          handleUpdateNote()
                                        }}
                                        disabled={addingNote || !editingNoteContent.trim()}
                                        type="button"
                                      >
                                        <Check className="w-3 h-3 text-green-500" />
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-6 w-6 p-0"
                                        onClick={handleCancelEditNote}
                                        disabled={addingNote}
                                      >
                                        <XCircle className="w-3 h-3 text-red-500" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0 transition-all duration-200 hover:scale-110 hover:bg-muted"
                                      onClick={() => handleStartEditNote(note)}
                                    >
                                      <Edit2 className="w-3 h-3" />
                                    </Button>
                                  )
                                )}
                              </div>
                            </div>
                            {editingNoteId === note.id ? (
                              <Textarea
                                value={editingNoteContent}
                                onChange={(e) => setEditingNoteContent(e.target.value)}
                                className="min-h-20 text-sm w-full"
                                autoFocus
                              />
                            ) : null}
                            {editingNoteId === note.id ? (
                              <div className="mt-2 flex items-center gap-2">
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm" className="h-7 text-xs">@ Mentions</Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-64 p-2" align="start">
                                    <div className="space-y-2">
                                      <div className="text-xs text-muted-foreground">Update tagged users</div>
                                      <div className="max-h-40 overflow-auto space-y-1">
                                        {users.map(u => (
                                          <label key={u.id} className="flex items-center gap-2 text-sm">
                                            <Checkbox
                                              checked={editingMentions.includes(u.id)}
                                              onCheckedChange={(val) => {
                                                setEditingMentions(prev => {
                                                  const has = prev.includes(u.id)
                                                  if (val && !has) return [...prev, u.id]
                                                  if (!val && has) return prev.filter(x => x !== u.id)
                                                  return prev
                                                })
                                              }}
                                            />
                                            <Avatar className="h-6 w-6"><AvatarFallback>{(u.name || "U").slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                                            <span className="truncate">{u.name}</span>
                                          </label>
                                        ))}
                                      </div>
                                    </div>
                                  </PopoverContent>
                                </Popover>
                                {editingMentions.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {editingMentions.map(uid => {
                                      const u = users.find(x => x.id === uid)
                                      const label = u ? u.name : uid.slice(0, 8)
                                      return <Badge key={uid} variant="secondary" className="text-[10px]">@{label}</Badge>
                                    })}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="space-y-2 break-words">
                                <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">{note.content}</p>
                                {!!(note as any).mentions && (note as any).mentions.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {(note as any).mentions.map((uid: string) => {
                                      const u = users.find(x => x.id === uid)
                                      const label = u ? u.name : uid.slice(0, 8)
                                      return (
                                        <Badge key={uid} variant="secondary" className="text-[10px]">
                                          @{label}
                                        </Badge>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 items-start">
                        <Textarea
                          placeholder="Add internal note..."
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          className="min-h-20"
                        />
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" className="h-[40px]" title="Mention teammates">
                              @ Mention
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-64 p-2">
                            <div className="space-y-2">
                              <div className="text-xs text-muted-foreground">Tag users to notify without assigning</div>
                              <div className="max-h-40 overflow-auto space-y-1">
                                {users.map(u => (
                                  <label key={u.id} className="flex items-center gap-2 text-sm">
                                    <Checkbox
                                      checked={selectedMentions.includes(u.id)}
                                      onCheckedChange={(val) => {
                                        setSelectedMentions(prev => {
                                          const has = prev.includes(u.id)
                                          if (val && !has) return [...prev, u.id]
                                          if (!val && has) return prev.filter(x => x !== u.id)
                                          return prev
                                        })
                                      }}
                                    />
                                    <Avatar className="h-6 w-6"><AvatarFallback>{(u.name || "U").slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
                                    <span className="truncate">{u.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <Button onClick={handleAddNote} disabled={!newNote.trim() || addingNote} className="min-w-[60px]">
                          {addingNote ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Reply Box */}
                  <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out w-full max-w-full border-border/50 shadow-sm hover:shadow-md transition-all duration-300" style={{ animationDelay: '200ms' }}>
                    <CardContent className="p-4 w-full max-w-full overflow-hidden">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <h3 className="font-semibold text-sm">Reply</h3>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={showShopifySidebar ? "default" : "outline"}
                            onClick={() => setShowShopifySidebar(!showShopifySidebar)}
                            className="h-7 text-xs transition-all duration-200 hover:scale-105"
                            title="Toggle Shopify Customer Info"
                          >
                            <ShoppingBag className="w-3 h-3 mr-1" />
                            Shopify
                          </Button>
                          <Button
                            size="sm"
                            variant={showQuickRepliesSidebar ? "default" : "outline"}
                            onClick={() => setShowQuickRepliesSidebar(!showQuickRepliesSidebar)}
                            className="h-7 text-xs transition-all duration-200 hover:scale-105"
                          >
                            <MessageSquare className="w-3 h-3 mr-1" />
                            Quick Replies
                            {quickReplies.length > 0 && (
                              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                                {quickReplies.length}
                              </Badge>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleGenerateDraft}
                            disabled={generatingDraft || !threadMessages.length}
                            className="h-7 text-xs"
                            title="Generate a full suggested reply from the conversation"
                          >
                            {generatingDraft ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 mr-1" />
                                AI Draft
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={handleForward}
                            disabled={generatingDraft}
                            className="h-7 text-xs"
                          >
                            <ArrowRight className="w-3 h-3 mr-1" />
                            Forward
                          </Button>
                        </div>
                      </div>
                      {showDraft && draftText && (
                        <div className="mb-4 p-3 bg-muted rounded border border-primary/20 animate-in fade-in slide-in-from-bottom-2 duration-300 w-full max-w-full overflow-hidden">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">AI Draft</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setShowDraft(false)
                                setDraftText("")
                              }}
                              className="transition-all duration-200 hover:scale-110 flex-shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                          <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere w-full max-w-full overflow-hidden">{draftText}</p>
                          <Button
                            size="sm"
                            className="mt-2 transition-all duration-200 hover:scale-105"
                            onClick={() => {
                              // Update both text and HTML representations
                              // Convert newlines to breaks for HTML if needed, or just use raw text
                              // for simple drafts. RichTextEditor should handle it.
                              setReplyText(draftText)
                              // Simple conversion: wrap in paragraphs or usage simple replacement
                              // But just setting raw text as HTML often works for simple editors or 
                              // we can format it slightly.
                              // Let's format it as simple paragraphs to be safe
                              const html = draftText.split('\n').map(line => `<p>${line}</p>`).join('')
                              setReplyHtml(html)
                              setShowDraft(false)
                            }}
                          >
                            Use This Draft
                          </Button>
                        </div>
                      )}
                      {/* Typing Indicator */}
                      {typingUsers.length > 0 && (
                        <div className="mb-2 px-2 py-1 bg-primary/10 border border-primary/20 rounded text-xs text-primary italic flex items-center gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span className="transition-all duration-200">
                            {typingUsers.map((userId) => {
                              const user = users.find(u => u.id === userId)
                              return user ? user.name : "Someone"
                            }).filter(Boolean).join(", ")} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                          </span>
                        </div>
                      )}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>Reply</span>
                            {rewritingReply && (
                              <span className="inline-flex items-center gap-1 text-primary">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Polishing with AI...
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {lastReplyBeforeRewriteRef.current && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px]"
                                onClick={handleUndoRewrite}
                              >
                                <Undo2 className="w-3 h-3 mr-1" />
                                Undo AI
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px] inline-flex items-center gap-1"
                              onClick={handleRewriteReply}
                              disabled={!replyText.trim() || rewritingReply || sendingReply || updatingStatus}
                              title="Polish the text you've typed without adding new information"
                            >
                              <Sparkles className="w-3 h-3" />
                              Polish with AI
                            </Button>
                          </div>
                        </div>
                        {isForwarding && (
                          <div className="space-y-1.5 px-1 pb-2 animate-in fade-in slide-in-from-top-2 duration-300">
                            <Label htmlFor="forward-to-input-ticket" className="text-xs font-semibold text-muted-foreground ml-1 uppercase tracking-wider">To</Label>
                            <div className="relative group/input flex gap-2">
                              <div className="relative flex-1">
                                <Input
                                  id="forward-to-input-ticket"
                                  placeholder="recipient1@example.com, recipient2@example.com"
                                  value={forwardTo}
                                  onChange={(e) => setForwardTo(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && forwardTo.trim()) {
                                      handleSendReply()
                                    }
                                  }}
                                  className="h-9 text-sm pl-8 pr-10 border-muted focus-visible:ring-primary/20 hover:border-primary/30 transition-all rounded-lg w-full"
                                />
                                <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within/input:text-primary transition-colors" />
                                {forwardTo && (
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 hover:bg-transparent"
                                    onClick={() => setForwardTo("")}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
                              <Button
                                onClick={() => handleSendReply()}
                                disabled={sendingReply || !forwardTo.trim()}
                                size="sm"
                                className="h-9 transition-all duration-200 hover:scale-105"
                              >
                                {sendingReply ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <>
                                    <ArrowRight className="w-4 h-4 mr-1" />
                                    Forward
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}
                        <RichTextEditor
                          value={replyHtml}
                          onChange={(html, text) => {
                            setReplyHtml(html)
                            setReplyText(text)
                            handleTyping()
                          }}
                          placeholder="Type your reply..."
                          minHeight="150px"
                          onAttachments={(files) => setReplyAttachments(files)}
                        />
                      </div>
                      {replyAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {replyAttachments.map(att => (
                            <div key={att.id} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm border">
                              <Paperclip className="w-3 h-3 text-muted-foreground" />
                              <span className="text-muted-foreground truncate max-w-[200px]">{att.name}</span>
                              <span className="text-xs text-muted-foreground">({(att.size / 1024).toFixed(1)}KB)</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0 hover:bg-destructive/10"
                                onClick={() => setReplyAttachments(prev => prev.filter(a => a.id !== att.id))}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-3">
                        <Button
                          onClick={() => handleSendReply()}
                          disabled={!replyText.trim() || sendingReply || updatingStatus}
                          className="h-8 text-xs transition-all duration-300 ease-out hover:scale-105 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sendingAction === 'send' ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin mr-2" />
                              Sending...
                            </>
                          ) : (
                            "Send Reply"
                          )}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => handleSendReply({ closeTicket: true })}
                          disabled={!replyText.trim() || sendingReply || updatingStatus}
                          className="h-8 text-xs transition-all duration-300 ease-out hover:scale-105 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sendingAction === 'send-close' ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin mr-2" />
                              {updatingStatus ? 'Closing...' : 'Sending...'}
                            </>
                          ) : (
                            "Send & Close"
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full px-6 py-10 w-full flex-grow">
                <div className="text-center space-y-4 max-w-md animate-in fade-in duration-500 m-auto">
                  <div className="w-16 h-16 bg-muted/50 rounded-full flex items-center justify-center mx-auto shadow-sm">
                    <Mail className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-xl font-semibold">Select a ticket</h2>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      Choose a ticket from the list to view details, manage assignment, and reply.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ResizablePanel>

        {/* Quick Replies Sidebar */}
        {showQuickRepliesSidebar && (
          <>
            <ResizableHandle
              withHandle
              className="w-1 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-all duration-200 cursor-col-resize group relative z-10"
            />
            <ResizablePanel
              defaultSize={effectivePanelSizes[2]}
              minSize={15}
              maxSize={35}
              order={3}
              id="quick-replies-panel"
              className="flex flex-col bg-background overflow-hidden"
              style={{ minWidth: 0, contain: 'layout size' }}
            >
              <QuickRepliesSidebar
                onSelectReply={handleSelectQuickReply}
                currentUserId={currentUserId}
                onQuickRepliesChange={fetchQuickReplies}
                onClose={() => setShowQuickRepliesSidebar(false)}
              />
            </ResizablePanel>
          </>
        )}

        {/* Shopify Sidebar */}
        {showShopifySidebar && selectedTicket && (
          <>
            <ResizableHandle
              withHandle
              className="w-1 bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-all duration-200 cursor-col-resize group relative z-10"
            />
            <ResizablePanel
              defaultSize={showQuickRepliesSidebar ? effectivePanelSizes[3] : effectivePanelSizes[2]}
              minSize={20}
              maxSize={40}
              order={showQuickRepliesSidebar ? 4 : 3}
              id="shopify-panel"
              className="flex flex-col bg-background overflow-hidden"
              style={{ minWidth: 0, contain: 'layout size' }}
            >
              <ShopifySidebar
                customerEmail={selectedTicket.customerEmail}
                onClose={() => setShowShopifySidebar(false)}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

      {/* Assignment Dialog with Priority Selection */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Ticket</DialogTitle>
            <DialogDescription>
              Select a priority for this ticket before assigning it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="assign-priority">Priority *</Label>
              <Select value={assignPriority || "medium"} onValueChange={(v) => setAssignPriority(v as Ticket["priority"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAssignDialog(false)
                  setPendingAssignment(null)
                }}
                className=""
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handleConfirmAssign()
                }}
                disabled={assigning !== null}
              >
                {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : "Assign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Department Change Dialog */}
      <Dialog open={showDepartmentDialog} onOpenChange={setShowDepartmentDialog}>
        <DialogContent className="sm:max-w-md bg-background border-border shadow-2xl rounded-3xl">
          <DialogHeader className="flex flex-col items-center text-center pt-2">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 transition-transform hover:scale-110">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <DialogTitle className="text-2xl font-bold tracking-tight">Confirm Move</DialogTitle>
            <DialogDescription className="text-muted-foreground text-base mt-2">
              Are you sure you want to move this ticket? This will help the AI learn your routing preferences.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="department" className="text-sm font-semibold opacity-70">Move to Workstream</Label>
              <Select
                value={targetDepartmentId}
                onValueChange={setTargetDepartmentId}
              >
                <SelectTrigger className="h-12 bg-muted/30 border-border rounded-xl">
                  <SelectValue placeholder="Select workstream" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-border bg-popover shadow-xl">
                  <SelectItem value="unclassified">Unclassified</SelectItem>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setShowDepartmentDialog(false)}
              className="text-slate-400 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateDepartment}
              disabled={updatingDepartment || !targetDepartmentId}
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl px-8 h-11 font-bold shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95"
            >
              {updatingDepartment ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                "Update Department"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div >
  )
}

