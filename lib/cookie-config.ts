/**
 * Centralized cookie configuration for production compatibility
 * Handles domain, secure, SameSite, and other cookie settings
 */

/**
 * Get cookie options that work in both development and production
 */
export function getCookieOptions(options?: {
  httpOnly?: boolean;
  maxAge?: number;
  expires?: Date;
  sameSite?: 'strict' | 'lax' | 'none';
  domain?: string;
}): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  maxAge?: number;
  expires?: Date;
  path: string;
  domain?: string;
} {
  // Detect production environment
  // Vercel sets VERCEL=1, also check NODE_ENV
  const isProduction = 
    process.env.VERCEL === '1' || 
    process.env.NODE_ENV === 'production' ||
    process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://');

  // Determine domain
  // In production, optionally set domain for cross-subdomain cookies
  // In development, don't set domain (localhost)
  // If COOKIE_DOMAIN is set, use it (e.g., ".yourdomain.com" for subdomain sharing)
  // Otherwise, don't set domain (works for same domain)
  let domain: string | undefined = undefined;
  if (isProduction && process.env.COOKIE_DOMAIN) {
    domain = process.env.COOKIE_DOMAIN;
  }
  // Note: If you need cross-subdomain cookies, set COOKIE_DOMAIN=".yourdomain.com"
  // If not set, cookies will work for the exact domain only (recommended for security)

  // Secure flag: true in production (HTTPS), false in dev (HTTP)
  const secure = isProduction;

  // SameSite: 'lax' for cross-site compatibility, 'none' if needed for cross-domain
  const sameSite = options?.sameSite || 'lax';

  const cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    maxAge?: number;
    expires?: Date;
    path: string;
    domain?: string;
  } = {
    httpOnly: options?.httpOnly ?? true,
    secure,
    sameSite,
    path: '/',
  };

  if (domain) {
    cookieOptions.domain = domain;
  }

  if (options?.maxAge !== undefined) {
    cookieOptions.maxAge = options.maxAge;
  }

  if (options?.expires !== undefined) {
    cookieOptions.expires = options.expires;
  }

  return cookieOptions;
}

/**
 * Get cookie options for client-accessible cookies (httpOnly: false)
 */
export function getClientCookieOptions(options?: {
  maxAge?: number;
  expires?: Date;
  sameSite?: 'strict' | 'lax' | 'none';
  domain?: string;
}) {
  return getCookieOptions({
    ...options,
    httpOnly: false,
  });
}

