import { NextRequest, NextResponse } from "next/server"
import { listKnowledge, createKnowledge } from "@/lib/knowledge"
import { checkPermission } from "@/lib/permissions"
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from "@/lib/session"
import { validateTextInput, sanitizeStringArray } from "@/lib/validation"

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const includeAll = url.searchParams.get("all") === "1"
  // CRITICAL FIX: Use getCurrentUserEmail() to get the connected Gmail account email
  // For business accounts, this ensures knowledge items are loaded from the connected email (e.g., support@company.com)
  // not the admin's login email (e.g., admin@company.com)
  const { getCurrentUserEmail } = await import('@/lib/storage')
  let userEmail = await getCurrentUserEmail()
  
  // Fallback to session email if getCurrentUserEmail fails (shouldn't happen if authenticated)
  if (!userEmail) {
    userEmail = getSessionUserEmailFromRequest(request as any)
  }
  
  if (!userEmail) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

  if (!includeAll) {
    const items = await listKnowledge(userEmail, false)
    return NextResponse.json({ items })
  }

  // includeAll requires admin/manager
  const userId = getCurrentUserIdFromRequest(request as any)
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const adminCheck = await checkPermission(userId, "admin")
  const managerCheck = await checkPermission(userId, "manager")
  const allowed = adminCheck.allowed || managerCheck.allowed
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const items = await listKnowledge(userEmail, true)
  return NextResponse.json({ items })
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request as any)
    // CRITICAL FIX: Use getCurrentUserEmail() to get the connected Gmail account email
    // For business accounts, this ensures knowledge items are saved under the connected email (e.g., support@company.com)
    // not the admin's login email (e.g., admin@company.com)
    const { getCurrentUserEmail } = await import('@/lib/storage')
    let userEmail = await getCurrentUserEmail()
    
    // Fallback to session email if getCurrentUserEmail fails (shouldn't happen if authenticated)
    if (!userEmail) {
      userEmail = getSessionUserEmailFromRequest(request as any)
    }
    
    if (!userId || !userEmail) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

    const adminCheck = await checkPermission(userId, "admin")
    const managerCheck = await checkPermission(userId, "manager")
    const allowed = adminCheck.allowed || managerCheck.allowed
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const body = await request.json()
    
    // Validate and sanitize title
    const titleValidation = validateTextInput(body.title, 200, true)
    if (!titleValidation.valid) {
      return NextResponse.json({ error: titleValidation.error || "Invalid title" }, { status: 400 })
    }
    
    // Validate and sanitize body
    const bodyValidation = validateTextInput(body.body, 10000, true)
    if (!bodyValidation.valid) {
      return NextResponse.json({ error: bodyValidation.error || "Invalid body" }, { status: 400 })
    }
    
    // Sanitize tags
    const tags = sanitizeStringArray(Array.isArray(body.tags) ? body.tags : [])
    if (tags.length > 20) {
      return NextResponse.json({ error: "Maximum 20 tags allowed" }, { status: 400 })
    }
    
    const status = adminCheck.allowed ? "published" : "pending"
    const item = await createKnowledge({
      title: titleValidation.sanitized,
      body: bodyValidation.sanitized,
      tags,
      canParaphrase: !!body.canParaphrase,
      status,
      userEmail,
      userId,
    })
    if (!item) return NextResponse.json({ error: "Failed to create item" }, { status: 500 })
    return NextResponse.json({ item })
  } catch (error) {
    console.error("Error creating knowledge item:", error)
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 })
  }
}

