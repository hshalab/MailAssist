"use client"

import { useState } from "react"
import { Sparkles, ChevronLeft, ChevronRight } from 'lucide-react'

export type SidebarView =
  | "inbox"
  | "sent"
  | "spam"
  | "trash"
  | "drafts"
  | "compose"
  | "settings"
  | "users"
  | "tickets"
  | "ai-settings"
  | "quick-replies"
  | "analytics"
  | "team"
  | "departments"

interface SidebarProps {
  activeView: SidebarView
  setActiveView: (view: SidebarView) => void
  onLogout?: () => void
  currentUser?: { id: string; name: string; role: string } | null
}

const NAV_ITEMS = [
  { id: "tickets", label: "Tickets", icon: TicketIcon },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
  { id: "compose", label: "Compose", icon: ComposeIcon },
  { id: "quick-replies", label: "Quick Replies", icon: QuickRepliesIcon },
  { id: "sent", label: "Sent", icon: SentIcon },
  { id: "drafts", label: "Drafts", icon: DraftIcon },
  { id: "spam", label: "Spam", icon: SpamIcon },
  { id: "trash", label: "Trash", icon: TrashIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const

const ADMIN_NAV_ITEMS = [
  { id: "team", label: "Team Management", icon: UsersIcon },
  { id: "departments", label: "Workstreams", icon: DepartmentsIcon },
] as const

const AI_NAV_ITEMS = [
  { id: "ai-settings", label: "AI Customization", icon: SparklesIcon },
] as const

const ANALYTICS_NAV_ITEMS = [
  { id: "analytics", label: "Analytics", icon: AnalyticsIcon },
] as const

/**
 * Collapsible sidebar inspired by Gorgias and Linear.
 * - Collapsed by default: shows only icons
 * - Expanded: shows icons + labels
 * - Smooth 300ms transition animation
 * - Tooltips on hover when collapsed
 */
export default function Sidebar({ activeView, setActiveView, onLogout, currentUser }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  const isAdmin = currentUser?.role === "admin"
  const isManager = currentUser?.role === "manager"

  return (
    <aside
      className={`
        hidden md:flex flex-col h-screen bg-card border-r border-border
        transition-all duration-300 ease-out shadow-md
        ${isCollapsed ? "w-20" : "w-64"}
      `}
    >
      {/* Collapse/Expand Toggle at Top */}
      <div
        className={`
          flex-shrink-0 h-16 flex items-center border-b border-border
          transition-all duration-300 bg-card
          ${isCollapsed ? "justify-center px-2" : "px-5 justify-between"}
        `}
      >
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-foreground tracking-tight">MailAssist</span>
          </div>
        )}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={`
            h-10 w-10 flex items-center justify-center rounded-xl
            text-muted-foreground hover:bg-accent/10 hover:text-foreground
            transition-all duration-200 ease-out hover:shadow-md
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
          `}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <ChevronLeft className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className={`flex-1 ${isCollapsed ? "px-2 py-4" : "px-3 py-6"} space-y-1`}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id
          const Icon = item.icon

          return (
            <NavButton
              key={item.id}
              isActive={isActive}
              isCollapsed={isCollapsed}
              icon={<Icon className="w-5 h-5 flex-shrink-0" />}
              label={item.label}
              onClick={() => setActiveView(item.id)}
            />
          )
        })}

        {isAdmin && (
          <>
            <Divider isCollapsed={isCollapsed} />
            {ADMIN_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id
              const Icon = item.icon

              return (
                <NavButton
                  key={item.id}
                  isActive={isActive}
                  isCollapsed={isCollapsed}
                  icon={<Icon className="w-5 h-5 flex-shrink-0" />}
                  label={item.label}
                  onClick={() => setActiveView(item.id)}
                />
              )
            })}
          </>
        )}

        {(isAdmin || isManager) && (
          <>
            <Divider isCollapsed={isCollapsed} />
            {AI_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id
              const Icon = item.icon

              return (
                <NavButton
                  key={item.id}
                  isActive={isActive}
                  isCollapsed={isCollapsed}
                  icon={<Icon className="w-5 h-5 flex-shrink-0" />}
                  label={item.label}
                  onClick={() => setActiveView(item.id)}
                />
              )
            })}
            {ANALYTICS_NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id
              const Icon = item.icon

              return (
                <NavButton
                  key={item.id}
                  isActive={isActive}
                  isCollapsed={isCollapsed}
                  icon={<Icon className="w-5 h-5 flex-shrink-0" />}
                  label={item.label}
                  onClick={() => setActiveView(item.id)}
                />
              )
            })}
          </>
        )}
      </nav>

      {/* Logout button */}
      <div className={`flex-shrink-0 border-t border-border ${isCollapsed ? "p-2" : "p-3"}`}>
        <NavButton
          isActive={false}
          isCollapsed={isCollapsed}
          icon={<LogoutIcon className="w-5 h-5 flex-shrink-0" />}
          label="Logout"
          onClick={onLogout}
        />
      </div>
    </aside>
  )
}

interface NavButtonProps {
  isActive: boolean
  isCollapsed: boolean
  icon: React.ReactNode
  label: string
  onClick?: () => void
}

function NavButton({ isActive, isCollapsed, icon, label, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        group relative w-full flex items-center justify-center rounded-lg
        transition-all duration-200 ease-out
        ${isCollapsed ? "h-11 px-2" : "h-10 px-3 gap-3"}
        ${isActive
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-foreground hover:bg-secondary/80 hover:text-primary"
        }
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      `}
      title={isCollapsed ? label : undefined}
    >
      <div className="flex-shrink-0">
        {icon}
      </div>
      {!isCollapsed && (
        <span className="text-sm font-medium flex-1 text-left truncate">{label}</span>
      )}

      {/* Tooltip for collapsed state */}
      {isCollapsed && (
        <div
          className="
            absolute left-full ml-3 px-3 py-1.5
            bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900
            text-xs font-semibold rounded-lg whitespace-nowrap
            pointer-events-none opacity-0 invisible
            group-hover:opacity-100 group-hover:visible
            transition-all duration-200
            shadow-lg border border-gray-800 dark:border-gray-200
            z-50
          "
          style={{
            transform: 'translateX(0)',
          }}
        >
          {label}
          {/* Tooltip arrow */}
          <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900 dark:border-r-gray-100" />
        </div>
      )}
    </button>
  )
}

function Divider({ isCollapsed }: { isCollapsed: boolean }) {
  return (
    <div className={`my-2 ${isCollapsed ? "mx-1" : "mx-2"}`}>
      <div className="h-px bg-border/50" />
    </div>
  )
}

function InboxIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M3 7l1.68-3.36A2 2 0 0 1 6.48 2h11.04a2 2 0 0 1 1.8 1.64L21 7v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7z" />
      <path d="M3 13h5l2 3h4l2-3h5" />
    </svg>
  )
}

function SentIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M4 4l16 8-16 8 4-8-4-8z" />
    </svg>
  )
}

function SpamIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <polygon points="7 2 17 2 22 7 22 17 17 22 7 22 2 17 2 7 7 2" />
      <line x1="9" y1="9" x2="15" y2="15" />
      <line x1="15" y1="9" x2="9" y2="15" />
    </svg>
  )
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function DraftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function ComposeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function SettingsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09c0 .66.39 1.26 1 1.51h.09c.61.24 1.3.1 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09c.24.61.9 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function UsersIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function TicketIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 8h18" />
      <path d="M8 12h8" />
    </svg>
  )
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return <Sparkles className="w-5 h-5" {...props} />
}

function QuickRepliesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h8" />
      <path d="M8 14h6" />
    </svg>
  )
}

function AnalyticsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function DepartmentsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function LogoutIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" {...props}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  )
}
