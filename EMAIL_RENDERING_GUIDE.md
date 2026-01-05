# Outlook-Style Email Rendering Implementation

## Overview
This implementation adds robust email rendering with 4 key systems:

1. **EmailContentViewer Component** - Sandboxed iframe with dark mode support
2. **Image Proxy API** - Proxies external images to avoid CORS issues
3. **Attachment Download API** - Serves email attachments securely
4. **AI Summarization API** - Summarizes email threads using GROQ

---

## 1. EmailContentViewer Component

**Location:** `components/email-content-viewer.tsx`

### Features
- ✅ Sandboxed iframe prevents CSS bleeding and XSS attacks
- ✅ DOMPurify sanitization with safe URI schemes (cid:, data:, http/s:)
- ✅ Dark mode using filter inversion (Gmail/Outlook style)
- ✅ ResizeObserver for dynamic height adjustment
- ✅ Image loading detection to prevent layout shifts
- ✅ CID image replacement for inline attachments
- ✅ External image proxying through `/api/proxy/image`

### Usage
```tsx
import { EmailContentViewer } from "@/components/email-content-viewer"

<EmailContentViewer
    content={email.body}
    emailId={email.id}
    attachments={email.attachments}
    className="my-4"
/>
```

### Dark Mode Implementation
The component uses the "invert trick" for dark mode:
1. Apply `filter: invert(1) hue-rotate(180deg)` to the email container
2. Apply the **same filter** to all `<img>` tags to re-invert them
3. This keeps photos looking normal while darkening the background

---

## 2. Image Proxy API

**Location:** `app/api/proxy/image/route.ts`

### Features
- ✅ Proxies external images to bypass CORS/mixed-content
- ✅ 24-hour cache for performance
- ✅ Returns transparent 1x1 GIF on error (graceful degradation)
- ✅ Edge runtime for optimal performance

### Usage
External images in emails are automatically proxied:
```html
<!-- Original -->
<img src="https://example.com/image.jpg">

<!-- Automatically converted to -->
<img src="/api/proxy/image?url=https%3A%2F%2Fexample.com%2Fimage.jpg">
```

### Manual Usage
```typescript
const proxyUrl = `/api/proxy/image?url=${encodeURIComponent(imageUrl)}`
```

---

## 3. Attachment Download API

**Location:** `app/api/emails/[id]/attachments/[attachmentId]/route.ts`

### Features
- ✅ Fetches attachments from Gmail API
- ✅ Proper Content-Disposition headers for downloads
- ✅ MIME type detection
- ✅ 1-hour cache for performance

### Usage
CID images are automatically converted:
```html
<!-- Original in email -->
<img src="cid:attachment123">

<!-- Automatically converted to -->
<img src="/api/emails/emailId/attachments/attachment123">
```

### Manual Download Link
```tsx
<a href={`/api/emails/${emailId}/attachments/${attachmentId}?filename=${filename}&mimeType=${mimeType}`}>
    Download {filename}
</a>
```

---

## 4. AI Summarization API

**Location:** `app/api/emails/summarize/route.ts`

### Features
- ✅ Uses GROQ API with llama-3.3-70b-versatile model
- ✅ Strips HTML/CSS/metadata automatically
- ✅ 2-3 sentence summaries with action items
- ✅ 4000 character limit to stay within token limits

### Setup
Add to your `.env.local`:
```env
GROQ_API_KEY=your_groq_api_key_here
```

Get your API key from: https://console.groq.com/keys

### Usage
```typescript
// Summarize a single email
const response = await fetch('/api/emails/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: email.body })
})
const { summary } = await response.json()

// Summarize an entire thread
const threadContent = threadMessages.map(msg => 
    `From: ${msg.from}\n${msg.body}`
).join('\n\n---\n\n')

const response = await fetch('/api/emails/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: threadContent })
})
const { summary } = await response.json()
```

### React Component Example
```tsx
import { useState } from 'react'
import { Button } from '@/components/ui/button'

function EmailWithSummary({ email }) {
    const [summary, setSummary] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)

    const generateSummary = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/emails/summarize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: email.body })
            })
            const data = await res.json()
            setSummary(data.summary)
        } catch (error) {
            console.error('Failed to summarize:', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div>
            <Button onClick={generateSummary} disabled={loading}>
                {loading ? 'Summarizing...' : 'Summarize Email'}
            </Button>
            {summary && (
                <div className="mt-4 p-4 bg-muted rounded-lg">
                    <h4 className="font-semibold mb-2">Summary</h4>
                    <p className="text-sm">{summary}</p>
                </div>
            )}
            <EmailContentViewer content={email.body} />
        </div>
    )
}
```

---

## Testing

### Test EmailContentViewer
1. Open any email with HTML content
2. Check that images load properly
3. Toggle dark mode - images should remain normal while background darkens
4. Verify iframe auto-resizes with content

### Test Image Proxy
1. Open browser DevTools → Network tab
2. Look for requests to `/api/proxy/image`
3. Verify images load and are cached (check response headers)

### Test Attachments
1. Open an email with inline images (CID attachments)
2. Verify images display properly
3. Check Network tab for `/api/emails/[id]/attachments/[attachmentId]` requests

### Test AI Summarization
1. Call the API with sample email content
2. Verify you get a 2-3 sentence summary
3. Check that HTML tags are stripped from output

---

## Environment Variables

Add to `.env.local`:
```env
# Required for AI Summarization
GROQ_API_KEY=your_groq_api_key_here

# Already configured for Gmail/Email
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

---

## Performance Notes

- **Image Proxy**: Edge runtime with 24-hour cache
- **Attachments**: 1-hour cache, streamed directly from Gmail
- **Summarization**: ~1-2 seconds per email with llama-3.3-70b
- **EmailContentViewer**: Lightweight, only renders visible content

---

## Security

✅ **XSS Prevention**: Sandboxed iframe + DOMPurify sanitization  
✅ **CORS Bypass**: Image proxy handles external content safely  
✅ **No Eval/Unsafe**: All content sanitized before rendering  
✅ **Auth Required**: Attachment API requires valid Gmail tokens  

---

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile: ✅ Responsive and touch-friendly

---

## Troubleshooting

### Dark Mode Images Look Wrong
- Ensure the double-filter technique is applied (container + images)
- Check that `useTheme()` from `next-themes` is working

### Images Not Loading
- Check image proxy route is working: `/api/proxy/image?url=https://via.placeholder.com/150`
- Verify CORS is not blocking the proxy

### Summarization Not Working
- Verify `GROQ_API_KEY` is set in `.env.local`
- Check GROQ API quota/limits
- Review console for API errors

### Iframe Not Resizing
- Ensure ResizeObserver is supported (all modern browsers)
- Check that images are finishing loading before height calculation
- Verify `waitForImages()` function is working

---

## Future Enhancements

- [ ] Add "Show Original" toggle for raw HTML view
- [ ] Support for RTL (right-to-left) languages
- [ ] Batch summarization for multiple emails
- [ ] Custom dark mode color schemes
- [ ] Print-optimized styling
- [ ] Accessibility improvements (ARIA labels)

---

## Credits

Implemented based on Gmail/Outlook rendering techniques with modern web standards.
