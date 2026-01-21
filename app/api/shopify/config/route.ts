/**
 * GET/POST /api/shopify/config - Manage Shopify integration configuration
 * Only admins can configure Shopify integration
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserIdFromRequest } from '@/lib/permissions';
import { checkPermission } from '@/lib/permissions';
import { getSessionUserEmailFromRequest } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { sanitizeString, validateTextInput } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request as any);
    const userEmail = getSessionUserEmailFromRequest(request as any);

    if (!userId || !userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check if user is admin ONLY for write operations or sensitive data
    // For simple config check (isConfigured), we allow all authenticated users
    // const adminCheck = await checkPermission(userId, 'admin');
    // if (!adminCheck.allowed) {
    //   return NextResponse.json(
    //     { error: 'Forbidden - Admin access required' },
    //     { status: 403 }
    //   );
    // }

    // Get Shopify config for this account
    if (!supabase) {
      return NextResponse.json({ config: null });
    }

    // Determine the "config owner" email
    // If user is in a business, use the BUSINESS EMAIL to look up config
    // This allows agents to see the config set up by the admin/business owner
    let configLookupEmail = userEmail;

    const { getCurrentUser } = await import('@/lib/session');
    const currentUser = await getCurrentUser();

    if (currentUser && currentUser.businessId) {
      // Look up business email
      const { data: business } = await supabase
        .from('businesses')
        .select('business_email')
        .eq('id', currentUser.businessId)
        .single();

      if (business && business.business_email) {
        configLookupEmail = business.business_email;
      }
    }

    const { data, error } = await supabase
      .from('shopify_config')
      .select('shop_domain, access_token')
      .eq('user_email', configLookupEmail)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching Shopify config:', error);
      return NextResponse.json({ config: null });
    }

    if (!data) {
      return NextResponse.json({ config: null });
    }

    // Return config with masked access token for security
    return NextResponse.json({
      config: {
        shopDomain: data.shop_domain,
        accessToken: data.access_token ? '***' + data.access_token.slice(-4) : null,
        isConfigured: true,
      },
    });
  } catch (error) {
    console.error('Error fetching Shopify config:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Shopify config', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request as any);
    const userEmail = getSessionUserEmailFromRequest(request as any);

    if (!userId || !userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check if user is admin
    const adminCheck = await checkPermission(userId, 'admin');
    if (!adminCheck.allowed) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();

    // Validate and sanitize inputs
    const { sanitized: shopDomain, error: domainError } = validateTextInput(
      body.shopDomain,
      200,
      false
    );
    const { sanitized: accessToken, error: tokenError } = validateTextInput(
      body.accessToken,
      200,
      false
    );

    if (!body.shopDomain || !body.shopDomain.trim()) {
      return NextResponse.json(
        { error: 'Shop domain is required' },
        { status: 400 }
      );
    }

    if (!body.accessToken || !body.accessToken.trim()) {
      return NextResponse.json(
        { error: 'Access token is required' },
        { status: 400 }
      );
    }

    if (domainError || tokenError || !shopDomain || !accessToken) {
      return NextResponse.json(
        { error: domainError || tokenError || 'Invalid shop domain or access token' },
        { status: 400 }
      );
    }

    // Validate shop domain format
    const domainPattern = /^[a-zA-Z0-9-]+\.myshopify\.com$/;
    if (!domainPattern.test(shopDomain)) {
      return NextResponse.json(
        { error: 'Invalid shop domain format. Must be: your-shop.myshopify.com' },
        { status: 400 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 500 }
      );
    }

    // Upsert Shopify config
    const { data, error } = await supabase
      .from('shopify_config')
      .upsert(
        {
          user_email: userEmail,
          shop_domain: shopDomain,
          access_token: accessToken,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_email',
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error saving Shopify config:', error);
      return NextResponse.json(
        { error: 'Failed to save Shopify config', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      config: {
        shopDomain: data.shop_domain,
        isConfigured: true,
      },
    });
  } catch (error) {
    console.error('Error saving Shopify config:', error);
    return NextResponse.json(
      { error: 'Failed to save Shopify config', details: (error as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const userId = getCurrentUserIdFromRequest(request as any);
    const userEmail = getSessionUserEmailFromRequest(request as any);

    if (!userId || !userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Check if user is admin
    const adminCheck = await checkPermission(userId, 'admin');
    if (!adminCheck.allowed) {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 500 }
      );
    }

    // Delete Shopify config
    const { error } = await supabase
      .from('shopify_config')
      .delete()
      .eq('user_email', userEmail);

    if (error) {
      console.error('Error deleting Shopify config:', error);
      return NextResponse.json(
        { error: 'Failed to delete Shopify config', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting Shopify config:', error);
    return NextResponse.json(
      { error: 'Failed to delete Shopify config', details: (error as Error).message },
      { status: 500 }
    );
  }
}





