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
            const res = await fetch('/api/auth/accounts')
            if (res.ok) {
                const data = await res.json()
                setAccounts(data.accounts || [])
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
    }, [])

    const handleDisconnect = async (email: string) => {
        setAccountToDelete(email)
    }

    const confirmDisconnect = async () => {
        if (!accountToDelete) return

        setIsDisconnecting(accountToDelete)
        try {
            const res = await fetch('/api/auth/accounts/disconnect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: accountToDelete }),
            })

            if (res.ok) {
                setAccounts(prev => prev.filter(a => a.email !== accountToDelete))
                setAccountToDelete(null)
                // Trigger refresh of inbox and tickets to remove emails from disconnected account
                window.dispatchEvent(new CustomEvent('accountsChanged'))
                // Also reload the page to ensure clean state
                setTimeout(() => {
                    window.location.reload()
                }, 500)
            } else {
                const data = await res.json()
                alert(data.error || 'Failed to disconnect account')
            }
        } catch (error) {
            console.error('Error disconnecting account:', error)
            alert('Error disconnecting account')
        } finally {
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
                    <DialogHeader>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
                                <AlertTriangle className="h-5 w-5 text-destructive" />
                            </div>
                            <DialogTitle className="text-xl">Disconnect Account</DialogTitle>
                        </div>
                        <DialogDescription className="text-base pt-2">
                            Are you sure you want to disconnect <strong>{accountToDelete}</strong>?
                        </DialogDescription>
                    </DialogHeader>
                    <Alert className="bg-amber-500/10 border-amber-500/20">
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                        <AlertDescription className="text-sm text-amber-700 dark:text-amber-400 ml-2">
                            This will remove the account connection. Emails and tickets from this account will no longer be accessible.
                        </AlertDescription>
                    </Alert>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            onClick={() => setAccountToDelete(null)}
                            disabled={isDisconnecting === accountToDelete}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={confirmDisconnect}
                            disabled={isDisconnecting === accountToDelete}
                            className="bg-destructive hover:bg-destructive/90"
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
