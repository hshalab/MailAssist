/**
 * GET /api/shopify/customer - Get customer information from Shopify
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserEmailFromRequest } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { getCustomerData } from '@/lib/shopify';
import { isValidEmail } from '@/lib/validation';

export async function GET(request: NextRequest) {
  try {
    const userEmail = getSessionUserEmailFromRequest(request as any);
    if (!userEmail) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const email = url.searchParams.get('email');

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { error: 'Valid email address is required' },
        { status: 400 }
      );
    }

    // Get Shopify config for this account
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 500 }
      );
    }

    // Determine the "config owner" email (handle Team Mode)
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

    const { data: config, error: configError } = await supabase
      .from('shopify_config')
      .select('shop_domain, access_token')
      .eq('user_email', configLookupEmail)
      .limit(1)
      .maybeSingle();

    if (configError || !config || !config.access_token) {
      return NextResponse.json(
        { error: 'Shopify integration not configured' },
        { status: 404 }
      );
    }

    // Fetch customer data from Shopify
    const customerData = await getCustomerData(
      {
        shopDomain: config.shop_domain,
        accessToken: config.access_token,
      },
      email
    );

    // Determine currency from orders
    let currency = 'USD';
    console.log('[Shopify API] recentOrders:', JSON.stringify(customerData.recentOrders, null, 2));
    console.log('[Shopify API] First order:', customerData.recentOrders?.[0]);
    console.log('[Shopify API] First order totalPriceSet:', customerData.recentOrders?.[0]?.totalPriceSet);

    if (customerData.recentOrders && customerData.recentOrders.length > 0) {
      currency = customerData.recentOrders[0].totalPriceSet?.shopMoney?.currencyCode || 'USD';
      console.log('[Shopify API] Detected currency from recentOrders:', currency);
    } else if (customerData.orders && customerData.orders.length > 0) {
      // Fallback to first order from all orders if recentOrders is empty
      currency = customerData.orders[0].totalPriceSet?.shopMoney?.currencyCode || 'USD';
      console.log('[Shopify API] Detected currency from orders:', currency);
    }

    return NextResponse.json({
      customer: customerData.customer,
      orders: customerData.orders,
      totalSpent: customerData.totalSpent,
      recentOrders: customerData.recentOrders,
      currency: currency,
    });
  } catch (error) {
    console.error('Error fetching Shopify customer data:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch customer data',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}





