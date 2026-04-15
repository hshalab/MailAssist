"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import ShopifySettings from "@/components/shopify-settings"
import { AccountManager } from "@/components/account-manager"

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

interface SettingsViewProps {
  status: SyncStats | null
  syncing: boolean
  onSync: (maxResults?: number) => Promise<void>
  error?: string | null
  currentUserId?: string | null
  currentUserRole?: "admin" | "manager" | "agent" | null
}

export default function SettingsView({ status, syncing, onSync, error, currentUserRole }: SettingsViewProps) {
  const [message, setMessage] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [autoClassifyDays, setAutoClassifyDays] = useState<number>(30)
  const [enableAutoClassify, setEnableAutoClassify] = useState<boolean>(true)
  const [enableAiDrafts, setEnableAiDrafts] = useState<boolean>(true)
  const [enableAiSummarize, setEnableAiSummarize] = useState<boolean>(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)

  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'manager'

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        setAutoClassifyDays(data.auto_classify_days ?? 30)
        setEnableAutoClassify(data.enable_auto_classify ?? true)
        setEnableAiDrafts(data.enable_ai_drafts ?? true)
        setEnableAiSummarize(data.enable_ai_summarize ?? true)
      }
    } catch (err) {
      console.error('Error loading settings:', err)
    }
  }

  const saveSettings = async () => {
    setSavingSettings(true)
    setSettingsMessage(null)
    try {
      const response = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_classify_days: autoClassifyDays,
          enable_auto_classify: enableAutoClassify,
          enable_ai_drafts: enableAiDrafts,
          enable_ai_summarize: enableAiSummarize,
        }),
      })

      if (response.ok) {
        setSettingsMessage('Settings saved successfully!')
        setTimeout(() => setSettingsMessage(null), 3000)
      } else {
        const data = await response.json()
        setLocalError(data.error || 'Failed to save settings')
      }
    } catch (err) {
      setLocalError('Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  const formatLastSync = () => {
    if (!status?.lastSync) return "Never"
    return new Date(status.lastSync).toLocaleString()
  }

  const handleSyncClick = async () => {
    setMessage(null)
    setLocalError(null)
    try {
      await onSync(500)
      setMessage("Sync started in the background. Keep the tab open while we learn your tone.")
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to start sync")
    }
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="max-w-4xl mx-auto p-6 lg:p-8">
        <div className="mb-8 space-y-3">
          <h1 className="text-3xl lg:text-4xl font-bold text-foreground tracking-tight">Settings</h1>
          <p className="text-base text-muted-foreground">
            Manage your account and synchronization preferences
          </p>
        </div>

        <div className="space-y-6">
          <Card className="border-border shadow-lg">
            <CardHeader className="pb-6 pt-6 px-6">
              <CardTitle className="text-lg font-bold">Email synchronization</CardTitle>
              <CardDescription className="text-sm mt-2">
                Keep your sent emails synchronized so AI drafts match your exact tone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border-2 border-border bg-accent/5 p-4 hover:shadow-md transition-shadow">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Emails embedded</p>
                  <p className="text-2xl font-bold text-primary mt-3">
                    {status?.sentWithEmbeddings ?? 0}
                  </p>
                </div>
                <div className="rounded-xl border-2 border-border bg-accent/5 p-4 hover:shadow-md transition-shadow">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pending replies</p>
                  <p className="text-2xl font-bold text-primary mt-3">
                    {status?.pendingReplies ?? 0}
                  </p>
                </div>
                <div className="rounded-xl border-2 border-border bg-accent/5 p-4 hover:shadow-md transition-shadow">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Last sync</p>
                  <p className="text-sm font-semibold text-foreground mt-3">
                    {formatLastSync()}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={handleSyncClick}
                  disabled={syncing}
                  size="lg"
                  className="shadow-md hover:shadow-lg w-full sm:w-auto"
                >
                  {syncing ? "Syncing..." : "Sync sent emails"}
                </Button>

                {message && (
                  <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-900/50 rounded-xl px-5 py-4">
                    {message}
                  </div>
                )}

                {(error || localError) && (
                  <div className="text-sm font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3">
                    {error || localError}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-lg">
            <CardHeader className="pb-6 pt-6 px-6">
              <CardTitle className="text-lg font-bold">Classification Settings</CardTitle>
              <CardDescription className="text-sm mt-2">
                Configure how the Auto-Classify feature processes your tickets.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6">
              <div className="space-y-3">
                <Label htmlFor="auto-classify-days" className="text-sm font-medium">
                  Auto-Classify Time Range (days)
                </Label>
                <div className="flex gap-3 items-center">
                  <Input
                    id="auto-classify-days"
                    type="number"
                    min={1}
                    max={365}
                    value={autoClassifyDays}
                    onChange={(e) => setAutoClassifyDays(parseInt(e.target.value) || 30)}
                    className="w-32"
                  />
                  <span className="text-sm text-muted-foreground">
                    Classify tickets from the last {autoClassifyDays} days
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  When you click "Auto-Classify" in Departments, it will process open tickets from the last {autoClassifyDays} days.
                </p>
              </div>

              <div className="space-y-3">
                <Button
                  onClick={saveSettings}
                  disabled={savingSettings}
                  size="lg"
                  className="shadow-md hover:shadow-lg w-full sm:w-auto"
                >
                  {savingSettings ? "Saving..." : "Save Settings"}
                </Button>

                {settingsMessage && (
                  <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-900/50 rounded-xl px-5 py-4">
                    {settingsMessage}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* AI Feature Toggles — visible to admins and managers only */}
          {isAdminOrManager && (
            <Card className="border-border shadow-lg">
              <CardHeader className="pb-6 pt-6 px-6">
                <CardTitle className="text-lg font-bold">AI Features</CardTitle>
                <CardDescription className="text-sm mt-2">
                  Enable or disable AI features for this account. Disabling a feature stops all related OpenAI calls and reduces costs immediately.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 px-6 pb-6">
                {/* Ticket Auto-Classification */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-accent/5 px-5 py-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Ticket Auto-Classification</p>
                    <p className="text-xs text-muted-foreground">
                      Automatically assign incoming tickets to departments using AI. Disabling this saves the most cost.
                    </p>
                  </div>
                  <Switch
                    checked={enableAutoClassify}
                    onCheckedChange={setEnableAutoClassify}
                    aria-label="Toggle ticket auto-classification"
                  />
                </div>

                {/* AI Draft Generation */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-accent/5 px-5 py-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">AI Draft Generation</p>
                    <p className="text-xs text-muted-foreground">
                      Generate email reply drafts and new email drafts using AI.
                    </p>
                  </div>
                  <Switch
                    checked={enableAiDrafts}
                    onCheckedChange={setEnableAiDrafts}
                    aria-label="Toggle AI draft generation"
                  />
                </div>

                {/* AI Summarization */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-accent/5 px-5 py-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">AI Email Summarization</p>
                    <p className="text-xs text-muted-foreground">
                      Summarize email threads and conversations using AI.
                    </p>
                  </div>
                  <Switch
                    checked={enableAiSummarize}
                    onCheckedChange={setEnableAiSummarize}
                    aria-label="Toggle AI summarization"
                  />
                </div>

                <div className="space-y-3">
                  <Button
                    onClick={saveSettings}
                    disabled={savingSettings}
                    size="lg"
                    className="shadow-md hover:shadow-lg w-full sm:w-auto"
                  >
                    {savingSettings ? "Saving..." : "Save AI Settings"}
                  </Button>

                  {settingsMessage && (
                    <div className="text-sm font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-200 dark:border-emerald-900/50 rounded-xl px-5 py-4">
                      {settingsMessage}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-border/40 shadow-md">
            <CardHeader className="pb-6 pt-6 px-6">
              <CardTitle className="text-base">How syncing works</CardTitle>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3 h-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">Secure Gmail Integration</p>
                    <p className="text-xs text-muted-foreground mt-0.5">We fetch your sent emails securely via Gmail OAuth</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3 h-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">AI Tone Learning</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Each email is converted into embedding vectors to learn your writing style</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3 h-3 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-medium text-foreground">Continuous Updates</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Re-sync anytime to capture new sent emails and improve accuracy</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Account Management */}
          <AccountManager />

          {/* Shopify Integration Settings */}
          <ShopifySettings />
        </div>
      </div>
    </div>
  )
}

