import { NextRequest, NextResponse } from "next/server"
import { getGuardrails, upsertGuardrails } from "@/lib/guardrails"
import { getCurrentUserIdFromRequest, getSessionUserEmailFromRequest } from "@/lib/session"
import { checkPermission } from "@/lib/permissions"
import { validateTextInput, sanitizeStringArray } from "@/lib/validation"

export async function GET(request: NextRequest) {
  // CRITICAL FIX: Use getCurrentUserEmail() to get the connected Gmail account email
  // For business accounts, this ensures guardrails are loaded from the connected email (e.g., support@company.com)
  // not the admin's login email (e.g., admin@company.com)
  const { getCurrentUserEmail } = await import('@/lib/storage')
  let userEmail = await getCurrentUserEmail()
  
  // Fallback to session email if getCurrentUserEmail fails (shouldn't happen if authenticated)
  if (!userEmail) {
    userEmail = getSessionUserEmailFromRequest(request as any)
  }
  
  if (!userEmail) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  const data = await getGuardrails(userEmail)
  return NextResponse.json({ guardrails: data })
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request as any)
    // CRITICAL FIX: Use getCurrentUserEmail() to get the connected Gmail account email
    // For business accounts, this ensures guardrails are saved under the connected email (e.g., support@company.com)
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
    
    // Validate and sanitize inputs
    const toneStyleValidation = validateTextInput(body.toneStyle, 1000, false)
    const rulesValidation = validateTextInput(body.rules, 2000, false)
    
    if (!toneStyleValidation.valid || !rulesValidation.valid) {
      return NextResponse.json({ 
        error: toneStyleValidation.error || rulesValidation.error || "Invalid input" 
      }, { status: 400 })
    }
    
    // Sanitize banned words
    const bannedWords = sanitizeStringArray(Array.isArray(body.bannedWords) ? body.bannedWords : [])
    if (bannedWords.length > 100) {
      return NextResponse.json({ error: "Maximum 100 banned words allowed" }, { status: 400 })
    }
    
    // Validate topic rules structure
    let topicRules = []
    if (Array.isArray(body.topicRules)) {
      topicRules = body.topicRules
        .filter((rule: any) => rule && typeof rule === 'object')
        .map((rule: any) => ({
          tag: validateTextInput(rule.tag, 50, false).sanitized,
          instruction: validateTextInput(rule.instruction, 500, false).sanitized,
        }))
        .filter((rule: any) => rule.tag && rule.instruction)
      
      if (topicRules.length > 50) {
        return NextResponse.json({ error: "Maximum 50 topic rules allowed" }, { status: 400 })
      }
    }
    
    // For now we allow both admin and manager to save live guardrails; no pending flow.
    const publish = false

    const payload = {
      toneStyle: toneStyleValidation.sanitized,
      rules: rulesValidation.sanitized,
      bannedWords,
      topicRules,
      pending: false, // Required by Guardrails interface
    }

    const saved = await upsertGuardrails(payload, {
      publish,
      // Treat both admin and manager as privileged for live saves (no pending)
      asAdmin: true,
      userEmail,
      userId,
    })
    if (!saved) return NextResponse.json({ error: "Failed to save" }, { status: 500 })
    return NextResponse.json({ guardrails: saved })
  } catch (error) {
    console.error("Error saving guardrails:", error)
    return NextResponse.json({ error: "Failed to save guardrails" }, { status: 500 })
  }
}

