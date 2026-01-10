"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import Logo from "@/components/logo"

interface GmailConnectProps {
  onConnect: () => void
}

export default function GmailConnect({ onConnect }: GmailConnectProps) {
  const [connecting, setConnecting] = useState(false)

  const handleConnect = async () => {
    try {
      setConnecting(true)
      // Set flag to show loading skeleton when returning from OAuth
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('show_inbox_skeleton_on_return', 'true')
      }

      // CRITICAL: Pass mode=connect to allow business accounts to connect Gmail
      // This bypasses the Google OAuth login restriction which only blocks LOGIN mode
      const response = await fetch('/api/auth/gmail?mode=connect')

      if (!response.ok) {
        throw new Error('Failed to get auth URL')
      }

      const { authUrl } = await response.json()
      // Redirect to Google OAuth
      window.location.href = authUrl
    } catch (error) {
      console.error('Error connecting Gmail:', error)
      alert('Failed to connect Gmail. Please try again.')
      setConnecting(false)
      // Clear flag on error
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('show_inbox_skeleton_on_return')
      }
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex flex-col items-center px-4 py-6 md:py-14">
      <div className="max-w-2xl w-full space-y-12 bg-card/95 border border-border rounded-3xl p-8 md:p-12 shadow-2xl">
        {/* Header section */}
        <div className="space-y-4 text-left">
          <Logo size="large" showText={true} />
          <h1 className="text-3xl md:text-5xl font-bold text-foreground leading-tight">
            Write emails that sound
            <br className="hidden md:block" />
            like you
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed">
            Mail Assistant learns your writing style and email habits to generate personalized drafts that match how you
            naturally end conversations. Work faster while staying authentic.
          </p>

          <div className="space-y-2 md:hidden">
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg text-base transition-all shadow-sm disabled:opacity-60"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Connect Gmail Account
            </Button>
            <p className="text-xs text-muted-foreground">No credit card required. Get started in seconds.</p>
          </div>
        </div>

        {/* Features grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-3 text-left">
            <div className="w-12 h-12 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
            </div>
            <h3 className="font-semibold text-foreground">Your Unique Tone</h3>
            <p className="text-sm text-muted-foreground">
              Drafts automatically match your writing style, personality, and how you typically end emails.
            </p>
          </div>

          <div className="space-y-3 text-left">
            <div className="w-12 h-12 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3 className="font-semibold text-foreground">Privacy First</h3>
            <p className="text-sm text-muted-foreground">
              Your data is encrypted and never stored. Full compliance guaranteed.
            </p>
          </div>

          <div className="space-y-3 text-left">
            <div className="w-12 h-12 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-primary"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
            </div>
            <h3 className="font-semibold text-foreground">Instant Integration</h3>
            <p className="text-sm text-muted-foreground">Works seamlessly with your existing Gmail account and workflow.</p>
          </div>
        </div>

        {/* CTA Button */}
        <div className="text-left hidden md:block">
          <Button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full h-12 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg text-base transition-all shadow-sm disabled:opacity-60"
          >
            <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Connect Gmail Account
          </Button>
          <p className="text-xs text-muted-foreground mt-4">No credit card required. Get started in seconds.</p>
        </div>
      </div>
    </div>
  )
}
