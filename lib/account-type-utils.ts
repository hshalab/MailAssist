/**
 * Account Type Detection and Validation Utilities
 * Centralized logic for determining and validating account types
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey)
    : null;

export type AccountType = 'business' | 'personal' | null;

export interface AccountInfo {
    exists: boolean;
    accountType: AccountType;
    userId?: string;
    businessId?: string | null;
    hasPassword: boolean;
    isVerified: boolean;
    role?: string;
}

/**
 * Get comprehensive account information for an email
 */
export async function getAccountInfo(email: string): Promise<AccountInfo> {
    const normalizedEmail = email.toLowerCase().trim();

    try {
        if (!supabase) {
            console.warn('Supabase client not initialized in account-type-utils');
            return {
                exists: false,
                accountType: null,
                hasPassword: false,
                isVerified: false,
            };
        }

        // Check users table for all accounts with this email
        const { data: users, error } = await supabase
            .from('users')
            .select('id, business_id, password_hash, is_email_verified, role')
            .eq('email', normalizedEmail)
            .eq('is_active', true);

        if (error) {
            console.error('Error fetching user info:', error);
            return {
                exists: false,
                accountType: null,
                hasPassword: false,
                isVerified: false,
            };
        }

        // No users found in users table - check businesses table directly
        // This handles the case where registration started but OTP wasn't verified
        if (!users || users.length === 0) {
            const { data: business, error: businessError } = await supabase
                .from('businesses')
                .select('id, is_email_verified')
                .eq('business_email', normalizedEmail)
                .maybeSingle();

            if (businessError || !business) {
                return {
                    exists: false,
                    accountType: null,
                    hasPassword: false,
                    isVerified: false,
                };
            }

            // Exists in businesses table but not users table
            return {
                exists: true,
                accountType: 'business',
                businessId: business.id,
                hasPassword: true, // Assume it has a password if it reached business creation
                isVerified: business.is_email_verified || false,
            };
        }

        // Prioritize business accounts over personal accounts
        const businessUser = users.find(u => u.business_id !== null);
        const userToUse = businessUser || users[0];

        const accountType: AccountType = userToUse.business_id !== null ? 'business' : 'personal';
        const hasPassword = userToUse.password_hash !== null &&
            userToUse.password_hash !== '' &&
            userToUse.password_hash !== 'GOOGLE_OAUTH';

        return {
            exists: true,
            accountType,
            userId: userToUse.id,
            businessId: userToUse.business_id,
            hasPassword,
            isVerified: userToUse.is_email_verified || false,
            role: userToUse.role,
        };
    } catch (error) {
        console.error('Error in getAccountInfo:', error);
        return {
            exists: false,
            accountType: null,
            hasPassword: false,
            isVerified: false,
        };
    }
}

/**
 * Validate that an email matches the expected account type
 */
export async function validateAccountType(
    email: string,
    expectedType: 'business' | 'personal'
): Promise<{
    isValid: boolean;
    error?: string;
    accountInfo?: AccountInfo;
}> {
    const accountInfo = await getAccountInfo(email);

    if (!accountInfo.exists) {
        return { isValid: true, accountInfo }; // New account, can proceed
    }

    if (accountInfo.accountType === expectedType) {
        return { isValid: true, accountInfo };
    }

    // Account exists but wrong type
    const actualType = accountInfo.accountType === 'business' ? 'business' : 'personal';
    const expectedTypeLabel = expectedType === 'business' ? 'business' : 'personal';

    return {
        isValid: false,
        error: `This email is already registered as a ${actualType} account. Please use the ${actualType} login${expectedType === 'business' && actualType === 'personal' ? ' or upgrade your account' : ''}.`,
        accountInfo,
    };
}

/**
 * Check if an email can use Google OAuth login
 */
export async function canLoginWithGoogle(email: string): Promise<{
    canLogin: boolean;
    reason?: string;
    accountInfo?: AccountInfo;
}> {
    const accountInfo = await getAccountInfo(email);

    if (!accountInfo.exists) {
        // New user, can create personal account via Google
        return { canLogin: true, accountInfo };
    }

    // If account exists as personal, allow Google login
    if (accountInfo.accountType === 'personal') {
        return { canLogin: true, accountInfo };
    }

    // If account exists as business with password, don't allow Google login
    if (accountInfo.accountType === 'business' && accountInfo.hasPassword) {
        return {
            canLogin: false,
            reason: 'This email is registered as a business account. Please use password login.',
            accountInfo,
        };
    }

    // Business account without password (edge case)
    return { canLogin: true, accountInfo };
}

/**
 * Get user-friendly error message for account type mismatch
 */
export function getAccountTypeMismatchError(
    actualType: AccountType,
    attemptedType: 'business' | 'personal'
): string {
    if (actualType === 'business' && attemptedType === 'personal') {
        return 'This email is registered as a business account. Please sign in using the business login.';
    }

    if (actualType === 'personal' && attemptedType === 'business') {
        return 'This email is registered as a personal account. Please sign in using the personal login or upgrade to business.';
    }

    return 'Account type mismatch. Please use the correct login method.';
}

/**
 * Check if multiple accounts exist for the same email (edge case)
 */
export async function hasMultipleAccounts(email: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();

    try {
        if (!supabase) {
            return false;
        }

        const { data: users, error } = await supabase
            .from('users')
            .select('id')
            .eq('email', normalizedEmail)
            .eq('is_active', true);

        if (error || !users) {
            return false;
        }

        return users.length > 1;
    } catch (error) {
        console.error('Error checking for multiple accounts:', error);
        return false;
    }
}

/**
 * Get the primary account for an email (prioritizes business over personal)
 */
export async function getPrimaryAccount(email: string): Promise<AccountInfo | null> {
    const accountInfo = await getAccountInfo(email);
    return accountInfo.exists ? accountInfo : null;
}
