/**
 * Permission checking utilities for role-based access control
 */

import { NextRequest } from 'next/server';
import { getCurrentUserIdFromRequest as getUserIdFromRequest } from './session';
import { getUserById, UserRole, hasPermission } from './users';

/**
 * Get current user ID from request cookies (re-export from session)
 */
export function getCurrentUserIdFromRequest(request: NextRequest): string | null {
  return getUserIdFromRequest(request);
}

/**
 * Check if current user has required role
 */
export async function checkPermission(
  userId: string | null,
  requiredRole: UserRole | UserRole[]
): Promise<{ allowed: boolean; userRole?: UserRole }> {
  if (!userId) {
    return { allowed: false };
  }

  const user = await getUserById(userId);
  if (!user || !user.isActive) {
    return { allowed: false };
  }

  const allowed = await hasPermission(userId, requiredRole);
  return { allowed, userRole: user.role };
}

/**
 * Middleware to check permissions in API routes
 */
export async function requirePermission(
  request: NextRequest,
  requiredRole: UserRole | UserRole[]
): Promise<{ allowed: boolean; userId: string | null; userRole?: UserRole }> {
  const userId = getCurrentUserIdFromRequest(request);

  if (!userId) {
    return { allowed: false, userId: null };
  }

  const { allowed, userRole } = await checkPermission(userId, requiredRole);
  return { allowed, userId, userRole };
}

/**
 * Check if user can view all tickets (Manager/Admin)
 */
export async function canViewAllTickets(userId: string | null): Promise<boolean> {
  if (!userId) return false;

  // Custom check: Admins/Managers OR Agents with explicit full access
  const hasRole = await hasPermission(userId, ['admin', 'manager']);
  if (hasRole) return true;

  // Check manual override
  const user = await getUserById(userId);
  if (user && user.hasFullAccess) {
    return true;
  }

  return false;
}

/**
 * Check if user can manage users (Admin only)
 */
export async function canManageUsers(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return hasPermission(userId, 'admin');
}

/**
 * Check if user can manage knowledge base (Admin only)
 */
export async function canManageKnowledgeBase(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return hasPermission(userId, 'admin');
}

/**
 * Check if user can manage guardrails (Admin only)
 */
export async function canManageGuardrails(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return hasPermission(userId, 'admin');
}

/**
 * Check if user can reassign tickets (Manager/Admin)
 */
export async function canReassignTickets(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  return hasPermission(userId, ['admin', 'manager']);
}

