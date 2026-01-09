/**
 * POST /api/auth/reset-password
 * Reset password using token
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

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

        const { token, password } = await request.json();

        if (!token || !password) {
            return NextResponse.json({ error: 'Token and password are required' }, { status: 400 });
        }

        if (password.length < 8) {
            return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
        }

        // Find user with valid token
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id, email, reset_token, reset_token_expires')
            .eq('reset_token', token)
            .maybeSingle();

        if (!user || userError) {
            return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });
        }

        // Check if token is expired
        if (!user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
            return NextResponse.json({ error: 'Reset link has expired. Please request a new one.' }, { status: 400 });
        }

        // Hash new password
        const passwordHash = await bcrypt.hash(password, 12);

        // Update password and clear reset token
        const { error: updateError } = await supabase
            .from('users')
            .update({
                password_hash: passwordHash,
                reset_token: null,
                reset_token_expires: null,
            })
            .eq('id', user.id);

        if (updateError) {
            console.error('[ResetPassword] Failed to update password:', updateError);
            return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
        }

        console.log(`[ResetPassword] Password reset successful for user ${user.email}`);

        return NextResponse.json({
            success: true,
            message: 'Password has been reset successfully. You can now log in with your new password.'
        });

    } catch (error) {
        console.error('[ResetPassword] Error:', error);
        return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
    }
}
