"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import Logo from "@/components/logo"
import { useTheme } from "next-themes"
import { Moon, Sun, Users, User, Bell, Inbox, Megaphone } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/components/ui/use-toast"

interface UserProfile {
  name?: string
  email?: string
  picture?: string
}

interface User {
  id: string
  name: string
  email?: string | null
  role: "admin" | "manager" | "agent"
  isActive: boolean
}

type NotificationItem = {
  id: string
  type: 'mention' | 'assignment'
  message: string
  ticketId?: string | null
  createdAt: string
  isRead: boolean
}

interface TopNavProps {
  isConnected: boolean
  userProfile?: UserProfile | null
  currentUser?: { id: string; name: string; role: string; businessId?: string | null; businessName?: string | null } | null
  onLogout?: () => void
  onSwitchUser?: (userId: string) => void
  onSearch?: (query: string) => void
  searchValue?: string // Current search value to sync with input
}

export default function TopNav({ isConnected, userProfile, currentUser, onLogout, onSwitchUser, onSearch, searchValue = "" }: TopNavProps) {
  const { resolvedTheme, setTheme } = useTheme()
  const router = useRouter()
  const isDark = resolvedTheme === "dark"
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [lastOpenedAt, setLastOpenedAt] = useState<number | null>(null)
  const [showNewOnly, setShowNewOnly] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [showUserDialog, setShowUserDialog] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const prevUnreadIdsRef = useRef<Set<string>>(new Set())
  const { toast } = useToast()

  // Local state for search input to prevent clearing while typing
  const [localSearchValue, setLocalSearchValue] = useState(searchValue)
  const isTypingRef = useRef(false)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const prevSearchValueRef = useRef(searchValue)

  // Sync with prop when it changes externally (using ref to avoid dependency issues)
  if (searchValue !== prevSearchValueRef.current && !isTypingRef.current) {
    prevSearchValueRef.current = searchValue
    setLocalSearchValue(searchValue)
  }

  const fetchNotifications = async (opts?: { showToast?: boolean }) => {
    setNotificationsLoading(true)
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      const items: NotificationItem[] = (data.notifications || []).map((n: any) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        ticketId: n.ticketId ?? n.ticket_id ?? null,
        createdAt: n.createdAt ?? n.created_at,
        isRead: !!(n.isRead ?? n.is_read),
      }))
      setNotifications(items)
      const unread = items.filter(i => !i.isRead)
      setUnreadCount(unread.length)

      if (opts?.showToast) {
        const prev = prevUnreadIdsRef.current
        const newOnes = unread.filter(n => !prev.has(n.id))
        if (newOnes.length > 0) {
          const first = newOnes[0]
          toast({
            title: first.type === 'mention' ? 'You were mentioned' : 'New assignment',
            description: first.message,
          })
        }
        prevUnreadIdsRef.current = new Set(unread.map(n => n.id))
      } else {
        prevUnreadIdsRef.current = new Set(unread.map(n => n.id))
      }
    } catch {
      // Ignore errors
    } finally {
      setNotificationsLoading(false)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(() => fetchNotifications({ showToast: true }), 10000)
    return () => clearInterval(interval)
  }, [])

  const markRead = async (id: string) => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationId: id })
      })
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
        setUnreadCount(c => Math.max(0, c - 1))
      }
    } catch {
      // Ignore errors
    }
  }

  const toggleTheme = () => setTheme(isDark ? "light" : "dark")

  const fetchUsers = async () => {
    if (!onSwitchUser) return
    try {
      setLoadingUsers(true)
      const response = await fetch("/api/users")
      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || [])
      }
    } catch {
      // Ignore errors
    } finally {
      setLoadingUsers(false)
    }
  }

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.isRead)
    if (!unread.length) return
    // Optimistic UI
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    setUnreadCount(0)
    await Promise.allSettled(unread.map(u => markRead(u.id)))
    await fetchNotifications()
  }

  const formatTimeAgo = (iso?: string) => {
    if (!iso) return ''
    const now = Date.now()
    const then = new Date(iso).getTime()
    const diff = Math.max(0, now - then)
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const handleSwitchUser = async (userId: string) => {
    if (!onSwitchUser) return
    try {
      const response = await fetch("/api/auth/select-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })

      if (response.ok) {
        const data = await response.json()
        // Store in sessionStorage for this tab
        if (typeof window !== "undefined") {
          sessionStorage.setItem("current_user_id", userId)
          sessionStorage.setItem("current_user_name", data.user.name)
          sessionStorage.setItem("current_user_role", data.user.role)
        }
        onSwitchUser(userId)
        setShowUserDialog(false)
        setProfileMenuOpen(false)
        // State will update smoothly without page reload
      }
    } catch {
      // Ignore errors
    }
  }
  const initials = userProfile?.name
    ? userProfile.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase()
    : "ME"

  return (
    <>
      <header className="bg-background/95 backdrop-blur-sm border-b border-border h-16 flex items-center justify-between px-4 md:px-6 gap-2 md:gap-4">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <div className="text-base font-bold text-foreground truncate block sm:hidden">MailAssist</div>
        </div>

        {/* Global Search - Now visible on all screen sizes */}
        {isConnected && (
          <form
            className="flex items-center gap-2 flex-1 max-w-3xl relative"
            onSubmit={(e) => {
              e.preventDefault()
              const form = e.currentTarget
              const input = form.querySelector<HTMLInputElement>('input[name="global-search"]')
              if (input && onSearch) {
                onSearch(input.value.trim())
              }
            }}
          >
            <input
              name="global-search"
              type="text"
              placeholder="Search..."
              value={localSearchValue}
              className="w-full h-10 px-4 pr-10 rounded-xl border-2 border-border bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all hover:border-primary/50 md:placeholder:text-[length:inherit]"
              style={{ fontSize: '14px' }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setLocalSearchValue('')
                  if (onSearch) onSearch('')
                }
              }}
              onChange={(e) => {
                // Real-time filtering: update search as user types (don't trim while typing)
                const value = e.target.value
                isTypingRef.current = true // Mark that user is typing
                setLocalSearchValue(value) // Update local state immediately
                if (onSearch) {
                  onSearch(value) // Update parent state
                }
                // Clear any previous timeout
                if (typingTimeoutRef.current) {
                  clearTimeout(typingTimeoutRef.current)
                }
                // Reset typing flag after user stops typing (1000ms delay for slow typing)
                typingTimeoutRef.current = setTimeout(() => {
                  isTypingRef.current = false
                }, 1000)
              }}
            />
            {/* Clear button - only show when there's a search value */}
            {localSearchValue && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  setLocalSearchValue('') // Clear local state immediately
                  if (onSearch) {
                    onSearch('') // Clear parent state
                  }
                  // Focus the input after clearing
                  const form = e.currentTarget.closest('form')
                  const input = form?.querySelector<HTMLInputElement>('input[name="global-search"]')
                  if (input) {
                    input.focus()
                  }
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </form>
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          {isConnected && (
            <Popover
              open={notificationsOpen}
              onOpenChange={(open) => {
                setNotificationsOpen(open)
                if (open) {
                  setLastOpenedAt(Date.now())
                  setShowNewOnly(false)
                  // Reset baseline for "new" detection to avoid replaying chime on open
                  const unread = notifications.filter(n => !n.isRead)
                  prevUnreadIdsRef.current = new Set(unread.map(n => n.id))
                }
              }}
            >
              <PopoverTrigger asChild>
                <button className="h-9 w-9 flex items-center justify-center rounded-lg border border-input hover:bg-muted/60 transition-colors relative">
                  <Bell className="w-4 h-4" />
                  {unreadCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]" variant="destructive">{unreadCount}</Badge>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0 rounded-lg shadow-lg overflow-hidden" align="end">
                <div className="flex items-center justify-between p-2 border-b text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Notifications</span>
                  <div className="flex items-center gap-2">
                    <button
                      className={`text-[11px] ${showNewOnly ? 'text-primary font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                      onClick={() => setShowNewOnly((v) => !v)}
                    >
                      New since open
                    </button>
                    <button
                      className="text-[11px] text-primary hover:underline"
                      onClick={() => fetchNotifications()}
                      disabled={notificationsLoading}
                    >
                      Refresh
                    </button>
                    <button
                      className="text-[11px] text-primary hover:underline disabled:text-muted-foreground"
                      onClick={markAllRead}
                      disabled={notificationsLoading || unreadCount === 0}
                    >
                      Mark all read
                    </button>
                  </div>
                </div>
                <ScrollArea className="h-56">
                  <div className="p-2 space-y-1">
                    {notificationsLoading ? (
                      <div className="space-y-2">
                        {[1, 2, 3].map(i => (
                          <div key={i} className="flex items-center gap-3 p-2 rounded border border-border/60 animate-pulse">
                            <div className="h-8 w-8 rounded-full bg-muted" />
                            <div className="flex-1 space-y-1">
                              <div className="h-3 w-24 bg-muted rounded" />
                              <div className="h-3 w-40 bg-muted rounded" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (() => {
                      const filtered = showNewOnly && lastOpenedAt
                        ? notifications.filter(n => new Date(n.createdAt).getTime() > lastOpenedAt)
                        : notifications

                      if (filtered.length === 0) {
                        return (
                          <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                            <Inbox className="w-5 h-5" />
                            <div>{showNewOnly ? 'No new notifications since open' : 'No notifications yet'}</div>
                            <div className="text-[11px]">Mentions and assignments will appear here.</div>
                          </div>
                        )
                      }

                      return filtered.map(n => (
                        <button
                          key={n.id}
                          className="w-full text-left flex items-start justify-between gap-2 p-2 rounded hover:bg-muted border border-transparent hover:border-border/60 transition-colors"
                          onClick={() => {
                            console.log('🔔 Notification clicked:', { ticketId: n.ticketId, type: n.type, message: n.message })
                            if (n.ticketId) {
                              console.log('🚀 Navigating to ticket:', n.ticketId)
                              router.push(`/?ticketId=${n.ticketId}`)
                            } else {
                              console.warn('⚠️ Notification has no ticketId!')
                            }
                            if (!n.isRead) markRead(n.id)
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold ${n.type === 'mention' ? 'bg-primary/10 text-primary' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'}`}>
                              {n.type === 'mention' ? '@' : <Megaphone className="w-4 h-4" />}
                            </div>
                            <div className="text-sm space-y-0.5">
                              <div className="font-medium capitalize leading-tight">{n.type}</div>
                              <div className="text-muted-foreground text-xs leading-tight">{n.message}</div>
                              <div className="text-[11px] text-muted-foreground">{formatTimeAgo(n.createdAt)}</div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {!n.isRead && (
                              <span className="text-[11px] text-primary">New</span>
                            )}
                          </div>
                        </button>
                      ))
                    })()}
                  </div>
                </ScrollArea>
              </PopoverContent>
            </Popover>
          )}
          {isConnected && (
            <button
              onClick={toggleTheme}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-input hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Toggle theme"
              title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          )}

          {isConnected && (
            <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="hidden text-right sm:block min-w-0">
                    <div className="text-sm font-medium text-foreground truncate flex items-center gap-2">
                      {currentUser?.name || userProfile?.name || "Connected"}
                      {currentUser?.businessName && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-primary/10 text-primary border-primary/20 font-bold uppercase tracking-wider">
                          {currentUser.businessName}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {currentUser?.role && currentUser.role !== 'user'
                        ? `${currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}`
                        : userProfile?.email || "Loading..."}
                    </div>
                  </div>
                  <Avatar className="h-8 w-8 flex-shrink-0 border border-border">
                    {userProfile?.picture ? (
                      <img src={userProfile.picture} alt={userProfile.name || "User"} className="rounded-full" />
                    ) : (
                      <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                        {currentUser?.name
                          ? currentUser.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
                          : initials}
                      </AvatarFallback>
                    )}
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem className="block sm:hidden text-left py-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {currentUser?.name || userProfile?.name || "Connected"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {currentUser?.role
                        ? `${currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)}`
                        : userProfile?.email || "Loading..."}
                    </p>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="block sm:hidden" />
                {onSwitchUser && (
                  <>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault()
                        fetchUsers()
                        setShowUserDialog(true)
                      }}
                      className="cursor-pointer"
                    >
                      <Users className="w-4 h-4 mr-2" />
                      <span>Switch User</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onLogout} className="text-destructive cursor-pointer">
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* Switch User Dialog rendered at root to stay mounted when menu closes */}
      {isConnected && onSwitchUser && (
        <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                Switch User
              </DialogTitle>
              <DialogDescription className="text-xs mt-1">
                Select a team member to manage their account
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {loadingUsers ? (
                <div className="text-sm text-muted-foreground text-center py-8 flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <span>Loading users...</span>
                </div>
              ) : users.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">
                  No users found
                </div>
              ) : (
                <div className="space-y-2 max-h-[320px] overflow-y-auto pr-2">
                  {users.map((user, index) => (
                    <button
                      key={user.id}
                      onClick={() => handleSwitchUser(user.id)}
                      className={`w-full text-left group transition-all duration-200 rounded-lg animate-in fade-in slide-in-from-bottom-2`}
                      style={{ animationDelay: `${index * 50}ms` }}
                    >
                      <div className={`p-3 border-2 rounded-lg transition-all duration-200 ${user.id === currentUser?.id
                        ? "border-primary bg-gradient-to-r from-primary/10 to-primary/5 shadow-md ring-2 ring-primary/20"
                        : "border-border/50 hover:border-primary/40 hover:bg-muted/50 hover:shadow-sm"
                        }`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${user.id === currentUser?.id
                            ? "bg-primary text-white shadow-sm"
                            : "bg-primary/10 text-primary group-hover:bg-primary/20"
                            }`}>
                            <User className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-foreground">{user.name}</div>
                            {user.email && (
                              <div className="text-xs text-muted-foreground truncate mt-0.5">
                                {user.email}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <Badge
                              variant="outline"
                              className={`text-xs px-2 py-0.5 capitalize font-semibold ${user.id === currentUser?.id
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border/50 bg-transparent"
                                }`}
                            >
                              {user.role}
                            </Badge>
                            {user.id === currentUser?.id && (
                              <span className="text-[10px] text-primary font-medium">Active</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
