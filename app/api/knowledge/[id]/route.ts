import { NextRequest, NextResponse } from "next/server"
import { updateKnowledge, deleteKnowledge } from "@/lib/knowledge"
import { checkPermission } from "@/lib/permissions"
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from "@/lib/session"
import { isValidUUID, validateTextInput, sanitizeStringArray } from "@/lib/validation"

type RouteContext = { params: { id: string } }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getCurrentUserIdFromRequest(request as any)
    const userEmail = getSessionUserEmailFromRequest(request as any)
    if (!userId || !userEmail) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    // Validate ID
    const { id: itemId } = await params
    if (!isValidUUID(itemId)) {
      return NextResponse.json({ error: "Invalid knowledge item ID" }, { status: 400 })
    }

    const adminCheck = await checkPermission(userId, "admin")
    const managerCheck = await checkPermission(userId, "manager")
    const allowed = adminCheck.allowed || managerCheck.allowed
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json()

    // Validate and sanitize inputs if provided
    const updateData: any = {}

    if (body.title !== undefined) {
      const titleValidation = validateTextInput(body.title, 200, false)
      if (!titleValidation.valid) {
        return NextResponse.json({ error: titleValidation.error || "Invalid title" }, { status: 400 })
      }
      updateData.title = titleValidation.sanitized
    }

    if (body.body !== undefined) {
      const bodyValidation = validateTextInput(body.body, 10000, false)
      if (!bodyValidation.valid) {
        return NextResponse.json({ error: bodyValidation.error || "Invalid body" }, { status: 400 })
      }
      updateData.body = bodyValidation.sanitized
    }

    if (body.tags !== undefined) {
      const tags = sanitizeStringArray(Array.isArray(body.tags) ? body.tags : [])
      if (tags.length > 20) {
        return NextResponse.json({ error: "Maximum 20 tags allowed" }, { status: 400 })
      }
      updateData.tags = tags
    }

    if (body.canParaphrase !== undefined) {
      updateData.canParaphrase = !!body.canParaphrase
    }

    if (body.status !== undefined) {
      if (!['published', 'pending'].includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 })
      }
      updateData.status = body.status
    }

    const item = await updateKnowledge(itemId, {
      ...updateData,
      bumpVersion: adminCheck.allowed && body.bumpVersion,
      userEmail,
    })
    if (!item) return NextResponse.json({ error: "Failed to update item" }, { status: 500 })
    return NextResponse.json({ item })
  } catch (error) {
    console.error("Error updating knowledge item:", error)
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = getCurrentUserIdFromRequest(request as any)
    const userEmail = getSessionUserEmailFromRequest(request as any)
    if (!userId || !userEmail) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    // Validate ID
    const { id: itemId } = await params
    if (!isValidUUID(itemId)) {
      return NextResponse.json({ error: "Invalid knowledge item ID" }, { status: 400 })
    }

    const adminCheck = await checkPermission(userId, "admin")
    const managerCheck = await checkPermission(userId, "manager")
    const allowed = adminCheck.allowed || managerCheck.allowed
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const ok = await deleteKnowledge(itemId, userEmail)
    if (!ok) return NextResponse.json({ error: "Failed to delete item" }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting knowledge item:", error)
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 })
  }
}

