# Email Rendering — Gmail-Style "White Paper" Card in Dark Mode

**Date:** 2026-04-27
**Status:** Approved design — ready for implementation plan
**Scope:** `components/email-content-viewer.tsx` only

## Problem

Inbound emails render with broken contrast inside the app:

- **Dark mode, low-contrast text:** Many emails carry inline `style="color: #555"` or similar mid-gray text that was designed for a white background. On the app's dark canvas (`#0d1418`) the text becomes nearly invisible.
- **Dark mode, white highlight bars:** Some emails carry inline `background: #fff` on text spans. On the dark canvas these render as bright white rectangles around every line of text, making the email unreadable.

The root cause is the same in both: the email's own inline CSS assumes a white canvas, but the iframe canvas is dark in dark mode. Forcing email colors to match dark mode would break marketing emails, branded headers, gradients, and any sender-designed styling — a losing battle that no major email client attempts.

## Solution

Match Gmail/Outlook web behavior: **always render the email body on a white "paper" canvas, regardless of app theme.** The surrounding app UI (sidebar, ticket list, header, banners, buttons) keeps its dark theme. The email body sits inside the dark UI as a white card, exactly as it does in Gmail's dark mode.

**Out of scope:**

- Force-rewriting email CSS to a dark palette (different design, different tradeoffs).
- Adding a per-email Light/Dark toggle (YAGNI — Gmail/Outlook don't ship one).
- Any change to the missing-Gmail-emails ingestion issue (separate spec).

## Change Surface

Only `components/email-content-viewer.tsx` is modified. No backend, API, schema, or other component changes.

## Detailed Changes

### 1. Always-white iframe canvas

Inside `components/email-content-viewer.tsx`:

- Remove the `useTheme()` import and the `isDarkMode` derivation.
- Replace the theme-conditional constants with hard-coded light values:
  - `canvasBg = '#ffffff'`
  - `fallbackText = '#1f2937'` (gray-800)
  - `fallbackLink = '#2563eb'` (blue-600)
- In the iframe `<style>` block, replace every `${isDarkMode ? X : Y}` ternary with the light-mode value:
  - blockquote `border-left` → `#cbd5e0`
  - blockquote `color` → `#718096`
  - quote-header `color` → `#718096`
  - quote-header expand-button `background` → `#e5e7eb`
  - quote-header expand-button `color` → `#0b57d0`
  - quote-header expand-button hover `background` → `#d1d5db`
  - quoted-content `border-left` → `#cbd5e0`, `color` → `#718096`
  - gmail-quote fade-out gradient bottom color → `#ffffff`
- Set `:root { color-scheme: light; }` unconditionally so form controls and scrollbars inside emails render correctly.
- The iframe's outer `style={{ background: ... }}` becomes `'#ffffff'` always.
- Remove the `@media print` body override (already light, no-op).

### 2. Visual integration with the dark UI

Wrap the iframe in container chrome so the white card looks intentional inside the dark UI:

- The existing outer wrapper keeps `rounded-lg`. Add `border border-border dark:border-white/10 dark:shadow-lg dark:shadow-black/20`.
- Add `p-2` padding to the iframe container so the white card has breathing room from the dark surrounding surface. In light mode this is invisible.
- Update the loading overlay from `bg-background/80 backdrop-blur-sm` to `bg-white/80 backdrop-blur-sm` so the loading state doesn't flash dark on top of the about-to-be-white email.

### 3. Cleanup

After the changes above:

- `useTheme` import is unused — remove it.
- `isDarkMode` constant is unused — remove it.
- All `isDarkMode ?` ternaries inside the `<style>` template literal are gone.
- The `@media print` block can be deleted (its overrides match the new defaults).

The remote-images banner (amber background, dark/light variants via Tailwind `dark:` classes) is **not** changed — it is part of the surrounding app UI, not the email body.

## What Stays the Same

- App shell (sidebar, header, ticket list, action bar, modals): unchanged dark/light theming.
- DOMPurify sanitization config: unchanged.
- CID image rewriting, remote-image proxying, tracking-pixel hiding: unchanged.
- Auto-link logic for plain-text content: unchanged.
- Iframe height auto-measurement and ResizeObserver: unchanged.
- Quote collapsing (`gmail-quote`, `quote-header`): unchanged behavior, only the colors are now fixed-light instead of theme-conditional.

## Verification

Manual checklist (no automated tests added — pure visual change):

- [ ] Open the Carifex email from the bug report (Image 1) in dark mode → text is fully readable on a white card; surrounding UI stays dark.
- [ ] Open the Sponsored Posts email (Image 2) in dark mode → no white highlight bars; text reads cleanly.
- [ ] Switch app to light mode → email viewer looks identical to current production (no regression).
- [ ] Plain-text reply (no HTML tags) renders with line breaks intact, blue links, dark text on white.
- [ ] HTML email with branded header (logo, colored buttons) renders with original colors preserved in both modes.
- [ ] Remote-image block banner still themes amber correctly in both modes.
- [ ] Quoted reply ("On … wrote:") collapses and expands correctly; collapsed gradient fades to white.
- [ ] Iframe height measurement still works; no clipping or excess whitespace at the bottom.
- [ ] Loading overlay no longer flashes dark before the email paints.

## Risks

- **Aesthetic jump in dark mode:** The white card is intentionally different from the surrounding dark UI. This is the same pattern Gmail uses; users expect it.
- **Print stylesheet removal:** The deleted `@media print` block previously forced light colors for printing. Since the email body is now always light, printing already produces the right output. No regression.

## File Touched

- `components/email-content-viewer.tsx`

No other files need changes.
