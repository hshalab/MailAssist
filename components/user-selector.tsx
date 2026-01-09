"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { User, AlertTriangle, Loader2 } from "lucide-react"
import PromoteAdminDialog from "@/components/promote-admin-dialog"

interface User {
  id: string
  name: string
  email?: string | null
  role: "admin" | "manager" | "agent"
  isActive: boolean
}

interface UserSelectorProps {
  onUserSelected: (userId: string) => void
  onCreateNew?: () => void
  currentUserId?: string | null
}

export default function UserSelector({ onUserSelected, onCreateNew, currentUserId }: UserSelectorProps) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null) // Separate error for dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newUserName, setNewUserName] = useState("")
  const [newUserEmail, setNewUserEmail] = useState("")
  // Default to admin if no users exist, otherwise default to agent
  const [newUserRole, setNewUserRole] = useState<"admin" | "manager" | "agent">(
    users.length === 0 ? "admin" : "agent"
  )
  const [creating, setCreating] = useState(false)
  const [showPromoteDialog, setShowPromoteDialog] = useState(false)
  const [hasAdmin, setHasAdmin] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [configError, setConfigError] = useState(false)

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin': return 'text-[var(--status-urgent)] bg-[var(--status-urgent-bg)] border-[var(--status-urgent)]/30'
      case 'manager': return 'text-primary bg-primary/10 border-primary/30'
      case 'agent': return 'text-[var(--status-info)] bg-[var(--status-info-bg)] border-[var(--status-info)]/30'
      default: return 'text-muted-foreground bg-muted border-border'
    }
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin': return '👑'
      case 'manager': return '📊'
      case 'agent': return '👤'
      default: return '•'
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  useEffect(() => {
    // Check if any admin exists
    const adminExists = users.some(u => u.role === "admin" && u.isActive)
    setHasAdmin(adminExists)

    // If no users exist, default role to admin for first user
    if (users.length === 0 && newUserRole !== "admin") {
      setNewUserRole("admin")
    }

    // Find current user if currentUserId is provided
    if (currentUserId && users.length > 0) {
      const user = users.find(u => u.id === currentUserId)
      setCurrentUser(user || null)
    }
  }, [users, newUserRole, currentUserId])

  const fetchUsers = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/auth/select-user")

      // If configuration error (503)
      if (response.status === 503) {
        setConfigError(true)
        setError("Database configuration missing. Please check your environment variables.")
        setLoading(false)
        return
      }

      // If 401 (not authenticated), treat as "no users yet" instead of error
      if (response.status === 401) {
        // Redirect to welcome if not authenticated, don't show user selector
        // But if we're here, we might be in a state where we just connected Gmail
        // and need to create the first user.
        // Let's check if we have a session cookie roughly
        setUsers([])
        // Optional: redirect to welcome if this persists?
        // window.location.href = '/welcome'
        setError(null)
        setLoading(false)
        return
      }

      if (!response.ok) {
        throw new Error("Failed to fetch users")
      }
      const data = await response.json()
      setUsers(data.users || [])
      setConfigError(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users")
    } finally {
      setLoading(false)
    }
  }

  const handleSelectUser = async (userId: string) => {
    try {
      const response = await fetch("/api/auth/select-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to select user")
      }

      const data = await response.json()

      // Store in sessionStorage for this tab
      if (typeof window !== "undefined") {
        sessionStorage.setItem("current_user_id", userId)
        sessionStorage.setItem("current_user_name", data.user.name)
        sessionStorage.setItem("current_user_role", data.user.role)
      }

      onUserSelected(userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select user")
    }
  }

  const handleCreateUser = async () => {
    if (!newUserName.trim()) {
      setDialogError("Name is required")
      return
    }

    // If no users exist, force admin role
    const roleToUse = users.length === 0 ? "admin" : newUserRole

    try {
      setCreating(true)
      setDialogError(null)

      const response = await fetch("/api/auth/select-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          createNew: true,
          name: newUserName.trim(),
          email: newUserEmail.trim() || null,
          role: roleToUse,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to create user")
      }

      const data = await response.json()
      setShowCreateDialog(false)
      setNewUserName("")
      setNewUserEmail("")
      setNewUserRole(users.length === 0 ? "admin" : "agent")

      // If auto-selected (first admin), immediately redirect
      if (data.autoSelected && data.user) {
        // Store in sessionStorage for this tab
        if (typeof window !== "undefined") {
          sessionStorage.setItem("current_user_id", data.user.id)
          sessionStorage.setItem("current_user_name", data.user.name)
          sessionStorage.setItem("current_user_role", data.user.role)
        }
        onUserSelected(data.user.id)
        return
      }

      await fetchUsers()

      setError(null)
    } catch (err) {
      // Set the error on the dialog specifically
      setDialogError(err instanceof Error ? err.message : "Failed to create user")
      console.error("Create User Error:", err)
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center space-y-4">
          {/* Use Loader2 with blue color as requested */}
          <Loader2 className="h-12 w-12 animate-spin text-blue-500 mx-auto" />
          <p className="text-muted-foreground animate-pulse">Loading users...</p>
        </div>
      </div>
    )
  }

  if (configError) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-background via-muted/20 to-background p-4">
        <Card className="w-full max-w-md shadow-2xl border-[var(--status-urgent)]/50 bg-card/95">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-16 h-16 bg-[var(--status-urgent-bg)] rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-[var(--status-urgent)]" />
            </div>
            <CardTitle className="text-2xl font-bold text-[var(--status-urgent)]">Configuration Error</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              The database configuration is missing or invalid.
            </p>
            <div className="p-4 bg-muted rounded-lg text-sm font-mono text-left break-all">
              SUPABASE_URL or SERVICE_KEY missing
            </div>
            <p className="text-sm">
              Please check your deployment settings (Environment Variables) in Vercel.
            </p>
            <Button
              className="w-full mt-4"
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-gradient-to-br from-background via-muted/20 to-background p-4 overflow-auto">
      <Card className="w-full max-w-md shadow-2xl border-border/60 backdrop-blur-sm bg-card/95">
        <CardHeader className="space-y-4 pb-8 text-center">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/70 flex items-center justify-center shadow-lg ring-4 ring-primary/10">
              <User className="w-8 h-8 text-white" />
            </div>
          </div>
          <div className="space-y-2">
            <CardTitle className="text-3xl font-bold">Welcome Back!</CardTitle>
            <CardDescription className="text-base leading-relaxed">
              Select your team member account or create a new one
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="p-5 bg-[var(--status-urgent-bg)] text-[var(--status-urgent)] text-sm rounded-xl border-2 border-[var(--status-urgent)]/30 shadow-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0">⚠️</span>
                <div className="space-y-1">
                  <p className="font-bold">Error</p>
                  <p className="text-xs leading-relaxed">{error}</p>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-16 space-y-6">
              <div className="flex justify-center">
                <div className="relative">
                  <Loader2 className="h-16 w-16 animate-spin text-blue-500/80" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <User className="w-6 h-6 text-blue-500/40" />
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground font-medium animate-pulse">Loading your accounts...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-10 space-y-8">
              <div className="flex justify-center">
                <div className="w-20 h-20 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent rounded-3xl flex items-center justify-center shadow-xl border-2 border-primary/20">
                  <User className="w-10 h-10 text-primary" />
                </div>
              </div>
              <div className="space-y-3">
                <p className="text-xl font-bold text-foreground">No team members yet</p>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  Create the first user (will be Admin with full access)
                </p>
              </div>
              <Dialog open={showCreateDialog} onOpenChange={(open) => {
                setShowCreateDialog(open)
                if (!open) {
                  setDialogError(null)
                  setNewUserName("")
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="lg" className="w-full shadow-lg hover:shadow-xl transition-all h-12 text-base font-bold">
                    <User className="w-5 h-5 mr-2" />
                    Create First User (Admin)
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-3 text-xl">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                      Create First User
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                      The first user will automatically be an Admin with full access
                    </DialogDescription>
                  </DialogHeader>

                  {/* DISPLAY ERROR HERE FOR DIALOG */}
                  {dialogError && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      {dialogError}
                    </div>
                  )}

                  <div className="space-y-5 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-sm font-semibold">Name *</Label>
                      <Input
                        id="name"
                        value={newUserName}
                        onChange={(e) => setNewUserName(e.target.value)}
                        placeholder="e.g., Salman"
                        className="shadow-sm h-11"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email" className="text-sm font-semibold">Email (optional)</Label>
                      <Input
                        id="email"
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="personal@example.com"
                        className="shadow-sm h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="role" className="text-sm font-semibold">Role *</Label>
                      <Select value={newUserRole} onValueChange={(v: any) => setNewUserRole(v)}>
                        <SelectTrigger className="shadow-sm h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin" className="py-3">
                            <span className="font-medium">Admin (Required for first user)</span>
                          </SelectItem>
                          <SelectItem value="manager" disabled className="py-3">
                            <span className="font-medium">Manager (Not available for first user)</span>
                          </SelectItem>
                          <SelectItem value="agent" disabled className="py-3">
                            <span className="font-medium">Agent (Not available for first user)</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
                        <span className="text-base leading-none">💡</span>
                        <span>The first user must be Admin to manage the system.</span>
                      </p>
                    </div>
                    <Button
                      onClick={handleCreateUser}
                      disabled={creating || !newUserName.trim() || newUserRole !== "admin"}
                      className="w-full shadow-sm h-11 text-base font-semibold"
                    >
                      {creating ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Creating Admin User...
                        </>
                      ) : (
                        "Create Admin User"
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                  Select your account:
                </p>
                <div className="space-y-3">
                  {users.map((user, index) => {
                    const isSelected = currentUserId === user.id
                    return (
                      <button
                        key={user.id}
                        className={`w-full text-left group transition-all duration-200 ease-out animate-in fade-in slide-in-from-bottom-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 focus:ring-offset-background`}
                        style={{ animationDelay: `${index * 50}ms` }}
                        onClick={() => handleSelectUser(user.id)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleSelectUser(user.id)
                          }
                        }}
                      >
                        <div className={`p-5 border-2 rounded-xl transition-all duration-200 ${isSelected
                          ? "border-primary bg-gradient-to-r from-primary/15 via-primary/10 to-primary/5 shadow-lg ring-2 ring-primary/20 scale-[1.02]"
                          : "border-border/40 bg-card hover:border-primary/50 hover:bg-muted/40 hover:shadow-lg hover:scale-[1.01] active:scale-[0.99]"
                          }`}>
                          <div className="flex items-center gap-4">
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 ${isSelected
                              ? "bg-gradient-to-br from-primary to-primary/80 text-white shadow-lg scale-110"
                              : "bg-gradient-to-br from-primary/10 to-primary/5 text-primary group-hover:from-primary/20 group-hover:to-primary/10 group-hover:scale-105"
                              }`}>
                              <User className={`transition-all duration-200 ${isSelected ? 'w-6 h-6' : 'w-5 h-5'}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-bold text-base text-foreground mb-0.5">{user.name}</div>
                              {user.email && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {user.email}
                                </p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2 flex-shrink-0">
                              <span className={`text-xs font-bold px-3 py-1.5 rounded-lg capitalize border shadow-sm transition-all ${getRoleColor(user.role)
                                } ${isSelected ? 'scale-105' : ''}`}>
                                {user.role}
                              </span>
                              {isSelected && (
                                <span className="text-[10px] text-primary font-bold uppercase tracking-wide animate-pulse">
                                  ● Active
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Create new user button */}
              {(!hasAdmin || currentUser?.role === "admin") && (
                <div className="pt-2">
                  <Dialog open={showCreateDialog} onOpenChange={(open) => {
                    setShowCreateDialog(open)
                    if (!open) {
                      setDialogError(null)
                      setNewUserName("")
                    }
                  }}>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        className="w-full border-2 border-dashed hover:border-primary hover:bg-primary/5 transition-all shadow-sm hover:shadow-md h-12 text-sm font-semibold"
                      >
                        <User className="w-4 h-4 mr-2" />
                        Create New User
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-3 text-xl">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                            <User className="w-5 h-5 text-primary" />
                          </div>
                          Create New User
                        </DialogTitle>
                        <DialogDescription className="text-sm">
                          {!hasAdmin
                            ? "Add a new team member. At least one Admin is required."
                            : "Add a new team member to this account"}
                        </DialogDescription>
                      </DialogHeader>

                      {/* DISPLAY ERROR HERE FOR DIALOG */}
                      {dialogError && (
                        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4" />
                          {dialogError}
                        </div>
                      )}

                      <div className="space-y-5 pt-4">
                        <div className="space-y-2">
                          <Label htmlFor="new-name" className="text-sm font-semibold">Name *</Label>
                          <Input
                            id="new-name"
                            value={newUserName}
                            onChange={(e) => setNewUserName(e.target.value)}
                            placeholder="e.g., Ali"
                            className="shadow-sm h-11"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-email" className="text-sm font-semibold">Email (optional)</Label>
                          <Input
                            id="new-email"
                            type="email"
                            value={newUserEmail}
                            onChange={(e) => setNewUserEmail(e.target.value)}
                            placeholder="personal@example.com"
                            className="shadow-sm h-11"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-role" className="text-sm font-semibold">Role *</Label>
                          <Select value={newUserRole} onValueChange={(v: any) => setNewUserRole(v)}>
                            <SelectTrigger className="shadow-sm h-11">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin" className="py-3">
                                <span className="font-medium">Admin</span>
                              </SelectItem>
                              <SelectItem value="manager" className="py-3">
                                <span className="font-medium">Manager</span>
                              </SelectItem>
                              <SelectItem value="agent" className="py-3">
                                <span className="font-medium">Agent</span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          {!hasAdmin && (
                            <p className="text-xs text-[var(--status-medium)] mt-2 flex items-start gap-1.5">
                              <span className="text-base leading-none">⚠️</span>
                              <span>No admin exists. You must create at least one admin user.</span>
                            </p>
                          )}
                        </div>
                        <Button
                          onClick={handleCreateUser}
                          disabled={creating || !newUserName.trim()}
                          className="w-full shadow-sm h-11 text-base font-semibold"
                        >
                          {creating ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                              Creating...
                            </>
                          ) : (
                            "Create User"
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </>
          )}

          {users.length > 0 && !hasAdmin && (
            <div className="mt-4 p-5 bg-[var(--status-medium-bg)] border-2 border-[var(--status-medium)]/30 rounded-xl space-y-4 shadow-lg">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">⚠️</span>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[var(--status-medium)]">
                    No Admin User Exists
                  </p>
                  <p className="text-xs text-[var(--status-medium)]/90 leading-relaxed">
                    You need an admin to manage users and settings. Promote the first user to admin.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="default"
                onClick={() => setShowPromoteDialog(true)}
                className="w-full font-semibold border-[var(--status-medium)]/40 hover:border-[var(--status-medium)] hover:bg-[var(--status-medium)]/10"
              >
                Promote First User to Admin
              </Button>
            </div>
          )}

          {users.length > 0 && hasAdmin && currentUser && currentUser.role !== "admin" && (
            <div className="mt-4 p-5 bg-[var(--status-info-bg)] border-2 border-[var(--status-info)]/30 rounded-xl shadow-lg">
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0">ℹ️</span>
                <p className="text-xs text-[var(--status-info)] leading-relaxed">
                  You're logged in as <strong className="font-bold">{currentUser.role}</strong>. Switch to an admin user to manage team members.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <PromoteAdminDialog
        open={showPromoteDialog}
        onOpenChange={setShowPromoteDialog}
        onPromoted={() => {
          fetchUsers()
        }}
      />
    </div>
  )
}
