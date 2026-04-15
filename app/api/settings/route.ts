import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/session';

const DEFAULTS = {
  auto_classify_days: 30,
  enable_auto_classify: true,
  enable_ai_drafts: true,
  enable_ai_summarize: true,
};

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let query = supabase.from('user_settings').select('*');
    if (user.accountType === 'business' && user.businessId) {
      query = query.eq('business_id', user.businessId);
    } else {
      query = query.eq('user_email', user.email);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error('Error fetching settings:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Shorter cache so toggle changes propagate within 60s
    const cacheHeaders = { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=30' };
    const settings = data ? {
      auto_classify_days:   data.auto_classify_days   ?? DEFAULTS.auto_classify_days,
      enable_auto_classify: data.enable_auto_classify ?? DEFAULTS.enable_auto_classify,
      enable_ai_drafts:     data.enable_ai_drafts     ?? DEFAULTS.enable_ai_drafts,
      enable_ai_summarize:  data.enable_ai_summarize  ?? DEFAULTS.enable_ai_summarize,
    } : { ...DEFAULTS };

    return NextResponse.json(settings, { headers: cacheHeaders });
  } catch (error) {
    console.error('Error in GET /api/settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { auto_classify_days, enable_auto_classify, enable_ai_drafts, enable_ai_summarize } = body;

    if (auto_classify_days !== undefined) {
      if (typeof auto_classify_days !== 'number' || auto_classify_days < 1 || auto_classify_days > 365) {
        return NextResponse.json({ error: 'auto_classify_days must be between 1 and 365' }, { status: 400 });
      }
    }
    for (const [key, val] of Object.entries({ enable_auto_classify, enable_ai_drafts, enable_ai_summarize })) {
      if (val !== undefined && typeof val !== 'boolean') {
        return NextResponse.json({ error: `${key} must be a boolean` }, { status: 400 });
      }
    }

    const settingsData: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (auto_classify_days   !== undefined) settingsData.auto_classify_days   = auto_classify_days;
    if (enable_auto_classify !== undefined) settingsData.enable_auto_classify = enable_auto_classify;
    if (enable_ai_drafts     !== undefined) settingsData.enable_ai_drafts     = enable_ai_drafts;
    if (enable_ai_summarize  !== undefined) settingsData.enable_ai_summarize  = enable_ai_summarize;

    if (user.accountType === 'business' && user.businessId) {
      settingsData.business_id = user.businessId;
      settingsData.user_email  = null;
    } else {
      settingsData.user_email  = user.email;
      settingsData.business_id = null;
    }

    let existingQuery = supabase.from('user_settings').select('id');
    if (user.accountType === 'business' && user.businessId) {
      existingQuery = existingQuery.eq('business_id', user.businessId);
    } else {
      existingQuery = existingQuery.eq('user_email', user.email);
    }
    const { data: existing } = await existingQuery.maybeSingle();

    const { data, error } = existing
      ? await supabase.from('user_settings').update(settingsData).eq('id', existing.id).select().single()
      : await supabase.from('user_settings').insert(settingsData).select().single();

    if (error) {
      console.error('Error updating settings:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      settings: {
        auto_classify_days:   data.auto_classify_days,
        enable_auto_classify: data.enable_auto_classify,
        enable_ai_drafts:     data.enable_ai_drafts,
        enable_ai_summarize:  data.enable_ai_summarize,
      },
    });
  } catch (error) {
    console.error('Error in PATCH /api/settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
