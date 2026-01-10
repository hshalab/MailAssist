# OAuth Login Fix - Deployment Instructions

## Problem
Google OAuth login redirects to welcome page instead of logging in successfully.
Password login works fine.

## Root Cause
Cookies are being set with wrong domain (`www.amanii.io` instead of `.amanii.io`), 
so they don't work across both www and non-www versions of the site.

## Solution
Set explicit cookie domain in Vercel environment variables.

## Steps to Fix

### 1. Add Environment Variable in Vercel

Go to your Vercel project dashboard:
1. Click on your project
2. Go to **Settings** → **Environment Variables**
3. Add this variable:
   - **Name**: `COOKIE_DOMAIN`
   - **Value**: `.amanii.io` (note the leading dot!)
   - **Environment**: Check "Production" (and optionally "Preview")
4. Click **Save**

### 2. Verify NEXT_PUBLIC_APP_URL

While in Environment Variables, also verify:
- **Name**: `NEXT_PUBLIC_APP_URL`
- **Value**: `https://www.amanii.io`
- **Environment**: Production

### 3. Redeploy

After adding/updating environment variables:
1. Go to **Deployments** tab
2. Find the latest deployment
3. Click the 3 dots (**...**) menu
4. Click **Redeploy**
5. Wait for deployment to complete

### 4. Test

After redeployment:
1. Clear all cookies for `www.amanii.io` in browser DevTools
2. Go to login page
3. Click "Sign in with Google"
4. After redirect, check DevTools → Application → Cookies
5. You should see 3 cookies with Domain = `.amanii.io`:
   - `session_token`
   - `current_user_id`
   - `gmail_user_email`

### 5. Verify in Console

After OAuth login, you should see in browser console:
```
[Cookie Config] Setting domain for www compatibility: .amanii.io
```

If you see this log and the cookies have the correct domain, OAuth login should work!

## Troubleshooting

**If OAuth still doesn't work after redeploy:**
- Hard refresh the page (Ctrl+Shift+R or Cmd+Shift+R)
- Clear browser cache
- Try in incognito/private window
- Check that all 3 cookies exist with domain `.amanii.io`

**If cookies are missing:**
- Check Vercel deployment logs for errors
- Verify environment variables are set correctly
- Make sure OAuth callback URL in Google Console matches: `https://www.amanii.io/api/auth/gmail/callback`
