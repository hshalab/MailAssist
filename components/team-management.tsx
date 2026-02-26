"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { UserPlus, Mail, User, Shield, Clock, CheckCircle2, XCircle, Loader2, Users, Trash2, AlertTriangle } from "lucide-react"

interface TeamMember {
  id: string
  name: string
  email: string
  role: "admin" | "manager" | "agent"
  created_at: string
}

interface PendingInvitation {
  id: string
  email: string
  name: string
  role: string
  status: string
  expires_at: string
  created_at: string
  has_full_access?: boolean
}

interface TeamManagementViewProps {
  currentUser?: { id: string; name: string; role: string; businessId?: string | null; business_id?: string } | null
}

export default function TeamManagementView({ currentUser }: TeamManagementViewProps) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])


  const [loading, setLoading] = useState(true)
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [resendingInvite, setResendingInvite] = useState<string | null>(null)

  // Form state
  const [inviteName, setInviteName] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"agent" | "manager">("agent")
  const [inviteDepartments, setInviteDepartments] = useState<string[]>([])
  const [inviteFullAccess, setInviteFullAccess] = useState(false)

  // Departments state
  const [departments, setDepartments] = useState<any[]>([])
  const [loadingDepartments, setLoadingDepartments] = useState(false)

  // Edit departments dialog
  const [editDepartmentsDialogOpen, setEditDepartmentsDialogOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [editMemberDepartments, setEditMemberDepartments] = useState<string[]>([])
  const [editMemberFullAccess, setEditMemberFullAccess] = useState(false)
  const [savingDepartments, setSavingDepartments] = useState(false)

  // Delete member dialog
  const [deleteMemberDialogOpen, setDeleteMemberDialogOpen] = useState(false)
  const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null)
  const [deletingMember, setDeletingMember] = useState(false)

  // Edit role dialog
  const [editRoleDialogOpen, setEditRoleDialogOpen] = useState(false)
  const [memberToEditRole, setMemberToEditRole] = useState<TeamMember | null>(null)
  const [newRole, setNewRole] = useState<"admin" | "manager" | "agent">("agent")
  const [updatingRole, setUpdatingRole] = useState(false)

  // State to hold fresh user data from API
  const [freshUserData, setFreshUserData] = useState<{ businessId?: string | null; role?: string } | null>(null)

  // Use prop data immediately, then update with fresh data when available
  // This prevents content from appearing with delay
  const effectiveBusinessId = freshUserData?.businessId ?? currentUser?.businessId ?? currentUser?.business_id
  const effectiveRole = freshUserData?.role ?? currentUser?.role

  // Fetch fresh user data in background (non-blocking)
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/current-user')
        if (response.ok) {
          const data = await response.json()
          if (data.user) {
            console.log('[TeamManagement] Fetched fresh user data:', {
              id: data.user.id,
              businessId: data.user.businessId,
              role: data.user.role
            })
            setFreshUserData({
              businessId: data.user.businessId,
              role: data.user.role
            })
          }
        }
      } catch (error) {
        console.error('[TeamManagement] Error fetching current user:', error)
      }
    }

    fetchCurrentUser()
  }, []) // Run once on mount

  const canManage = effectiveRole === 'admin' || effectiveRole === 'manager'
  const isBusinessAccount = effectiveBusinessId !== null && effectiveBusinessId !== undefined && effectiveBusinessId !== ''
  const canInvite = canManage && isBusinessAccount

  // Debug logging
  useEffect(() => {
    console.log('[TeamManagement] Current user state:', {
      propBusinessId: currentUser?.businessId,
      propBusiness_id: currentUser?.business_id,
      freshBusinessId: freshUserData?.businessId,
      effectiveBusinessId,
      propRole: currentUser?.role,
      effectiveRole,
      isBusinessAccount,
      canManage,
      canInvite
    })
  }, [currentUser, freshUserData, effectiveBusinessId, effectiveRole, isBusinessAccount, canManage, canInvite])

  useEffect(() => {
    loadTeamData()
  }, [currentUser, freshUserData]) // Reload when currentUser or freshUserData changes

  // Load departments when invite dialog opens
  useEffect(() => {
    if (inviteDialogOpen && isBusinessAccount) {
      loadDepartments()
    }
  }, [inviteDialogOpen, isBusinessAccount])

  const loadTeamData = async () => {
    setLoading(true)
    try {
      // Load team members
      const membersRes = await fetch("/api/agents/list")
      if (membersRes.ok) {
        const membersData = await membersRes.json()
        setMembers(membersData.members || [])
      } else {
        // If API fails, at least show current user for personal accounts
        if (!isBusinessAccount && currentUser) {
          // Fetch user email from API if not available
          try {
            const userRes = await fetch(`/api/users/${currentUser.id}`)
            if (userRes.ok) {
              const userData = await userRes.json()
              setMembers([{
                id: currentUser.id,
                name: currentUser.name,
                email: userData.user?.email || '',
                role: currentUser.role as "admin" | "manager" | "agent",
                created_at: userData.user?.created_at || new Date().toISOString()
              }])
            } else {
              // Fallback without email
              setMembers([{
                id: currentUser.id,
                name: currentUser.name,
                email: '',
                role: currentUser.role as "admin" | "manager" | "agent",
                created_at: new Date().toISOString()
              }])
            }
          } catch {
            // Fallback without email
            setMembers([{
              id: currentUser.id,
              name: currentUser.name,
              email: '',
              role: currentUser.role as "admin" | "manager" | "agent",
              created_at: new Date().toISOString()
            }])
          }
        }
      }

      // Load pending invitations (only for business accounts)
      if (isBusinessAccount) {
        const invitationsRes = await fetch("/api/agents/invitations")
        if (invitationsRes.ok) {
          const invitationsData = await invitationsRes.json()
          setInvitations(invitationsData.invitations || [])
        }
      } else {
        // Personal accounts don't have invitations
        setInvitations([])
      }

      // Load departments (only for business accounts)
      // Use effectiveBusinessId to check if it's a business account
      const effectiveBusinessId = freshUserData?.businessId ?? currentUser?.businessId ?? currentUser?.business_id
      if (effectiveBusinessId !== null && effectiveBusinessId !== undefined && effectiveBusinessId !== '') {
        await loadDepartments()
      } else {
        setDepartments([])
        setLoadingDepartments(false)
      }
    } catch (err) {
      console.error("Error loading team data:", err)
      // Fallback: show current user for personal accounts even on error
      if (!isBusinessAccount && currentUser) {
        // Try to fetch user email
        try {
          const userRes = await fetch(`/api/users/${currentUser.id}`)
          if (userRes.ok) {
            const userData = await userRes.json()
            setMembers([{
              id: currentUser.id,
              name: currentUser.name,
              email: userData.user?.email || '',
              role: currentUser.role as "admin" | "manager" | "agent",
              created_at: userData.user?.created_at || new Date().toISOString()
            }])
          } else {
            setMembers([{
              id: currentUser.id,
              name: currentUser.name,
              email: '',
              role: currentUser.role as "admin" | "manager" | "agent",
              created_at: new Date().toISOString()
            }])
          }
        } catch {
          setMembers([{
            id: currentUser.id,
            name: currentUser.name,
            email: '',
            role: currentUser.role as "admin" | "manager" | "agent",
            created_at: new Date().toISOString()
          }])
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const loadDepartments = async () => {
    setLoadingDepartments(true)
    try {
      const response = await fetch("/api/departments")
      if (response.ok) {
        const data = await response.json()
        setDepartments(data.departments || [])
      }
    } catch (err) {
      console.error("Error loading departments:", err)
    } finally {
      setLoadingDepartments(false)
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setInviteLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch("/api/agents/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: inviteName,
          email: inviteEmail,
          role: inviteRole,
          departmentIds: inviteFullAccess ? [] : inviteDepartments, // Clear departments if full access
          hasFullAccess: inviteFullAccess,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || "Failed to send invitation")
        setInviteLoading(false)
        return
      }

      setSuccess(`Invitation sent to ${inviteEmail}`)
      setInviteDialogOpen(false)
      setInviteName("")
      setInviteEmail("")
      setInviteRole("agent")
      setInviteDepartments([])
      setInviteFullAccess(false)

      // Reload data to show new invitation
      await loadTeamData()
    } catch (err) {
      setError("An unexpected error occurred")
    } finally {
      setInviteLoading(false)
    }
  }

  const handleEditDepartments = async (member: TeamMember) => {
    setEditingMember(member)
    setEditMemberFullAccess((member as any).has_full_access || false)
    setEditDepartmentsDialogOpen(true)

    // Fetch member's current departments
    try {
      const response = await fetch(`/api/agents/${member.id}/departments`)
      if (response.ok) {
        const data = await response.json()
        const deptIds = data.departments?.map((d: any) => d.id) || []
        setEditMemberDepartments(deptIds)
      }
    } catch (err) {
      console.error("Error fetching member departments:", err)
    }
  }

  const handleSaveDepartments = async () => {
    if (!editingMember) return

    setSavingDepartments(true)
    setError(null)

    try {
      const response = await fetch(`/api/agents/${editingMember.id}/departments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentIds: editMemberDepartments,
          hasFullAccess: editMemberFullAccess
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || "Failed to update departments")
        return
      }

      setSuccess(`Updated departments for ${editingMember.name}`)
      setEditDepartmentsDialogOpen(false)
      setEditingMember(null)
      setEditMemberDepartments([])
    } catch (err) {
      setError("An unexpected error occurred")
    } finally {
      setSavingDepartments(false)
    }
  }

  const handleRemoveMember = async (member: TeamMember) => {
    setMemberToDelete(member)
    setDeleteMemberDialogOpen(true)
  }

  const confirmRemoveMember = async () => {
    if (!memberToDelete) return

    setDeletingMember(true)
    setError(null)

    try {
      const response = await fetch(`/api/users/${memberToDelete.id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || "Failed to remove team member")
        return
      }

      setSuccess(`Successfully removed ${memberToDelete.name} from the team`)
      setDeleteMemberDialogOpen(false)
      setMemberToDelete(null)

      // Reload team data to reflect the changes
      await loadTeamData()
    } catch (err) {
      setError("An unexpected error occurred")
      console.error("Error removing team member:", err)
    } finally {
      setDeletingMember(false)
    }
  }

  const handleEditRole = async (member: TeamMember) => {
    setMemberToEditRole(member)
    setNewRole(member.role)
    setEditRoleDialogOpen(true)
  }

  const confirmRoleChange = async () => {
    if (!memberToEditRole) return

    setUpdatingRole(true)
    setError(null)

    try {
      const response = await fetch(`/api/users/${memberToEditRole.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      })

      if (!response.ok) {
        const data = await response.json()
        setError(data.error || "Failed to update user role")
        return
      }

      setSuccess(`Successfully updated ${memberToEditRole.name}'s role to ${newRole}`)
      setEditRoleDialogOpen(false)
      setMemberToEditRole(null)

      // Reload team data to reflect the changes
      await loadTeamData()
    } catch (err) {
      setError("An unexpected error occurred")
      console.error("Error updating user role:", err)
    } finally {
      setUpdatingRole(false)
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin":
        return "bg-purple-950 text-purple-300 border-purple-800"
      case "manager":
        return "bg-blue-950 text-blue-300 border-blue-800"
      case "agent":
        return "bg-slate-700 text-slate-300 border-slate-600"
      default:
        return "bg-slate-700 text-slate-300 border-slate-600"
    }
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-950 text-yellow-300 border-yellow-800"
      case "accepted":
        return "bg-green-950 text-green-300 border-green-800"
      case "expired":
        return "bg-red-950 text-red-300 border-red-800"
      default:
        return "bg-slate-700 text-slate-300 border-slate-600"
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  }

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date()
  }

  return (
    <div className="flex-1 space-y-8 p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header Section with Glassmorphism */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider">
            Workspace
          </div>
          <h2 className="text-4xl font-extrabold tracking-tight bg-gradient-to-br from-white via-white to-slate-400 bg-clip-text text-transparent">
            Team Management
          </h2>
          <p className="text-slate-400 max-w-md text-lg leading-relaxed">
            Organize your workspace, manage permissions, and collaborate with your team.
          </p>
        </div>

        {canInvite ? (
          <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="h-12 px-8 bg-primary hover:bg-primary/90 text-white shadow-2xl shadow-primary/20 transition-all hover:scale-[1.03] active:scale-95 font-bold rounded-2xl group border-0">
                <UserPlus className="mr-2 h-5 w-5 transition-transform" />
                Invite Member
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-2xl sm:max-w-md rounded-3xl">
              <form onSubmit={handleInvite} className="space-y-6">
                <DialogHeader>
                  <DialogTitle className="text-2xl font-bold text-white">Invite Team Member</DialogTitle>
                  <DialogDescription className="text-slate-400 text-base">
                    Send a secure invitation to your team.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-5 py-2">
                  <div className="space-y-2.5">
                    <Label htmlFor="name" className="text-slate-300 ml-1">Full Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <Input
                        id="name"
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="Jane Cooper"
                        className="pl-10 bg-slate-800/50 border-slate-700 focus:border-primary text-white h-11 rounded-xl transition-all"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="email" className="text-slate-300 ml-1">Work Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                      <Input
                        id="email"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="jane@company.com"
                        className="pl-10 bg-slate-800/50 border-slate-700 focus:border-primary text-white h-11 rounded-xl transition-all"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="role" className="text-slate-300 ml-1">Account Role</Label>
                    <Select value={inviteRole} onValueChange={(value: any) => setInviteRole(value)}>
                      <SelectTrigger className="bg-slate-800/50 border-slate-700 focus:border-primary text-white h-11 rounded-xl transition-all">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-900 border-slate-800 rounded-xl">
                        <SelectItem value="agent">Agent (Standard access)</SelectItem>
                        <SelectItem value="manager">Manager (Can invite others)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center space-x-3 p-3 bg-slate-800/50 border border-slate-700 rounded-xl">
                      <Checkbox
                        id="invite-full-access"
                        checked={inviteFullAccess}
                        onCheckedChange={(checked) => {
                          setInviteFullAccess(!!checked)
                          if (checked) {
                            setInviteDepartments([]) // Clear departments when full access is enabled
                          }
                        }}
                      />
                      <div className="flex-1">
                        <Label htmlFor="invite-full-access" className="text-slate-200 font-medium cursor-pointer">
                          Full Email Access
                        </Label>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Grant access to all emails and workstreams
                        </p>
                      </div>
                    </div>

                    {!inviteFullAccess && (
                      <div className="space-y-2.5">
                        <Label className="text-slate-300 ml-1">Workstreams (Optional)</Label>
                        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3 max-h-48 overflow-y-auto">
                          {loadingDepartments ? (
                            <div className="text-sm text-slate-400 text-center py-2">Loading workstreams...</div>
                          ) : departments.length === 0 ? (
                            <div className="text-sm text-slate-400 text-center py-2">No workstreams available</div>
                          ) : (
                            <div className="space-y-2">
                              {departments.map((dept) => (
                                <div key={dept.id} className="flex items-center space-x-2 p-2 hover:bg-slate-700/50 rounded-lg transition-colors">
                                  <Checkbox
                                    id={`dept-${dept.id}`}
                                    checked={inviteDepartments.includes(dept.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setInviteDepartments([...inviteDepartments, dept.id])
                                      } else {
                                        setInviteDepartments(inviteDepartments.filter(id => id !== dept.id))
                                      }
                                    }}
                                  />
                                  <label
                                    htmlFor={`dept-${dept.id}`}
                                    className="text-sm text-slate-300 cursor-pointer flex-1"
                                  >
                                    {dept.name}
                                  </label>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 ml-1">Select workstreams this member can access</p>
                      </div>
                    )}
                  </div>
                  {error && (
                    <Alert className="bg-red-500/10 border-red-500/20 rounded-xl">
                      <XCircle className="h-4 w-4 text-red-400" />
                      <AlertDescription className="text-red-300 ml-2">{error}</AlertDescription>
                    </Alert>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setInviteDialogOpen(false)}
                    className="text-slate-400 hover:text-white hover:bg-white/5 rounded-xl px-6"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={inviteLoading}
                    className="bg-primary hover:bg-primary/90 rounded-xl px-8 h-11 font-bold shadow-lg shadow-primary/20"
                  >
                    {inviteLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Send Invitation"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : (
          <div className="px-6 py-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl max-w-md">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                <UserPlus className="h-5 w-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-white mb-1">Team Invitations</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Team member invitations are only available for business accounts. Upgrade to a business plan to invite team members and collaborate with your team.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {success && (
        <Alert className="bg-green-500/10 border-green-500/20 text-green-400 animate-in slide-in-from-top-4 duration-500 rounded-2xl p-4">
          <CheckCircle2 className="h-5 w-5" />
          <AlertDescription className="ml-3 font-medium">{success}</AlertDescription>
        </Alert>
      )}

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 items-start">

        {/* Active Members - Left 2 Columns */}
        <div className="xl:col-span-2 space-y-6">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <h3 className="text-xl font-bold text-white">Active Members</h3>
              <Badge variant="outline" className="bg-white/5 border-white/10 text-slate-400 rounded-full font-mono px-3">
                {members.length}
              </Badge>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-[140px] bg-slate-900/40 border border-slate-800/50 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <Card className="bg-slate-900/40 border-slate-800/50 border-dashed rounded-3xl p-10 text-center flex flex-col items-center justify-center min-h-[320px]">
              <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mb-5">
                <Users className="h-8 w-8 text-slate-600" />
              </div>
              <h4 className="text-xl font-semibold text-white mb-2">Build your team</h4>
              <p className="text-slate-400 max-w-xs mx-auto">
                {isBusinessAccount
                  ? "Invite colleagues to help you manage your support emails more effectively."
                  : "Team member invitations are only available for business accounts. Upgrade to a business plan to invite team members."}
              </p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {members.map((member, index) => (
                <div
                  key={member.id}
                  className="group relative"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <Card className="bg-slate-900/40 border-slate-800/60 hover:bg-slate-800/60 hover:border-slate-700/80 backdrop-blur-sm rounded-2xl p-5 transition-all duration-200 h-full flex flex-col justify-between">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl flex items-center justify-center border border-slate-700/50 relative overflow-hidden flex-shrink-0">
                          <User className="h-5 w-5 text-slate-400 group-hover:text-slate-100 transition-colors" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-white group-hover:text-slate-100 transition-colors truncate pr-2">{member.name}</h4>
                          <p className="text-slate-400 text-xs font-medium truncate">{member.email}</p>
                        </div>
                      </div>
                      <Badge className={`rounded-lg px-2 py-0.5 border font-semibold text-[10px] uppercase tracking-wider flex-shrink-0 ${getRoleBadgeColor(member.role)}`}>
                        {member.role}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-800/50">
                      <div className="flex items-center text-[10px] text-slate-500 font-mono">
                        <Clock className="w-3 h-3 mr-1.5" />
                        {formatDate(member.created_at)}
                      </div>
                      {canManage && isBusinessAccount && member.id !== currentUser?.id && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                            onClick={() => handleEditDepartments(member)}
                          >
                            Edit Access
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs rounded-lg text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            onClick={() => handleEditRole(member)}
                          >
                            <Shield className="w-3 h-3 mr-1" />
                            Role
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => handleRemoveMember(member)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Invites - Right Column */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <h3 className="text-xl font-bold text-white">Pending Invitations</h3>
            {invitations.length > 0 && (
              <Badge className="bg-yellow-500/10 border-yellow-500/20 text-yellow-500 rounded-full font-mono text-xs px-2">
                {invitations.length}
              </Badge>
            )}
          </div>

          <Card className="bg-slate-900/40 border-slate-800/60 backdrop-blur-xl rounded-2xl overflow-hidden min-h-[200px] flex flex-col">
            <div className="p-2 space-y-1 flex-grow flex flex-col overflow-y-auto custom-scrollbar max-h-[400px]">
              {invitations.length === 0 ? (
                <div className="flex-grow flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <div className="w-12 h-12 bg-slate-800/30 rounded-full flex items-center justify-center mx-auto opacity-50">
                    <Mail className="h-6 w-6 text-slate-500" />
                  </div>
                  <p className="text-slate-500 text-sm font-medium">No pending invites</p>
                </div>
              ) : (
                invitations.map((invitation, index) => {
                  const expired = isExpired(invitation.expires_at)
                  return (
                    <div
                      key={invitation.id}
                      className="group relative p-3 rounded-xl hover:bg-white/5 transition-all border border-transparent hover:border-white/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${expired ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'}`}>
                            {expired ? <XCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0">
                            <h5 className="text-sm font-bold text-white truncate">{invitation.name}</h5>
                            <p className="text-[11px] text-slate-500 font-medium truncate">{invitation.email}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <Badge className={`text-[9px] px-1.5 py-0 border-0 rounded-md ${getStatusBadgeColor(expired ? "expired" : invitation.status)}`}>
                            {expired ? "Expired" : "Pending"}
                          </Badge>
                          <span className="text-[10px] text-slate-600 font-mono">
                            {expired ? "Closed" : "12h left"}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Card>

          {/* Tips/Info Card */}
          <div className="p-5 bg-blue-500/5 border border-blue-500/10 rounded-2xl space-y-2">
            <div className="flex items-center gap-2 text-blue-400">
              <Shield className="h-3.5 w-3.5" />
              <span className="text-xs font-bold uppercase tracking-widest">Access Control</span>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">
              Role permissions are scoped to specific modules. Only Managers and Admins can invite new members.
            </p>
          </div>
        </div>
      </div>

      {/* Edit Departments Dialog */}
      <Dialog open={editDepartmentsDialogOpen} onOpenChange={setEditDepartmentsDialogOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-white">Edit Workstreams</DialogTitle>
            <DialogDescription className="text-slate-400 text-base">
              {editingMember ? `Manage workstream access for ${editingMember.name}` : "Manage workstream access"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3 max-h-64 overflow-y-auto">
              {loadingDepartments ? (
                <div className="text-sm text-slate-400 text-center py-2">Loading workstreams...</div>
              ) : departments.length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-2">No workstreams available</div>
              ) : (
                <div className="space-y-2">
                  {departments.map((dept) => (
                    <div key={dept.id} className="flex items-center space-x-2 p-2 hover:bg-slate-700/50 rounded-lg transition-colors">
                      <Checkbox
                        id={`edit-dept-${dept.id}`}
                        checked={editMemberDepartments.includes(dept.id)}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setEditMemberDepartments([...editMemberDepartments, dept.id])
                          } else {
                            setEditMemberDepartments(editMemberDepartments.filter(id => id !== dept.id))
                          }
                        }}
                      />
                      <label
                        htmlFor={`edit-dept-${dept.id}`}
                        className="text-sm text-slate-300 cursor-pointer flex-1"
                      >
                        {dept.name}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2 bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
              <Switch
                id="full-access"
                checked={editMemberFullAccess}
                onCheckedChange={setEditMemberFullAccess}
                className="data-[state=checked]:bg-green-500"
              />
              <div className="flex flex-col">
                <Label htmlFor="full-access" className="text-slate-200 font-medium cursor-pointer">Full Email Access</Label>
                <span className="text-[10px] text-slate-400">Allow user to view ALL tickets, regardless of assignment.</span>
              </div>
            </div>

            <p className="text-xs text-slate-500">Select workstreams this member can access</p>
            {error && (
              <Alert className="bg-red-500/10 border-red-500/20 rounded-xl">
                <XCircle className="h-4 w-4 text-red-400" />
                <AlertDescription className="text-red-300 ml-2">{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setEditDepartmentsDialogOpen(false)}
              className="text-slate-400 hover:text-white hover:bg-white/5 rounded-xl px-6"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={savingDepartments}
              onClick={handleSaveDepartments}
              className="bg-primary hover:bg-primary/90 rounded-xl px-8 h-11 font-bold shadow-lg shadow-primary/20"
            >
              {savingDepartments ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Member Confirmation Dialog */}
      <Dialog open={deleteMemberDialogOpen} onOpenChange={setDeleteMemberDialogOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 rounded-2xl max-w-md">
          <DialogHeader className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <div className="flex-1 pt-1">
                <DialogTitle className="text-xl font-semibold text-white mb-2">Remove Team Member</DialogTitle>
                <DialogDescription className="text-sm text-slate-400">
                  Are you sure you want to remove <span className="font-semibold text-white">{memberToDelete?.name}</span> from the team?
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <Alert className="mt-4 bg-amber-500/10 border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-sm text-amber-400 ml-2">
              This action will deactivate the user account. They will no longer have access to the team workspace.
            </AlertDescription>
          </Alert>
          {error && (
            <Alert className="mt-4 bg-red-500/10 border-red-500/20">
              <XCircle className="h-4 w-4 text-red-400" />
              <AlertDescription className="text-sm text-red-300 ml-2">{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteMemberDialogOpen(false)}
              disabled={deletingMember}
              className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 border-slate-700 text-white rounded-xl"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRemoveMember}
              disabled={deletingMember}
              className="w-full sm:w-auto bg-destructive hover:bg-destructive/90 rounded-xl"
            >
              {deletingMember ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove Member
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={editRoleDialogOpen} onOpenChange={setEditRoleDialogOpen}>
        <DialogContent className="bg-slate-950 border-slate-800 rounded-2xl max-w-md">
          <DialogHeader className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                <Shield className="h-6 w-6 text-blue-400" />
              </div>
              <div className="flex-1 pt-1">
                <DialogTitle className="text-xl font-semibold text-white mb-2">Change User Role</DialogTitle>
                <DialogDescription className="text-sm text-slate-400">
                  Update the role for <span className="font-semibold text-white">{memberToEditRole?.name}</span>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-3">
              <Label htmlFor="role-select" className="text-slate-300 ml-1">Select New Role</Label>
              <Select value={newRole} onValueChange={(value: any) => setNewRole(value)}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700 focus:border-primary text-white h-11 rounded-xl transition-all">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 rounded-xl text-slate-100">
                  <SelectItem value="admin" className="group rounded-lg py-2 data-[highlighted]:bg-primary data-[highlighted]:text-white">
                    <div className="flex items-center gap-2.5">
                      <Shield className="h-4 w-4 text-purple-400 group-data-[highlighted]:text-white" />
                      <div className="leading-tight">
                        <div className="font-semibold text-slate-100 group-data-[highlighted]:text-white">Admin</div>
                        <div className="text-xs text-slate-300 group-data-[highlighted]:text-white/90">Full system access</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="manager" className="group rounded-lg py-2 data-[highlighted]:bg-primary data-[highlighted]:text-white">
                    <div className="flex items-center gap-2.5">
                      <Shield className="h-4 w-4 text-blue-400 group-data-[highlighted]:text-white" />
                      <div className="leading-tight">
                        <div className="font-semibold text-slate-100 group-data-[highlighted]:text-white">Manager</div>
                        <div className="text-xs text-slate-300 group-data-[highlighted]:text-white/90">Can invite and manage team</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="agent" className="group rounded-lg py-2 data-[highlighted]:bg-primary data-[highlighted]:text-white">
                    <div className="flex items-center gap-2.5">
                      <User className="h-4 w-4 text-green-400 group-data-[highlighted]:text-white" />
                      <div className="leading-tight">
                        <div className="font-semibold text-slate-100 group-data-[highlighted]:text-white">Agent</div>
                        <div className="text-xs text-slate-300 group-data-[highlighted]:text-white/90">Standard access</div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Role descriptions */}
            <Alert className="bg-blue-500/5 border-blue-500/10">
              <Shield className="h-4 w-4 text-blue-400" />
              <AlertDescription className="text-sm text-slate-300 ml-2">
                {effectiveRole === 'manager' && (
                  <span className="text-amber-400 font-medium">Note: As a manager, you cannot promote users to admin role.</span>
                )}
                {effectiveRole === 'admin' && (
                  <span>Admins have full control. Managers can invite members and manage tickets. Agents have standard access.</span>
                )}
              </AlertDescription>
            </Alert>

            {error && (
              <Alert className="bg-red-500/10 border-red-500/20">
                <XCircle className="h-4 w-4 text-red-400" />
                <AlertDescription className="text-sm text-red-300 ml-2">{error}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-end sm:gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setEditRoleDialogOpen(false)
                setError(null)
              }}
              disabled={updatingRole}
              className="w-full sm:w-auto bg-slate-800 hover:bg-slate-700 border-slate-700 text-white rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={confirmRoleChange}
              disabled={updatingRole || newRole === memberToEditRole?.role}
              className="w-full sm:w-auto bg-primary hover:bg-primary/90 rounded-xl"
            >
              {updatingRole ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  Update Role
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
