"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
    ChevronDown,
    ChevronUp,
    Clock,
    CheckCircle2,
    AlertCircle,
    CircleDashed,
    Loader2,
    MessageSquare,
    ArrowRight,
    History,
    User,
    Calendar,
    Mail
} from "lucide-react"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"

interface PastTicket {
    id: string
    threadId: string
    subject: string
    status: "open" | "pending" | "on_hold" | "closed"
    priority?: "low" | "medium" | "high" | "urgent" | null
    createdAt: string
    updatedAt: string
    lastCustomerReplyAt?: string | null
    assigneeName?: string | null
    departmentName?: string | null
}

interface CustomerEmailTimelineProps {
    customerEmail: string
    currentTicketId?: string
    onNavigateToTicket?: (ticketId: string) => void
}

export default function CustomerEmailTimeline({
    customerEmail,
    currentTicketId,
    onNavigateToTicket,
}: CustomerEmailTimelineProps) {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [tickets, setTickets] = useState<PastTicket[]>([])
    const [expanded, setExpanded] = useState(false)
    const [navigatingTo, setNavigatingTo] = useState<string | null>(null)

    useEffect(() => {
        const fetchHistory = async () => {
            if (!customerEmail) return

            setLoading(true)
            setError(null)

            try {
                let url = `/api/tickets/customer-history?email=${encodeURIComponent(customerEmail)}`
                if (currentTicketId) {
                    url += `&excludeTicketId=${encodeURIComponent(currentTicketId)}`
                }

                const response = await fetch(url)
                if (!response.ok) {
                    throw new Error("Failed to fetch customer history")
                }

                const data = await response.json()
                setTickets(data.tickets || [])
            } catch (err) {
                console.error("Error fetching customer history:", err)
                setError(err instanceof Error ? err.message : "Failed to load history")
            } finally {
                setLoading(false)
            }
        }

        fetchHistory()
    }, [customerEmail, currentTicketId])

    const handleNavigate = (ticketId: string) => {
        setNavigatingTo(ticketId)
        // Small delay for visual feedback before navigating
        setTimeout(() => {
            onNavigateToTicket?.(ticketId)
            // Reset after a short delay (in case navigation fails)
            setTimeout(() => setNavigatingTo(null), 500)
        }, 150)
    }

    const getStatusIcon = (status: string) => {
        switch (status) {
            case "open":
                return <AlertCircle className="w-3.5 h-3.5 text-blue-500" />
            case "pending":
                return <Clock className="w-3.5 h-3.5 text-yellow-500" />
            case "on_hold":
                return <CircleDashed className="w-3.5 h-3.5 text-orange-500" />
            case "closed":
                return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            default:
                return <CircleDashed className="w-3.5 h-3.5 text-muted-foreground" />
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case "open":
                return "bg-blue-500/10 text-blue-600 border-blue-200"
            case "pending":
                return "bg-yellow-500/10 text-yellow-600 border-yellow-200"
            case "on_hold":
                return "bg-orange-500/10 text-orange-600 border-orange-200"
            case "closed":
                return "bg-green-500/10 text-green-600 border-green-200"
            default:
                return "bg-muted text-muted-foreground"
        }
    }

    const formatDate = (dateString: string | null | undefined) => {
        if (!dateString) return "N/A"
        const date = new Date(dateString)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / (1000 * 60))
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffDays === 1) return "Yesterday"
        if (diffDays < 7) return `${diffDays} days ago`
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: diffDays > 365 ? "numeric" : undefined })
    }

    const formatFullDate = (dateString: string | null | undefined) => {
        if (!dateString) return "N/A"
        return new Date(dateString).toLocaleDateString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
    }

    const formatTime = (dateString: string | null | undefined) => {
        if (!dateString) return ""
        return new Date(dateString).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
        })
    }

    // Loading skeleton
    if (loading) {
        return (
            <Card className="border-border/50 bg-muted/30">
                <CardContent className="p-3">
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4" />
                        <Skeleton className="h-4 w-32" />
                    </div>
                </CardContent>
            </Card>
        )
    }

    // Error state
    if (error) {
        return null // Silently fail - timeline is not critical
    }

    // No previous tickets
    if (tickets.length === 0) {
        return (
            <Card className="border-border/50 bg-muted/30 animate-in fade-in duration-300">
                <CardContent className="p-3">
                    <div className="flex items-center gap-2 text-muted-foreground">
                        <History className="w-4 h-4" />
                        <span className="text-sm">First conversation with this customer</span>
                    </div>
                </CardContent>
            </Card>
        )
    }

    // Has previous tickets
    return (
        <Card className="border-border/50 bg-gradient-to-br from-primary/5 to-transparent animate-in fade-in duration-300 overflow-hidden">
            <CardContent className="p-0">
                {/* Header - Always visible */}
                <button
                    className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-all duration-200 text-left group"
                    onClick={() => setExpanded(!expanded)}
                >
                    <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">Past Conversations</span>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-semibold bg-primary/10 text-primary">
                            {tickets.length}
                        </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        {!expanded && tickets.length > 0 && (
                            <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[150px]">
                                Last: {tickets[0]?.subject?.substring(0, 25)}{tickets[0]?.subject?.length > 25 ? '...' : ''}
                            </span>
                        )}
                        <div className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        </div>
                    </div>
                </button>

                {/* Expanded Timeline */}
                {expanded && (
                    <div className="border-t border-border/50 animate-in slide-in-from-top-2 duration-200">
                        <div className="max-h-80 overflow-y-auto">
                            {tickets.map((ticket, index) => {
                                const isNavigating = navigatingTo === ticket.id
                                return (
                                    <TooltipProvider key={ticket.id}>
                                        <div
                                            className={`
                        relative flex flex-col gap-2 p-4 transition-all duration-200 cursor-pointer
                        ${index !== tickets.length - 1 ? "border-b border-border/30" : ""}
                        ${isNavigating ? "bg-primary/10 scale-[0.98]" : "hover:bg-muted/50"}
                      `}
                                            onClick={() => !isNavigating && handleNavigate(ticket.id)}
                                        >
                                            {/* Loading overlay */}
                                            {isNavigating && (
                                                <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10 animate-in fade-in duration-150">
                                                    <div className="flex items-center gap-2 text-primary">
                                                        <Loader2 className="w-4 h-4 animate-spin" />
                                                        <span className="text-sm font-medium">Opening...</span>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Top row: Subject + Status */}
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                                    <div className="mt-0.5 flex-shrink-0">
                                                        {getStatusIcon(ticket.status)}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <p className="text-sm font-medium leading-tight line-clamp-2 hover:text-primary transition-colors">
                                                                    {ticket.subject || "(No subject)"}
                                                                </p>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="max-w-sm">
                                                                <p className="font-medium">{ticket.subject || "(No subject)"}</p>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                                <Badge
                                                    className={`h-5 px-2 text-[10px] capitalize flex-shrink-0 ${getStatusColor(ticket.status)}`}
                                                >
                                                    {ticket.status.replace("_", " ")}
                                                </Badge>
                                            </div>

                                            {/* Middle row: Date/Time info */}
                                            <div className="flex items-center gap-4 text-xs text-muted-foreground pl-5">
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="flex items-center gap-1">
                                                            <Calendar className="w-3 h-3" />
                                                            {formatDate(ticket.lastCustomerReplyAt || ticket.updatedAt)}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="bottom">
                                                        <p>Last activity: {formatFullDate(ticket.lastCustomerReplyAt || ticket.updatedAt)}</p>
                                                    </TooltipContent>
                                                </Tooltip>

                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="flex items-center gap-1">
                                                            <Clock className="w-3 h-3" />
                                                            {formatTime(ticket.lastCustomerReplyAt || ticket.updatedAt)}
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="bottom">
                                                        <p>Created: {formatFullDate(ticket.createdAt)}</p>
                                                    </TooltipContent>
                                                </Tooltip>

                                                {ticket.departmentName && (
                                                    <span className="flex items-center gap-1">
                                                        <Mail className="w-3 h-3" />
                                                        {ticket.departmentName}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Bottom row: Assignee + View button */}
                                            <div className="flex items-center justify-between pl-5">
                                                <div className="flex items-center gap-2">
                                                    {ticket.assigneeName ? (
                                                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                            <User className="w-3 h-3" />
                                                            Handled by {ticket.assigneeName}
                                                        </span>
                                                    ) : (
                                                        <span className="text-xs text-muted-foreground/70">
                                                            Unassigned
                                                        </span>
                                                    )}
                                                </div>

                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10 gap-1"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleNavigate(ticket.id)
                                                    }}
                                                    disabled={isNavigating}
                                                >
                                                    View Conversation
                                                    <ArrowRight className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </div>
                                    </TooltipProvider>
                                )
                            })}
                        </div>

                        {tickets.length > 3 && (
                            <div className="p-2 text-center border-t border-border/30 bg-muted/20">
                                <span className="text-xs text-muted-foreground">
                                    {tickets.length} previous conversations with this customer
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
