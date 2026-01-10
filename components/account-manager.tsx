'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Trash2, Mail, Plus, AlertTriangle } from 'lucide-react'
import { ConnectImapForm } from './connect-imap-form'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface Account {
    email: string
    connectedAt: string
    status: string
    provider: string
}

export function AccountManager() {
    const [accounts, setAccounts] = useState<Account[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isDisconnecting, setIsDisconnecting] = useState<string | null>(null)
    const [showImapForm, setShowImapForm] = useState(false)
    const [currentPlan, setCurrentPlan] = useState<'personal' | 'business'>('personal')
    const [isSwitchingPlan, setIsSwitchingPlan] = useState(false)
    const [accountToDelete, setAccountToDelete] = useState<string | null>(null)

    const fetchAccounts = async () => {
        try {
            // Add cache-busting to ensure fresh data after reconnection
            const res = await fetch(`/api/auth/accounts?_=${Date.now()}`, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            })
            if (res.ok) {
                const data = await res.json()
                console.log('[AccountManager] Fetched accounts:', data.accounts?.length || 0)
                setAccounts(data.accounts || [])
            } else {
                console.error('[AccountManager] Failed to fetch accounts:', res.status, res.statusText)
            }
        } catch (error) {
            console.error('Failed to fetch accounts:', error)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchAccounts()

        // Check current user role/plan
        const checkPlan = async () => {
            try {
                const res = await fetch('/api/auth/current-user')
                if (res.ok) {
                    const data = await res.json()
                    // FIXED: Check for businessId to determine plan
                    // businessId !== null && businessId !== undefined = business account
                    // businessId === null = personal account
                    if (data.user?.businessId !== null && data.user?.businessId !== undefined) {
                        setCurrentPlan('business')
                    } else {
                        setCurrentPlan('personal')
                    }
                }
            } catch (e) {
                console.error('Failed to check plan:', e)
            }
        }
        checkPlan()

        // Listen for account changes (e.g., after reconnecting)
        const handleAccountsChanged = () => {
            console.log('[AccountManager] Accounts changed event received, refreshing accounts list')
            fetchAccounts()
        }
        
        // Also listen for storage events (cross-tab communication)
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === 'accountsChanged') {
                console.log('[AccountManager] Accounts changed detected via storage event, refreshing')
                fetchAccounts()
            }
        }
        
        window.addEventListener('accountsChanged', handleAccountsChanged)
        window.addEventListener('storage', handleStorageChange)
        
        // Check on mount if accounts changed (e.g., after OAuth return)
        const checkAccountsChanged = () => {
            const accountsChanged = localStorage.getItem('accountsChanged')
            if (accountsChanged) {
                fetchAccounts()
                localStorage.removeItem('accountsChanged')
            }
        }
        checkAccountsChanged()
        
        // Also check URL params for OAuth return
        if (typeof window !== 'undefined') {
            const urlParams = new URLSearchParams(window.location.search)
            if (urlParams.get('auth') === 'success' || urlParams.get('connected') === 'true') {
                // Refresh accounts after a short delay to ensure tokens are saved
                setTimeout(() => {
                    fetchAccounts()
                }, 1000)
            }
        }
        
        return () => {
            window.removeEventListener('accountsChanged', handleAccountsChanged)
            window.removeEventListener('storage', handleStorageChange)
        }
    }, [])

    const handleDisconnect = async (email: string) => {
        setAccountToDelete(email)
    }

    const confirmDisconnect = async () => {
        if (!accountToDelete) return

        setIsDisconnecting(accountToDelete)
        const emailToDelete = accountToDelete // Store before clearing state
        
        try {
            const res = await fetch('/api/auth/accounts/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: emailToDelete }),
                cache: 'no-store'
            })

            const data = await res.json()

            if (res.ok && data.success) {
                // Update local state immediately
                setAccounts(prev => prev.filter(a => a.email !== emailToDelete))
                setAccountToDelete(null)
                
                // CRITICAL: Trigger refresh for ALL users in the business
                // This ensures agents, managers, and admins all see the changes
                window.dispatchEvent(new CustomEvent('accountsChanged'))
                
                // Broadcast to all tabs/windows that accounts changed
                if (typeof window !== 'undefined' && window.localStorage) {
                    localStorage.setItem('accountsChanged', Date.now().toString())
                    // Also set a flag to prevent OAuth from recreating tokens
                    localStorage.setItem(`disconnected_${emailToDelete}`, Date.now().toString())
                }
                
                // Wait longer to ensure database deletion completes and prevent race conditions
                // Then reload the page to ensure clean state and reflect deletions
                setTimeout(() => {
                    // Clear the disconnected flag before reload
                    if (typeof window !== 'undefined' && window.localStorage) {
                        localStorage.removeItem(`disconnected_${emailToDelete}`)
                    }
                    window.location.reload()
                }, 1500) // Increased to 1500ms to ensure deletion completes
            } else {
                console.error('Disconnect failed:', data.error)
                alert(data.error || 'Failed to disconnect account. Please try again.')
                setIsDisconnecting(null)
                setAccountToDelete(null)
            }
        } catch (error) {
            console.error('Error disconnecting account:', error)
            alert('Error disconnecting account. Please try again.')
            setIsDisconnecting(null)
            setAccountToDelete(null)
        }
    }

    const handleConnectGmail = async () => {
        try {
            // Use mode=connect to ensure it links to current session instead of logging in
            const res = await fetch('/api/auth/gmail?mode=connect')
            if (!res.ok) throw new Error('Failed to get auth URL')
            const data = await res.json()
            if (data.authUrl) {
                window.location.href = data.authUrl
            } else if (data.url) {
                window.location.href = data.url
            } else {
                console.error('No auth URL in response:', data)
                alert('Failed to initiate connection')
            }
        } catch (error) {
            console.error('Failed to initiate Gmail connection:', error)
            alert('Failed to initiate connection')
        }
    }

    const handleUpgrade = async () => {
        if (!confirm('Upgrade to Business Plan? This will create a new business account for you.')) return
        setIsSwitchingPlan(true)
        try {
            const res = await fetch('/api/user/upgrade', { method: 'POST' })
            if (res.ok) {
                alert('Upgraded to Business Plan successfully!')
                window.location.reload() // Reload to refresh session/UI
            } else {
                const data = await res.json()
                alert(data.error || 'Failed to upgrade')
            }
        } catch (e) {
            alert('An error occurred')
        } finally {
            setIsSwitchingPlan(false)
        }
    }

    const handleDowngrade = async () => {
        if (!confirm('Switch to Personal Plan? Warning: This will remove your business account. You cannot downgrade if you have other team members.')) return
        setIsSwitchingPlan(true)
        try {
            const res = await fetch('/api/user/downgrade', { method: 'POST' })
            if (res.ok) {
                alert('Switched to Personal Plan successfully!')
                window.location.reload() // Reload to refresh session/UI
            } else {
                const data = await res.json()
                alert(data.error || 'Failed to downgrade')
            }
        } catch (e) {
            alert('An error occurred')
        } finally {
            setIsSwitchingPlan(false)
        }
    }

    return (
        <div className="space-y-8">
            {/* Plan Management Section */}
            <div className="space-y-4">
                <h3 className="text-lg font-medium">Plan & Billing</h3>
                <Card>
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-base">Current Plan: {currentPlan === 'business' ? 'Business' : 'Personal'}</h4>
                                <Badge variant={currentPlan === 'business' ? 'default' : 'secondary'}>
                                    {currentPlan === 'business' ? 'PRO' : 'FREE'}
                                </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {currentPlan === 'business'
                                    ? 'You have access to team features, analytics, and multiple accounts.'
                                    : 'Perfect for individuals. Upgrade to unlock team features.'}
                            </p>
                        </div>
                        <div>
                            {currentPlan === 'personal' ? (
                                <Button onClick={handleUpgrade} disabled={isSwitchingPlan}>
                                    {isSwitchingPlan && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Upgrade to Business
                                </Button>
                            ) : (
                                <Button variant="outline" onClick={handleDowngrade} disabled={isSwitchingPlan} className="text-destructive hover:text-destructive">
                                    {isSwitchingPlan && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Switch to Personal
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="space-y-6">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium">Connected Accounts</h3>
                    <div className="flex gap-2">
                        <Button onClick={handleConnectGmail} variant="outline" size="sm">
                            <Mail className="mr-2 h-4 w-4" />
                            Connect Gmail
                        </Button>
                        <Button onClick={() => setShowImapForm(true)} variant="outline" size="sm">
                            <Plus className="mr-2 h-4 w-4" />
                            Connect Other
                        </Button>
                    </div>
                </div>

                <Dialog open={showImapForm} onOpenChange={setShowImapForm}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>Connect Email Account</DialogTitle>
                            <DialogDescription>
                                Connect any email provider using IMAP/SMTP
                            </DialogDescription>
                        </DialogHeader>
                        <ConnectImapForm
                            onSuccess={() => {
                                setShowImapForm(false)
                                fetchAccounts()
                            }}
                            onCancel={() => setShowImapForm(false)}
                        />
                    </DialogContent>
                </Dialog>

                <div className="grid gap-4">
                    {isLoading ? (
                        <div className="flex justify-center p-4">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : accounts.length === 0 ? (
                        <Card>
                            <CardContent className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                                <Mail className="h-12 w-12 mb-4 opacity-20" />
                                <p>No accounts connected yet.</p>
                                <p className="text-sm">Connect an email account to start managing tickets.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        accounts.map((account) => (
                            <Card key={account.email}>
                                <CardContent className="flex items-center justify-between p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                            <Mail className="h-5 w-5 text-primary" />
                                        </div>
                                        <div>
                                            <div className="font-medium flex items-center gap-2">
                                                {account.email}
                                                <Badge variant="secondary" className="text-xs">
                                                    {account.provider || 'gmail'}
                                                </Badge>
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                Connected {new Date(account.connectedAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive hover:text-destructive/90 hover:bg-destructive/10"
                                        onClick={() => handleDisconnect(account.email)}
                                        disabled={isDisconnecting === account.email}
                                    >
                                        {isDisconnecting === account.email ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Trash2 className="h-4 w-4" />
                                        )}
                                    </Button>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
            </div>

            {/* Delete Account Confirmation Dialog */}
            <Dialog open={!!accountToDelete} onOpenChange={(open) => !open && setAccountToDelete(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader className="space-y-4">
                        <div className="flex items-start gap-3">
                            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                                <AlertTriangle className="h-6 w-6 text-destructive" />
                            </div>
                            <div className="flex-1 pt-1">
                                <DialogTitle className="text-xl font-semibold mb-2">Disconnect Account</DialogTitle>
                                <DialogDescription className="text-sm text-muted-foreground">
                                    Are you sure you want to disconnect <span className="font-semibold text-foreground">{accountToDelete}</span>?
                                </DialogDescription>
                            </div>
                        </div>
                    </DialogHeader>
                    <Alert className="mt-4 bg-amber-500/10 border-amber-500/20">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="text-sm text-amber-700 dark:text-amber-400 ml-2">
                            This will remove the account connection. Emails and tickets from this account will no longer be accessible.
                        </AlertDescription>
                    </Alert>
                    <DialogFooter className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end sm:gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setAccountToDelete(null)}
                            disabled={isDisconnecting === accountToDelete}
                            className="w-full sm:w-auto"
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={confirmDisconnect}
                            disabled={isDisconnecting === accountToDelete}
                            className="w-full sm:w-auto bg-destructive hover:bg-destructive/90"
                        >
                            {isDisconnecting === accountToDelete ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Disconnecting...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Disconnect
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
