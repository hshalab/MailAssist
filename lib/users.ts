/**
 * User management utilities for team members
 * Handles CRUD operations for users and role-based permissions
 */

import { supabase } from './supabase';
import { getSessionUserEmail } from './session';

export type UserRole = 'admin' | 'manager' | 'agent';

export interface User {
  id: string;
  name: string;
  email?: string | null;
  role: UserRole;
  isActive: boolean;
  sharedGmailEmail?: string | null;
  userEmail?: string | null;
  businessId?: string | null;
  createdAt: string;
  updatedAt: string;
  hasFullAccess?: boolean;
}

export interface CreateUserInput {
  name: string;
  email?: string | null;
  role: UserRole;
  sharedGmailEmail?: string | null;
  businessId?: string | null;
}

export interface UpdateUserInput {
  name?: string;
  email?: string | null;
  role?: UserRole;
  isActive?: boolean;
}

/**
 * Get current user from session
 */
export async function getCurrentUser(): Promise<User | null> {
  const sessionEmail = await getSessionUserEmail();
  if (!sessionEmail) {
    return null;
  }

  // Get user ID from session (stored separately)
  // For now, we'll use a cookie to store current_user_id
  // This will be set after user selection
  return null; // Will be implemented with session user ID
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Error fetching user by ID:', error);
    return null;
  }

  if (!data) return null;

  return mapRowToUser(data);
}

/**
 * Get all users for the current account context (business or personal)
 */
export async function getAllUsers(businessId?: string | null, sharedGmailEmail?: string | null): Promise<User[]> {
  if (!supabase) return [];

  let query = supabase
    .from('users')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  // For business accounts: use businessId
  if (businessId) {
    query = query.eq('business_id', businessId);
  }
  // For personal accounts: use sharedGmailEmail
  else {
    const email = sharedGmailEmail ?? await getSessionUserEmail();
    if (!email) {
      console.log('[getAllUsers] No shared Gmail account or business ID found');
      return [];
    }
    query = query.eq('user_email', email);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching users:', error);
    return [];
  }

  return (data || []).map(mapRowToUser);
}

/**
 * Create a new user
 * Supports both business accounts (via businessId) and personal accounts (via sharedGmailEmail)
 */
export async function createUser(input: CreateUserInput): Promise<User | null> {
  if (!supabase) return null;

  const payload: any = {
    name: input.name,
    email: input.email ?? null,
    role: input.role,
    is_active: true,
  };

  // For business accounts: use businessId
  if (input.businessId) {
    payload.business_id = input.businessId;
    console.log('[CreateUser] Creating user for business:', input.businessId);
  }
  // For personal accounts: use sharedGmailEmail from cookie or input
  else {
    const sharedGmailEmail = input.sharedGmailEmail ?? await getSessionUserEmail();
    if (!sharedGmailEmail) {
      throw new Error('No shared Gmail account or business ID provided');
    }
    payload.shared_gmail_email = sharedGmailEmail;
    payload.user_email = sharedGmailEmail;
    console.log('[CreateUser] Creating user for personal account:', sharedGmailEmail);
  }

  const { data, error } = await supabase
    .from('users')
    .insert(payload)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('Error creating user:', error);
    throw error;
  }

  if (!data) return null;

  return mapRowToUser(data);
}

/**
 * Update a user (Admin only, or self for name/email)
 */
export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<User | null> {
  if (!supabase) return null;

  const sharedGmailEmail = await getSessionUserEmail();
  if (!sharedGmailEmail) {
    throw new Error('No shared Gmail account found');
  }

  const updates: any = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.email !== undefined) updates.email = input.email;
  if (input.role !== undefined) updates.role = input.role;
  if (input.isActive !== undefined) updates.is_active = input.isActive;

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .eq('user_email', sharedGmailEmail) // Ensure user belongs to this account
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('Error updating user:', error);
    throw error;
  }

  if (!data) return null;

  return mapRowToUser(data);
}

/**
 * Delete (deactivate) a user (Admin only)
 */
export async function deleteUser(userId: string): Promise<boolean> {
  if (!supabase) return false;

  // Get the user to check their business_id
  const { data: userToDelete, error: fetchError } = await supabase
    .from('users')
    .select('business_id')
    .eq('id', userId)
    .maybeSingle();

  if (fetchError || !userToDelete) {
    console.error('Error fetching user to delete:', fetchError);
    throw new Error('User not found');
  }

  // Soft delete by setting is_active to false
  const { error } = await supabase
    .from('users')
    .update({ is_active: false })
    .eq('id', userId);

  if (error) {
    console.error('Error deleting user:', error);
    throw error;
  }

  // CRITICAL: Clean up tickets assigned to this inactive user
  // Set assignee_user_id to NULL for all tickets assigned to this user
  // This ensures counts are accurate and tickets appear as "unassigned"
  const { error: ticketsError } = await supabase
    .from('tickets')
    .update({ assignee_user_id: null })
    .eq('assignee_user_id', userId);

  if (ticketsError) {
    console.error('Error cleaning up ticket assignments:', ticketsError);
    // Don't throw - user deletion succeeded, ticket cleanup is secondary
  } else {
    console.log(`[deleteUser] Cleaned up ticket assignments for user ${userId}`);
  }

  return true;
}

/**
 * Check if user has permission for an action
 */
export async function hasPermission(
  userId: string,
  requiredRole: UserRole | UserRole[]
): Promise<boolean> {
  const user = await getUserById(userId);
  if (!user || !user.isActive) {
    return false;
  }

  const requiredRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

  // Role hierarchy: admin > manager > agent
  const roleHierarchy: Record<UserRole, number> = {
    admin: 3,
    manager: 2,
    agent: 1,
  };

  const userRoleLevel = roleHierarchy[user.role];
  const requiredRoleLevels = requiredRoles.map((r) => roleHierarchy[r]);
  const minRequiredLevel = Math.min(...requiredRoleLevels);

  return userRoleLevel >= minRequiredLevel;
}

/**
 * Check if user can perform admin actions
 */
export async function isAdmin(userId: string): Promise<boolean> {
  return hasPermission(userId, 'admin');
}

/**
 * Check if user can perform manager actions
 */
export async function isManagerOrAbove(userId: string): Promise<boolean> {
  return hasPermission(userId, ['admin', 'manager']);
}

/**
 * Map database row to User object
 */
function mapRowToUser(row: any): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    isActive: row.is_active,
    sharedGmailEmail: row.shared_gmail_email,
    userEmail: row.user_email,
    businessId: row.business_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasFullAccess: row.has_full_access || false,
  };
}


