import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'
import { cookies } from 'next/headers'
import { validateAccountType } from '@/lib/account-type-utils'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null

export async function POST(req: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json(
                { error: 'Database configuration missing. Please check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' },
                { status: 503 }
            )
        }

        const body = await req.json()
        const { name, email, password } = body

        if (!name || !email || !password) {
            return NextResponse.json(
                { error: 'Name, email, and password are required' },
                { status: 400 }
            )
        }

        const normalizedEmail = email.toLowerCase().trim()

        // Check account type - prevent creating personal account if business account exists
        const accountTypeValidation = await validateAccountType(normalizedEmail, 'personal')

        if (!accountTypeValidation.isValid) {
            return NextResponse.json(
                { error: accountTypeValidation.error },
                { status: 409 }
            )
        }

        // If account exists and is already personal type, check if verified
        if (accountTypeValidation.accountInfo?.exists && accountTypeValidation.accountInfo.accountType === 'personal') {
            if (accountTypeValidation.accountInfo.isVerified) {
                return NextResponse.json(
                    { error: 'An account with this email already exists. Please login instead.' },
                    { status: 409 }
                )
            } else {
                // Delete unverified users with this email
                await supabase
                    .from('users')
                    .delete()
                    .eq('email', normalizedEmail)
                    .eq('is_email_verified', false)
            }
        }

        // Hash password
        const salt = await bcrypt.genSalt(10)
        const passwordHash = await bcrypt.hash(password, salt)

        // Create user
        const { data: newUser, error: createError } = await supabase
            .from('users')
            .insert({
                name,
                email: normalizedEmail,
                password_hash: passwordHash,
                role: 'admin', // Personal accounts get admin role (consistent with Google Sign-In)
                business_id: null, // Explicitly null for personal accounts
                is_email_verified: true, // Auto-verify for now (or implement email verification later)
            })
            .select()
            .single()

        if (createError) {
            console.error('Error creating personal user:', createError)
            return NextResponse.json(
                { error: 'Failed to create account' },
                { status: 500 }
            )
        }

        // Create session
        const sessionToken = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

        const { error: sessionError } = await supabase
            .from('user_sessions')
            .insert({
                user_id: newUser.id,
                business_id: null,
                session_token: sessionToken,
                expires_at: expiresAt.toISOString(),
            })

        if (sessionError) {
            console.error('Error creating session:', sessionError)
            return NextResponse.json(
                { error: 'Account created but failed to log in' },
                { status: 500 }
            )
        }

        // Set cookies
        const cookieStore = await cookies()
        const { getCookieOptions, getClientCookieOptions } = await import('@/lib/cookie-config')
        const cookieMaxAge = 30 * 24 * 60 * 60 // 30 days

        cookieStore.set('session_token', sessionToken, getCookieOptions({
            httpOnly: true,
            expires: expiresAt,
        }))

        // Set client-accessible cookies for UI state
        cookieStore.set('current_user_id', newUser.id, getClientCookieOptions({
            maxAge: cookieMaxAge,
        }))

        // Set gmail_user_email for session management
        cookieStore.set('gmail_user_email', normalizedEmail, getCookieOptions({
            httpOnly: true,
            maxAge: cookieMaxAge,
        }))

        return NextResponse.json({
            success: true,
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
            }
        })

    } catch (error) {
        console.error('Personal registration error:', error)
        return NextResponse.json(
            { error: 'An unexpected error occurred' },
            { status: 500 }
        )
    }
}
