/**
 * POST /api/auth/forgot-password
 * Request a password reset email
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email-service';
import crypto from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export async function POST(request: NextRequest) {
    try {
        if (!supabase) {
            return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
        }

        const { email } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Email is required' }, { status: 400 });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Find user by email
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, name, email, password_hash')
            .eq('email', normalizedEmail)
            .maybeSingle();

        // Always return success to prevent email enumeration
        if (!user || userError) {
            console.log(`[ForgotPassword] No user found for email: ${normalizedEmail}`);
            return NextResponse.json({
                success: true,
                message: 'If an account exists with this email, you will receive a password reset link.'
            });
        }

        // Check if user has a password (Google OAuth users can't reset password)
        if (!user.password_hash || user.password_hash === 'GOOGLE_OAUTH' || user.password_hash === 'CONNECTED_ACCOUNT') {
            console.log(`[ForgotPassword] User ${normalizedEmail} is OAuth-only, skipping reset`);
            return NextResponse.json({
                success: true,
                message: 'If an account exists with this email, you will receive a password reset link.'
            });
        }

        // Generate secure reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Store token in database
        const { error: updateError } = await supabase
            .from('users')
            .update({
                reset_token: resetToken,
                reset_token_expires: resetTokenExpires.toISOString(),
            })
            .eq('id', user.id);

        if (updateError) {
            console.error('[ForgotPassword] Failed to store reset token:', updateError);
            return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
        }

        // Build reset link
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const resetLink = `${baseUrl}/reset-password?token=${resetToken}`;

        // Send email
        try {
            await sendEmail.passwordReset({
                to: normalizedEmail,
                userName: user.name || normalizedEmail.split('@')[0],
                resetLink,
            });
            console.log(`[ForgotPassword] Reset email sent to ${normalizedEmail}`);
        } catch (emailError) {
            console.error('[ForgotPassword] Failed to send email:', emailError);
            // Don't expose email sending errors to user
        }

        return NextResponse.json({
            success: true,
            message: 'If an account exists with this email, you will receive a password reset link.'
        });

    } catch (error) {
        console.error('[ForgotPassword] Error:', error);
        return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
    }
}
