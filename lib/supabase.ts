
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!url || !serviceKey) {
  console.warn(
    'Supabase environment variables are missing. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
  )
}

let client = null

if (url && serviceKey) {
  console.log('[Supabase] Initializing with Service Role Key')
  client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}

export const supabase = client
