"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { Skeleton } from "./ui/skeleton"
import {
  BarChart3, Shield, Sparkles, Users, TrendingUp, TrendingDown, Clock,
  FileText, CheckCircle2, AlertCircle, Activity, Zap, Target,
  ArrowUpRight, ArrowDownRight, Minus
} from "lucide-react"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "./ui/chart"
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Area, AreaChart } from "recharts"

interface TicketAnalytics {
  byStatus: Record<string, number>
  totalTickets: number
  avgResponseTime: number
  avgResolutionTime: number
}

interface GuardrailStats {
  totalApplied: number
  totalBlocked: number
  topicRulesTriggered: number
  bannedWordsFound: number
}

interface AIUsageStats {
  draftsGenerated: number
  draftsRegenerated: number
  draftsEdited: number
  draftsSent: number
  avgResponseTime: number
  knowledgeItemsUsed: Record<string, number>
}

interface AgentAnalytics {
  userId: string
  userName: string
  ticketsAssigned: number
  ticketsClosed: number
  avgResponseTime: number
  draftsGenerated: number
  draftsSent: number
  draftsEdited: number
  directSends: number
}

interface AnalyticsDashboardProps {
  currentUserRole: "admin" | "manager" | "agent" | null
}

const COLORS = {
  open: "hsl(var(--chart-1))",
  pending: "hsl(var(--chart-2))",
  on_hold: "hsl(var(--chart-3))",
  closed: "hsl(var(--chart-4))",
  success: "hsl(142, 76%, 36%)",
  warning: "hsl(38, 92%, 50%)",
  danger: "hsl(0, 84%, 60%)",
  info: "hsl(199, 89%, 48%)",
}

export default function AnalyticsDashboard({ currentUserRole }: AnalyticsDashboardProps) {
  const [loading, setLoading] = useState(true)
  const [ticketAnalytics, setTicketAnalytics] = useState<TicketAnalytics | null>(null)
  const [guardrailStats, setGuardrailStats] = useState<GuardrailStats | null>(null)
  const [aiUsageStats, setAIUsageStats] = useState<AIUsageStats | null>(null)
  const [agentAnalytics, setAgentAnalytics] = useState<AgentAnalytics[]>([])
  const [dateRange, setDateRange] = useState({ startDate: "", endDate: "" })
  const [error, setError] = useState<string | null>(null)

  const canViewAnalytics = currentUserRole === "admin" || currentUserRole === "manager"

  useEffect(() => {
    if (!canViewAnalytics) {
      setLoading(false)
      return
    }

    const endDate = new Date()
    const startDate = new Date('2000-01-01') // All-time view to match Tickets page (no date filtering)

    setDateRange({
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    })

    fetchAnalytics(startDate, endDate)
  }, [canViewAnalytics])

  const fetchAnalytics = async (startDate: Date, endDate: Date) => {
    if (!canViewAnalytics) return

    try {
      setLoading(true)
      setError(null)

      const startStr = startDate.toISOString().split('T')[0]
      const endStr = endDate.toISOString().split('T')[0]

      const [ticketsRes, guardrailsRes, aiRes, agentsRes] = await Promise.all([
        fetch(`/api/analytics/tickets?startDate=${startStr}&endDate=${endStr}`),
        fetch(`/api/analytics/guardrails?startDate=${startStr}&endDate=${endStr}`),
        fetch(`/api/analytics/ai?startDate=${startStr}&endDate=${endStr}`),
        fetch(`/api/analytics/agents?startDate=${startStr}&endDate=${endStr}`),
      ])

      if (!ticketsRes.ok || !guardrailsRes.ok || !aiRes.ok || !agentsRes.ok) {
        throw new Error("Failed to fetch analytics")
      }

      const ticketsData = await ticketsRes.json()
      const guardrailsData = await guardrailsRes.json()
      const aiData = await aiRes.json()
      const agentsData = await agentsRes.json()

      setTicketAnalytics(ticketsData.analytics || null)
      setGuardrailStats(guardrailsData.stats || null)
      setAIUsageStats(aiData.stats || null)
      setAgentAnalytics(agentsData.agents || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics")
    } finally {
      setLoading(false)
    }
  }

  const handleDateChange = () => {
    if (dateRange.startDate && dateRange.endDate) {
      fetchAnalytics(new Date(dateRange.startDate), new Date(dateRange.endDate))
    }
  }

  if (!canViewAnalytics) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background p-8">
        <Card className="max-w-md w-full p-10 text-center shadow-xl border border-border/60">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
              <BarChart3 className="w-8 h-8" />
            </div>
          </div>
          <CardHeader className="p-0 pb-4">
            <CardTitle className="text-2xl font-bold">Analytics Dashboard</CardTitle>
            <CardDescription className="text-base mt-3">Access restricted to admins and managers</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
        </Card>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const formatMinutes = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return `${hours}h ${mins}m`
  }

  const formatMs = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // Prepare chart data
  const statusColors: Record<string, string> = {
    open: "var(--status-info)",
    pending: "var(--status-medium)",
    on_hold: "var(--status-high)",
    closed: "var(--status-success)",
  }

  const ticketStatusData = ticketAnalytics
    ? Object.entries(ticketAnalytics.byStatus).map(([status, count]) => ({
      status: status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' '),
      count,
      fill: statusColors[status] || "#6b7280",
    }))
    : []

  const agentPerformanceData = agentAnalytics
    .slice(0, 10)
    .map((agent) => ({
      name: agent.userName.length > 12 ? agent.userName.substring(0, 12) + '...' : agent.userName,
      tickets: agent.ticketsAssigned,
      closed: agent.ticketsClosed,
      drafts: agent.draftsSent,
    }))

  const aiWorkflowData = aiUsageStats ? [
    { name: "Generated", value: aiUsageStats.draftsGenerated, fill: "var(--ai-gradient-from)" },
    { name: "Sent", value: aiUsageStats.draftsSent, fill: "var(--status-success)" },
    { name: "Edited", value: aiUsageStats.draftsEdited, fill: "var(--status-medium)" },
  ] : []

  const sendRate = aiUsageStats && aiUsageStats.draftsGenerated > 0
    ? Math.round((aiUsageStats.draftsSent / aiUsageStats.draftsGenerated) * 100)
    : 0

  const editRate = aiUsageStats && aiUsageStats.draftsSent > 0
    ? Math.round((aiUsageStats.draftsEdited / aiUsageStats.draftsSent) * 100)
    : 0

  const closureRate = ticketAnalytics && ticketAnalytics.totalTickets > 0
    ? Math.round(((ticketAnalytics.byStatus.closed || 0) / ticketAnalytics.totalTickets) * 100)
    : 0

  return (
    <div className="space-y-6 p-6 max-w-[1600px] mx-auto bg-gradient-to-br from-muted/20 via-background to-muted/30 min-h-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--chart-1)] to-[var(--chart-3)] flex items-center justify-center shadow-md">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Analytics Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Comprehensive insights into your helpdesk performance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={dateRange.startDate}
            onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
            className="px-3 py-1.5 border rounded-md text-sm bg-background hover:border-foreground/20 transition-all shadow-sm"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <input
            type="date"
            value={dateRange.endDate}
            onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
            className="px-3 py-1.5 border rounded-md text-sm bg-background hover:border-foreground/20 transition-all shadow-sm"
          />
          <button
            onClick={handleDateChange}
            className="px-4 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-all shadow-md hover:shadow-lg"
          >
            Update
          </button>
        </div>
      </div>

      {/* Key Metrics Overview - Colorful KPI Cards */}
      {ticketAnalytics && aiUsageStats && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="hover:shadow-lg transition-all hover:scale-[1.02] border-[var(--status-info)]/30 bg-gradient-to-br from-[var(--status-info-bg)] to-transparent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 pt-6 px-6">
              <CardTitle className="text-sm font-medium">Total Tickets</CardTitle>
              <div className="w-8 h-8 rounded-lg bg-[var(--status-info)]/20 flex items-center justify-center">
                <FileText className="h-4 w-4 text-[var(--status-info)]" />
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="text-3xl font-bold tracking-tight text-foreground">{ticketAnalytics.totalTickets}</div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--status-success)]" />
                {closureRate}% closed
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-all hover:scale-[1.02] border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 pt-6 px-6">
              <CardTitle className="text-sm font-medium">AI Send Rate</CardTitle>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--ai-gradient-from)] to-[var(--ai-gradient-to)] flex items-center justify-center shadow-sm">
                <Zap className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="text-3xl font-bold tracking-tight text-foreground">{sendRate}%</div>
              <p className="text-xs text-muted-foreground mt-2">
                {aiUsageStats.draftsSent} of {aiUsageStats.draftsGenerated} drafts sent
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-all hover:scale-[1.02] border-[var(--status-medium)]/30 bg-gradient-to-br from-[var(--status-medium-bg)] to-transparent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 pt-6 px-6">
              <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
              <div className="w-8 h-8 rounded-lg bg-[var(--status-medium)]/20 flex items-center justify-center">
                <Clock className="h-4 w-4 text-[var(--status-medium)]" />
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="text-3xl font-bold tracking-tight text-foreground">
                {ticketAnalytics.avgResponseTime > 0
                  ? formatMinutes(ticketAnalytics.avgResponseTime)
                  : "N/A"}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Time to first response
              </p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-all hover:scale-[1.02] border-[var(--status-success)]/30 bg-gradient-to-br from-[var(--status-success-bg)] to-transparent">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3 pt-6 px-6">
              <CardTitle className="text-sm font-medium">Active Agents</CardTitle>
              <div className="w-8 h-8 rounded-lg bg-[var(--status-success)]/20 flex items-center justify-center">
                <Users className="h-4 w-4 text-[var(--status-success)]" />
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="text-3xl font-bold tracking-tight text-foreground">{agentAnalytics.length}</div>
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-[var(--status-success)]" />
                {agentAnalytics.filter(a => a.ticketsAssigned > 0).length} with active tickets
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 bg-muted/50 p-1 rounded-xl">
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md font-medium transition-all data-[state=inactive]:text-muted-foreground"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="tickets"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md font-medium transition-all data-[state=inactive]:text-muted-foreground"
          >
            Tickets
          </TabsTrigger>
          <TabsTrigger
            value="ai"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md font-medium transition-all data-[state=inactive]:text-muted-foreground"
          >
            AI Usage
          </TabsTrigger>
          <TabsTrigger
            value="agents"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md font-medium transition-all data-[state=inactive]:text-muted-foreground"
          >
            Agents
          </TabsTrigger>
          <TabsTrigger
            value="guardrails"
            className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-md font-medium transition-all data-[state=inactive]:text-muted-foreground"
          >
            Guardrails
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Ticket Status Distribution */}
            {ticketStatusData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Ticket Status Distribution</CardTitle>
                  <CardDescription className="text-xs">Breakdown of tickets by status</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      count: { label: "Tickets" },
                    }}
                    className="h-[280px]"
                  >
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Pie
                        data={ticketStatusData}
                        dataKey="count"
                        nameKey="status"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        innerRadius={40}
                        label={({ status, count }) => `${status}: ${count}`}
                        labelLine={false}
                      >
                        {ticketStatusData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} stroke="hsl(var(--background))" strokeWidth={2} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {/* AI Workflow */}
            {aiUsageStats && aiUsageStats.draftsGenerated > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">AI Draft Workflow</CardTitle>
                  <CardDescription className="text-xs">Draft generation and usage metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer
                    config={{
                      Generated: { label: "Generated", color: "#3b82f6" },
                      Sent: { label: "Sent", color: "#10b981" },
                      Edited: { label: "Edited", color: "#f59e0b" },
                    }}
                    className="h-[280px]"
                  >
                    <BarChart data={aiWorkflowData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                        axisLine={{ stroke: "hsl(var(--border))" }}
                      />
                      <YAxis
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                        axisLine={{ stroke: "hsl(var(--border))" }}
                      />
                      <ChartTooltip
                        content={<ChartTooltipContent />}
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.1 }}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#8884d8">
                        {aiWorkflowData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Agent Performance Chart */}
          {agentPerformanceData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top Agent Performance</CardTitle>
                <CardDescription className="text-xs">Top 10 agents by ticket volume</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer
                  config={{
                    tickets: { label: "Tickets Assigned", color: "#3b82f6" },
                    closed: { label: "Tickets Closed", color: "#10b981" },
                    drafts: { label: "Drafts Sent", color: "#8b5cf6" },
                  }}
                  className="h-[320px]"
                >
                  <BarChart data={agentPerformanceData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis
                      dataKey="name"
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <YAxis
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                      axisLine={{ stroke: "hsl(var(--border))" }}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.1 }}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="tickets" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="closed" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="drafts" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tickets Tab */}
        <TabsContent value="tickets" className="space-y-4">
          {ticketAnalytics && ticketAnalytics.totalTickets > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Activity className="h-4 w-4" />
                      Response Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {ticketAnalytics.avgResponseTime > 0
                        ? formatMinutes(ticketAnalytics.avgResponseTime)
                        : "N/A"}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Average time to first response
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      Resolution Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {ticketAnalytics.avgResolutionTime > 0
                        ? formatMinutes(ticketAnalytics.avgResolutionTime)
                        : "N/A"}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Average time to resolution
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Closure Rate
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{closureRate}%</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {ticketAnalytics.byStatus.closed || 0} of {ticketAnalytics.totalTickets} tickets
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Ticket Status Breakdown</CardTitle>
                  <CardDescription>Detailed view of ticket distribution</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {Object.entries(ticketAnalytics.byStatus).map(([status, count]) => {
                      const percentage = (count / ticketAnalytics.totalTickets) * 100
                      const statusColors: Record<string, string> = {
                        open: "bg-blue-500",
                        pending: "bg-yellow-500",
                        on_hold: "bg-orange-500",
                        closed: "bg-green-500",
                      }
                      return (
                        <div key={status} className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="capitalize font-medium">
                              {status.replace('_', ' ')}
                            </span>
                            <span className="font-bold">{count} ({Math.round(percentage)}%)</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-2">
                            <div
                              className="h-2 rounded-full bg-foreground"
                              style={{ width: `${percentage}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No ticket data available for the selected date range.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* AI Usage Tab */}
        <TabsContent value="ai" className="space-y-4">
          {aiUsageStats && (aiUsageStats.draftsGenerated > 0 || aiUsageStats.draftsSent > 0) ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Drafts Generated</CardTitle>
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{aiUsageStats.draftsGenerated}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {aiUsageStats.draftsRegenerated > 0 && (
                        <span>{aiUsageStats.draftsRegenerated} regenerated</span>
                      )}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Send Rate</CardTitle>
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-600">{sendRate}%</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {aiUsageStats.draftsSent} sent
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Edit Rate</CardTitle>
                    <Activity className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-orange-600">{editRate}%</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {aiUsageStats.draftsEdited} edited before sending
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Avg Generation Time</CardTitle>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {aiUsageStats.avgResponseTime > 0
                        ? formatMs(aiUsageStats.avgResponseTime)
                        : "N/A"}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Per draft generation
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Draft Workflow</CardTitle>
                    <CardDescription>How drafts move through the system</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">
                            {aiUsageStats.draftsGenerated}
                          </div>
                          <div>
                            <p className="font-medium">Generated</p>
                            <p className="text-xs text-muted-foreground">Total drafts created</p>
                          </div>
                        </div>
                        <ArrowDownRight className="h-5 w-5 text-muted-foreground" />
                      </div>

                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold">
                            {aiUsageStats.draftsSent}
                          </div>
                          <div>
                            <p className="font-medium">Sent</p>
                            <p className="text-xs text-muted-foreground">
                              {sendRate}% of generated drafts
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold">
                            {aiUsageStats.draftsEdited}
                          </div>
                          <div>
                            <p className="font-medium">Edited Before Sending</p>
                            <p className="text-xs text-muted-foreground">
                              {editRate}% edit rate
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold">
                            {aiUsageStats.draftsSent - aiUsageStats.draftsEdited}
                          </div>
                          <div>
                            <p className="font-medium">Direct Sends</p>
                            <p className="text-xs text-muted-foreground">
                              Sent without editing
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>AI Performance Insights</CardTitle>
                    <CardDescription>Key metrics and recommendations</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {sendRate >= 70 ? (
                      <div className="flex items-start gap-3 p-3 bg-muted/50 border border-border rounded-lg">
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm">
                            Excellent Send Rate
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {sendRate}% of drafts are being sent, indicating high AI quality.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 p-3 bg-muted/50 border border-border rounded-lg">
                        <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm">
                            Low Send Rate
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Only {sendRate}% of drafts are sent. Consider improving AI prompts or guardrails.
                          </p>
                        </div>
                      </div>
                    )}

                    {editRate >= 50 ? (
                      <div className="flex items-start gap-3 p-3 bg-muted/50 border border-border rounded-lg">
                        <Activity className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm">
                            High Edit Rate
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {editRate}% of sent drafts are edited. Agents are actively refining AI output.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 p-3 bg-muted/50 border border-border rounded-lg">
                        <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm">
                            High Confidence
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {100 - editRate}% of drafts sent directly. AI quality is trusted.
                          </p>
                        </div>
                      </div>
                    )}

                    {aiUsageStats.avgResponseTime > 0 && (
                      <div className="flex items-start gap-3 p-3 bg-muted/50 border border-border rounded-lg">
                        <Zap className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium text-sm">
                            Generation Speed
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Average generation time: {formatMs(aiUsageStats.avgResponseTime)}
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Sparkles className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No AI usage data available for the selected date range.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-4">
          {agentAnalytics && agentAnalytics.length > 0 ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Agent Performance Overview</CardTitle>
                  <CardDescription>
                    Individual performance metrics for {agentAnalytics.length} active agents
                  </CardDescription>
                </CardHeader>
              </Card>

              <div className="grid gap-4">
                {agentAnalytics.map((agent, index) => {
                  const closureRate = agent.ticketsAssigned > 0
                    ? Math.round((agent.ticketsClosed / agent.ticketsAssigned) * 100)
                    : 0
                  const sendRate = agent.draftsGenerated > 0
                    ? Math.round((agent.draftsSent / agent.draftsGenerated) * 100)
                    : 0
                  const editRate = agent.draftsSent > 0
                    ? Math.round((agent.draftsEdited / agent.draftsSent) * 100)
                    : 0

                  return (
                    <Card key={agent.userId} className="hover:shadow-sm transition-shadow">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {index < 3 && (
                              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center font-semibold text-xs text-foreground">
                                {index + 1}
                              </div>
                            )}
                            <CardTitle className="text-lg font-semibold">{agent.userName}</CardTitle>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold">{agent.ticketsAssigned}</div>
                            <div className="text-xs text-muted-foreground">Tickets Assigned</div>
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-6 md:grid-cols-4">
                          <div className="space-y-2">
                            <div className="text-sm text-muted-foreground">Tickets Closed</div>
                            <div className="text-2xl font-bold">{agent.ticketsClosed}</div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className="bg-foreground h-1.5 rounded-full"
                                style={{ width: `${closureRate}%` }}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground">{closureRate}% closure rate</div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm text-muted-foreground">Drafts Sent</div>
                            <div className="text-2xl font-bold">{agent.draftsSent}</div>
                            <div className="w-full bg-muted rounded-full h-1.5">
                              <div
                                className="bg-foreground h-1.5 rounded-full"
                                style={{ width: `${sendRate}%` }}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground">{sendRate}% send rate</div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm text-muted-foreground">Avg Response Time</div>
                            <div className="text-2xl font-bold">
                              {agent.avgResponseTime > 0
                                ? formatMs(agent.avgResponseTime)
                                : "N/A"}
                            </div>
                            <div className="text-xs text-muted-foreground">Per draft</div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm text-muted-foreground">Edit Behavior</div>
                            <div className="text-2xl font-bold">{editRate}%</div>
                            <div className="flex gap-2 text-xs">
                              <span className="text-muted-foreground">
                                {agent.draftsEdited} edited
                              </span>
                              <span className="text-muted-foreground">•</span>
                              <span className="text-muted-foreground">
                                {agent.directSends} direct
                              </span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No agent performance data available for the selected date range.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Guardrails Tab */}
        <TabsContent value="guardrails" className="space-y-4">
          {guardrailStats && (guardrailStats.totalApplied > 0 || guardrailStats.totalBlocked > 0) ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Guardrails Applied</CardTitle>
                    <Shield className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{guardrailStats.totalApplied}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Total applications
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Drafts Blocked</CardTitle>
                    <AlertCircle className="h-4 w-4 text-red-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-red-600">
                      {guardrailStats.totalBlocked}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {guardrailStats.totalApplied > 0
                        ? `${Math.round((guardrailStats.totalBlocked / guardrailStats.totalApplied) * 100)}% block rate`
                        : "N/A"}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Topic Rules Triggered</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{guardrailStats.topicRulesTriggered}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Context-specific rules
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Banned Words Found</CardTitle>
                    <AlertCircle className="h-4 w-4 text-orange-500" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-orange-600">
                      {guardrailStats.bannedWordsFound}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Instances detected
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Guardrail Effectiveness</CardTitle>
                  <CardDescription>How well guardrails are protecting your communications</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {guardrailStats.totalApplied > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">Block Rate</span>
                          <span className="font-bold">
                            {Math.round((guardrailStats.totalBlocked / guardrailStats.totalApplied) * 100)}%
                          </span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className="bg-foreground h-2 rounded-full"
                            style={{
                              width: `${(guardrailStats.totalBlocked / guardrailStats.totalApplied) * 100}%`
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {guardrailStats.totalBlocked} drafts blocked out of {guardrailStats.totalApplied} applications
                        </p>
                      </div>
                    )}

                    {guardrailStats.topicRulesTriggered > 0 && (
                      <div className="p-3 bg-muted/50 border border-border rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <Activity className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">
                            Topic Rules Active
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {guardrailStats.topicRulesTriggered} topic-specific rules were triggered, ensuring context-aware responses.
                        </p>
                      </div>
                    )}

                    {guardrailStats.bannedWordsFound > 0 && (
                      <div className="p-3 bg-muted/50 border border-border rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertCircle className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">
                            Banned Words Detected
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {guardrailStats.bannedWordsFound} instances of banned words/phrases were found and blocked.
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No guardrail data available for the selected date range.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
