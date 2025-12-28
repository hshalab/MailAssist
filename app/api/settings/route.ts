import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/session';

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Fetch settings for this user/business
        let query = supabase
            .from('user_settings')
            .select('*');

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

        // Return default settings if none exist
        if (!data) {
            return NextResponse.json({
                auto_classify_days: 30,
            });
        }

        return NextResponse.json({
            auto_classify_days: data.auto_classify_days,
        });
    } catch (error) {
        console.error('Error in GET /api/settings:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const user = await getCurrentUser();
        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { auto_classify_days } = body;

        // Validate input
        if (auto_classify_days !== undefined) {
            if (typeof auto_classify_days !== 'number' || auto_classify_days < 1 || auto_classify_days > 365) {
                return NextResponse.json(
                    { error: 'auto_classify_days must be between 1 and 365' },
                    { status: 400 }
                );
            }
        }

        // Upsert settings
        const settingsData: any = {
            auto_classify_days,
            updated_at: new Date().toISOString(),
        };

        if (user.accountType === 'business' && user.businessId) {
            settingsData.business_id = user.businessId;
            settingsData.user_email = null;
        } else {
            settingsData.user_email = user.email;
            settingsData.business_id = null;
        }

        const { data, error } = await supabase
            .from('user_settings')
            .upsert(settingsData, {
                onConflict: user.accountType === 'business' ? 'business_id' : 'user_email',
            })
            .select()
            .single();

        if (error) {
            console.error('Error updating settings:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            settings: {
                auto_classify_days: data.auto_classify_days,
            },
        });
    } catch (error) {
        console.error('Error in PATCH /api/settings:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
