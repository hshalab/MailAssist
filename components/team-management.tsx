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
import { UserPlus, Mail, User, Shield, Clock, CheckCircle2, XCircle, Loader2, Users } from "lucide-react"

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
  currentUser?: { id: string; name: string; role: string; business_id?: string } | null
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

  // Departments state
  const [departments, setDepartments] = useState<any[]>([])
  const [loadingDepartments, setLoadingDepartments] = useState(false)

  // Edit departments dialog
  const [editDepartmentsDialogOpen, setEditDepartmentsDialogOpen] = useState(false)
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [editMemberDepartments, setEditMemberDepartments] = useState<string[]>([])
  const [editMemberFullAccess, setEditMemberFullAccess] = useState(false)
  const [savingDepartments, setSavingDepartments] = useState(false)

  // Only Admins/Managers of BUSINESS accounts can invite users
  const canManage = (currentUser?.role === 'admin' || currentUser?.role === 'manager') && !!currentUser?.business_id

  useEffect(() => {
    loadTeamData()
  }, [])

  const loadTeamData = async () => {
    setLoading(true)
    try {
      // Load team members
      const membersRes = await fetch("/api/agents/list")
      if (membersRes.ok) {
        const membersData = await membersRes.json()
        setMembers(membersData.members || [])
      }

      // Load pending invitations
      const invitationsRes = await fetch("/api/agents/invitations")
      if (invitationsRes.ok) {
        const invitationsData = await invitationsRes.json()
        setInvitations(invitationsData.invitations || [])
      }

      // Load departments
      await loadDepartments()
    } catch (err) {
      console.error("Error loading team data:", err)
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
          departmentIds: inviteDepartments,
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

        {!currentUser?.business_id && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 max-w-md">
            <h4 className="text-amber-400 font-bold flex items-center gap-2 mb-1">
              <Shield className="h-4 w-4" />
              Personal Account
            </h4>
            <p className="text-amber-200/70 text-sm">
              You are currently using a personal account. Team management and member invitations are available for Business accounts only.
            </p>
          </div>
        )}

        {canManage && (
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
                Invite colleagues to help you manage your support emails more effectively.
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
                          <User className="h-5 w-5 text-slate-400 group-hover:text-primary transition-colors" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-white group-hover:text-primary transition-colors truncate pr-2">{member.name}</h4>
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
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                          onClick={() => handleEditDepartments(member)}
                        >
                          Edit Access
                        </Button>
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
              Role permissions are scoped to specific modules. Only Managers and Admins can invite net members.
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
    </div>
  )
}
