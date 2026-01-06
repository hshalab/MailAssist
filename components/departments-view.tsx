"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
    Plus,
    Building2,
    Users,
    Edit,
    Trash2,
    CheckCircle2,
    XCircle,
    Loader2,
    User,
    Tag,
    Sparkles,
} from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface Department {
    id: string
    name: string
    description: string
    userCount?: number
    createdAt: string
    updatedAt: string
}

interface User {
    userId: string
    name: string
    email: string
    role: string
}

interface DepartmentsViewProps {
    currentUser?: { id: string; name: string; role: string; business_id?: string } | null
}

export default function DepartmentsView({ currentUser }: DepartmentsViewProps) {
    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)

    const canManage = currentUser?.role === 'admin' || currentUser?.role === 'manager'
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [assignDialogOpen, setAssignDialogOpen] = useState(false)
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [selectedDepartment, setSelectedDepartment] = useState<Department | null>(null)
    const [departmentUsers, setDepartmentUsers] = useState<User[]>([])
    const [actionLoading, setActionLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [backfilling, setBackfilling] = useState(false)
    const { toast } = useToast()

    // Form state
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")

    useEffect(() => {
        loadDepartments()
    }, [])

    const loadDepartments = async () => {
        setLoading(true)
        try {
            const response = await fetch("/api/departments")
            if (response.ok) {
                const data = await response.json()
                setDepartments(data.departments || [])
            }
        } catch (err) {
            console.error("Error loading departments:", err)
        } finally {
            setLoading(false)
        }
    }

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        setActionLoading(true)
        setError(null)

        try {
            const response = await fetch("/api/departments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, description }),
            })

            const data = await response.json()

            if (!response.ok) {
                setError(data.error || "Failed to create department")
                setActionLoading(false)
                return
            }

            setSuccess(`Department "${name}" created successfully`)
            setCreateDialogOpen(false)
            setName("")
            setDescription("")
            await loadDepartments()
        } catch (err) {
            setError("An unexpected error occurred")
        } finally {
            setActionLoading(false)
        }
    }

    const handleEdit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedDepartment) return

        setActionLoading(true)
        setError(null)

        try {
            const response = await fetch(`/api/departments/${selectedDepartment.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, description }),
            })

            const data = await response.json()

            if (!response.ok) {
                setError(data.error || "Failed to update department")
                setActionLoading(false)
                return
            }

            setSuccess(`Department updated successfully`)
            setEditDialogOpen(false)
            setSelectedDepartment(null)
            await loadDepartments()
        } catch (err) {
            setError("An unexpected error occurred")
        } finally {
            setActionLoading(false)
        }
    }

    const handleDelete = async () => {
        if (!selectedDepartment) return

        setActionLoading(true)
        setError(null)

        try {
            const response = await fetch(`/api/departments/${selectedDepartment.id}`, {
                method: "DELETE",
            })

            const data = await response.json()

            if (!response.ok) {
                setError(data.error || "Failed to delete department")
                setActionLoading(false)
                return
            }

            setSuccess(`Department deleted successfully`)
            setDeleteDialogOpen(false)
            setSelectedDepartment(null)
            await loadDepartments()
        } catch (err) {
            setError("An unexpected error occurred")
        } finally {
            setActionLoading(false)
        }
    }

    const handleSmartBackfill = async () => {
        setBackfilling(true)
        try {
            const response = await fetch('/api/departments/backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days: 30, limit: 20 })
            })

            const data = await response.json()

            if (!response.ok) throw new Error(data.error || 'Backfill failed')

            toast({
                title: "Smart Backfill Complete",
                description: data.message || `Processed ${data.processed} tickets`,
                variant: "default"
            })

            // Reload departments to update counts if we want, 
            // though backfill updates tickets, not department definitions directly (except counts).
            // We can reload departments to show updated user counts?
            loadDepartments()

        } catch (error) {
            console.error('Backfill error:', error)
            toast({
                title: "Backfill Failed",
                description: "Could not auto-classify tickets.",
                variant: "destructive"
            })
        } finally {
            setBackfilling(false)
        }
    }

    const openEditDialog = (dept: Department) => {
        setSelectedDepartment(dept)
        setName(dept.name)
        setDescription(dept.description)
        setEditDialogOpen(true)
    }

    const openAssignDialog = async (dept: Department) => {
        setSelectedDepartment(dept)
        // Load users for this department
        try {
            const response = await fetch(`/api/departments/${dept.id}/users`)
            if (response.ok) {
                const data = await response.json()
                setDepartmentUsers(data.users || [])
            }
        } catch (err) {
            console.error("Error loading department users:", err)
        }
        setAssignDialogOpen(true)
    }

    const openDeleteDialog = (dept: Department) => {
        setSelectedDepartment(dept)
        setDeleteDialogOpen(true)
    }

    return (
        <div className="flex-1 space-y-8 p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider">
                        Organization
                    </div>
                    <h2 className="text-4xl font-extrabold tracking-tight bg-gradient-to-br from-white via-white to-slate-400 bg-clip-text text-transparent">
                        Workstreams
                    </h2>
                    <p className="text-slate-400 max-w-md text-lg leading-relaxed">
                        Create smart labels with descriptions. AI automatically classifies incoming emails to the right workstream.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    {canManage && (
                        <Button
                            variant="outline"
                            size="lg"
                            className="h-12 px-6 border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300 hover:text-white rounded-2xl transition-all"
                            onClick={handleSmartBackfill}
                            disabled={backfilling}
                        >
                            {backfilling ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Sparkles className="mr-2 h-4 w-4" />
                            )}
                            Auto-Classify
                        </Button>
                    )}

                    {canManage && (
                        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                            <DialogTrigger asChild>
                                <Button size="lg" className="h-12 px-8 bg-primary hover:bg-primary/90 text-white shadow-2xl shadow-primary/20 transition-all hover:scale-[1.03] active:scale-95 font-bold rounded-2xl group border-0">
                                    <Plus className="mr-2 h-5 w-5 transition-transform" />
                                    Create Workstream
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-2xl sm:max-w-md rounded-3xl">
                                <form onSubmit={handleCreate} className="space-y-6">
                                    <DialogHeader>
                                        <DialogTitle className="text-2xl font-bold text-white">Create Workstream</DialogTitle>
                                        <DialogDescription className="text-slate-400 text-base">
                                            Add a new workstream with a clear description for AI classification.
                                        </DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-5 py-2">
                                        <div className="space-y-2.5">
                                            <Label htmlFor="name" className="text-slate-300 ml-1">Workstream Name</Label>
                                            <div className="relative">
                                                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                                                <Input
                                                    id="name"
                                                    value={name}
                                                    onChange={(e) => setName(e.target.value)}
                                                    placeholder="e.g., Sales, Support, Billing"
                                                    className="pl-10 bg-slate-800/50 border-slate-700 focus:border-primary text-white h-11 rounded-xl transition-all"
                                                    required
                                                    maxLength={100}
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-2.5">
                                            <Label htmlFor="description" className="text-slate-300 ml-1">Description</Label>
                                            <Textarea
                                                id="description"
                                                value={description}
                                                onChange={(e) => setDescription(e.target.value)}
                                                placeholder="Describe what this workstream handles. Be specific to help AI classify emails correctly. E.g., 'Questions about pricing, quotes, product purchases, and payment methods.'"
                                                className="bg-slate-800/50 border-slate-700 focus:border-primary text-white min-h-[120px] rounded-xl transition-all resize-none"
                                                required
                                                minLength={10}
                                            />
                                            <p className="text-xs text-slate-500 ml-1">
                                                Minimum 10 characters for effective AI classification
                                            </p>
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
                                            onClick={() => setCreateDialogOpen(false)}
                                            className="text-slate-400 hover:text-white hover:bg-white/5 rounded-xl px-6"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="submit"
                                            disabled={actionLoading}
                                            className="bg-primary hover:bg-primary/90 rounded-xl px-8 h-11 font-bold shadow-lg shadow-primary/20"
                                        >
                                            {actionLoading ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                "Create Workstream"
                                            )}
                                        </Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            </div>

            {success && (
                <Alert className="bg-green-500/10 border-green-500/20 text-green-400 animate-in slide-in-from-top-4 duration-500 rounded-2xl p-4">
                    <CheckCircle2 className="h-5 w-5" />
                    <AlertDescription className="ml-3 font-medium">{success}</AlertDescription>
                </Alert>
            )}

            {/* Departments Grid */}
            <div className="space-y-6">
                <div className="flex items-center gap-2 px-1">
                    <h3 className="text-xl font-bold text-white">All Workstreams</h3>
                    <Badge variant="outline" className="bg-white/5 border-white/10 text-slate-400 rounded-full font-mono">
                        {departments.length}
                    </Badge>
                </div>

                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="h-56 bg-slate-900/40 border border-slate-800/50 rounded-3xl animate-pulse" />
                        ))}
                    </div>
                ) : departments.length === 0 ? (
                    <Card className="bg-slate-900/40 border-slate-800/50 border-dashed rounded-3xl p-10 text-center flex flex-col items-center justify-center min-h-[320px]">
                        <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mb-5">
                            <Building2 className="h-8 w-8 text-slate-600" />
                        </div>
                        <h4 className="text-xl font-semibold text-white mb-2">No workstreams yet</h4>
                        <p className="text-slate-400 max-w-xs mx-auto mb-6">
                            Create your first workstream to start auto-classifying incoming emails.
                        </p>
                        {canManage && (
                            <Button onClick={() => setCreateDialogOpen(true)} className="bg-primary hover:bg-primary/90 rounded-xl px-6">
                                <Plus className="mr-2 h-4 w-4" />
                                Create First Workstream
                            </Button>
                        )}
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {departments.map((dept, index) => (
                            <div
                                key={dept.id}
                                className="group relative"
                                style={{ animationDelay: `${index * 100}ms` }}
                            >
                                <Card className="bg-slate-900/60 border-slate-800/80 backdrop-blur-sm rounded-3xl p-6 transition-all duration-300 hover:border-primary/40 hover:shadow-2xl hover:shadow-primary/5 h-full flex flex-col">
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 bg-gradient-to-br from-primary/20 to-primary/5 rounded-2xl flex items-center justify-center border border-primary/20">
                                                <Building2 className="h-6 w-6 text-primary" />
                                            </div>
                                            <div>
                                                <h4 className="text-lg font-bold text-white group-hover:text-primary transition-colors">{dept.name}</h4>
                                                <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                                                    <Users className="h-3 w-3" />
                                                    <span>{dept.userCount || 0} {dept.userCount === 1 ? 'user' : 'users'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <p className="text-slate-400 text-sm leading-relaxed flex-grow mb-4">
                                        {dept.description}
                                    </p>

                                    <div className="flex items-center gap-2 pt-4 border-t border-slate-800/50">
                                        {canManage ? (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openAssignDialog(dept)}
                                                    className="flex-1 h-9 rounded-lg text-slate-400 hover:text-primary hover:bg-primary/10 transition-all"
                                                >
                                                    <Users className="h-4 w-4 mr-1.5" />
                                                    Assign
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openEditDialog(dept)}
                                                    className="h-9 px-3 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-400/5"
                                                >
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openDeleteDialog(dept)}
                                                    className="h-9 px-3 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-400/5"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </>
                                        ) : (
                                            <div className="flex items-center justify-center w-full py-1">
                                                <Badge variant="outline" className="bg-slate-800/50 border-slate-700 text-slate-500 font-normal">
                                                    Read-Only
                                                </Badge>
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Dialog */}
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-2xl sm:max-w-md rounded-3xl">
                    <form onSubmit={handleEdit} className="space-y-6">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-bold text-white">Edit Workstream</DialogTitle>
                            <DialogDescription className="text-slate-400 text-base">
                                Update workstream information
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-5 py-2">
                            <div className="space-y-2.5">
                                <Label htmlFor="edit-name" className="text-slate-300 ml-1">Workstream Name</Label>
                                <Input
                                    id="edit-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="bg-slate-800/50 border-slate-700 focus:border-primary text-white h-11 rounded-xl"
                                    required
                                    maxLength={100}
                                />
                            </div>
                            <div className="space-y-2.5">
                                <Label htmlFor="edit-description" className="text-slate-300 ml-1">Description</Label>
                                <Textarea
                                    id="edit-description"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    className="bg-slate-800/50 border-slate-700 focus:border-primary text-white min-h-[120px] rounded-xl resize-none"
                                    required
                                    minLength={10}
                                />
                            </div>
                            {error && (
                                <Alert className="bg-red-500/10 border-red-500/20 rounded-xl">
                                    <XCircle className="h-4 w-4 text-red-400" />
                                    <AlertDescription className="text-red-300 ml-2">{error}</AlertDescription>
                                </Alert>
                            )}
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setEditDialogOpen(false)} className="text-slate-400 hover:text-white hover:bg-white/5 rounded-xl px-6">
                                Cancel
                            </Button>
                            <Button type="submit" disabled={actionLoading} className="bg-primary hover:bg-primary/90 rounded-xl px-8 h-11 font-bold">
                                {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Assign Users Dialog - Placeholder */}
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-2xl sm:max-w-md rounded-3xl">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-bold text-white">Assign Users</DialogTitle>
                        <DialogDescription className="text-slate-400 text-base">
                            Manage user assignments for {selectedDepartment?.name}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <p className="text-slate-400 text-sm">
                            {departmentUsers.length > 0 ? (
                                <span>{departmentUsers.length} user(s) assigned to this department</span>
                            ) : (
                                <span>No users assigned yet</span>
                            )}
                        </p>
                        {/* TODO: Add user multi-select component */}
                    </div>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setAssignDialogOpen(false)} className="text-slate-400 hover:text-white hover:bg-white/5 rounded-xl px-6">
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <DialogContent className="bg-slate-900/95 border-slate-800 backdrop-blur-2xl sm:max-w-md rounded-3xl">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-bold text-white">Delete Workstream</DialogTitle>
                        <DialogDescription className="text-slate-400 text-base">
                            Are you sure you want to delete "{selectedDepartment?.name}"? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    {error && (
                        <Alert className="bg-red-500/10 border-red-500/20 rounded-xl">
                            <XCircle className="h-4 w-4 text-red-400" />
                            <AlertDescription className="text-red-300 ml-2">{error}</AlertDescription>
                        </Alert>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setDeleteDialogOpen(false)}
                            className="text-slate-400 hover:text-white hover:bg-white/5 rounded-xl px-6"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="destructive"
                            onClick={handleDelete}
                            disabled={actionLoading}
                            className="bg-red-600 hover:bg-red-700 rounded-xl px-8 h-11 font-bold"
                        >
                            {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
