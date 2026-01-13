"use client"

import React, { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { ArrowLeft, ChevronDown, ChevronUp, Sparkles, Loader2, Mail, ShoppingBag, Link as LinkIcon, Image as ImageIcon, Paperclip, Code, Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, AlignLeft, AlignCenter, AlignRight, Highlighter, Type, FileText, Download } from "lucide-react"
import { EmailContentViewer } from "@/components/email-content-viewer"
import { AttachmentList } from "@/components/attachment-list"
import { htmlToText } from "@/lib/html-to-text"

const toPlainText = (html: string) => {
  if (!html) return ""
  const tmp = typeof window !== "undefined" ? document.createElement("div") : null
  if (!tmp) return html
  tmp.innerHTML = html
  return tmp.textContent || tmp.innerText || ""
}

const textToHtml = (text: string) => {
  if (!text) return ""
  return text
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join("")
}

const applyCommand = (command: string, value?: string) => {
  if (typeof document === "undefined") return
  document.execCommand(command, false, value)
}

interface EmailDetailProps {
  emailId: string
  onDraftGenerated?: () => void
  onBack?: () => void
  onToggleShopify?: (email: string) => void
  showShopifySidebar?: boolean
  ticketId?: string | null
  hideCloseButton?: boolean // Hide Send & Close button (for inbox view)
  // Optional initial email data for instant display
  initialEmailData?: {
    subject?: string
    from?: string
    to?: string
    date?: string
    snippet?: string
    body?: string
    threadId?: string
    attachments?: { id: string; filename: string; mimeType: string; size: number }[]
  }
}

interface EmailMessage {
  id: string
  threadId?: string
  subject: string
  from: string
  to: string
  date: string
  body: string
  snippet?: string
  labels?: string[]
  attachments?: { id: string; filename: string; mimeType: string; size: number }[]
}

interface EmailSummary {
  id: string
  threadId?: string
  subject: string
  from: string
  to: string
  date: string
  body: string
  snippet?: string
  labels?: string[]
  attachments?: { id: string; filename: string; mimeType: string; size: number }[]
}

export default function EmailDetail({ emailId, onDraftGenerated, onBack, initialEmailData, onToggleShopify, showShopifySidebar, ticketId, hideCloseButton }: EmailDetailProps) {
  const [threadMessages, setThreadMessages] = useState<EmailMessage[]>([])
  const [emailSummary, setEmailSummary] = useState<EmailSummary | null>(null)
  const [loading, setLoading] = useState(true) // Show loading skeleton initially
  const [loadingFullContent, setLoadingFullContent] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [showDraft, setShowDraft] = useState(false)
  const [draftMinimized, setDraftMinimized] = useState(false)
  const [draftText, setDraftText] = useState("")
  const [draftId, setDraftId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendingAction, setSendingAction] = useState<'send' | 'send-close' | null>(null)
  const [copied, setCopied] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const [sendResetTimer, setSendResetTimer] = useState<NodeJS.Timeout | null>(null)
  const [conversationSummary, setConversationSummary] = useState<string>("")
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const [generatingSummary, setGeneratingSummary] = useState(false)
  const [autoSaving, setAutoSaving] = useState(false)
  const [draftHtml, setDraftHtml] = useState("")
  const editorRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const [attachments, setAttachments] = useState<{ id: string; name: string; type: string; size: number; data: string }[]>([])
  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const [linkInputValue, setLinkInputValue] = useState("")
  const [linkTextValue, setLinkTextValue] = useState("")
  const [linkHasSelection, setLinkHasSelection] = useState(false)
  const [linkDialogPosition, setLinkDialogPosition] = useState<{ top: number; left: number } | null>(null)
  const linkDialogRef = useRef<HTMLDivElement | null>(null)
  const draftAutoSaveTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Get current user ID for auto-assignment
  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.json())
      .then(data => setCurrentUserId(data?.id || null))
      .catch(() => setCurrentUserId(null))
  }, [])

  useEffect(() => {
    return () => {
      if (sendResetTimer) {
        clearTimeout(sendResetTimer)
      }
      if (draftAutoSaveTimerRef.current) {
        clearTimeout(draftAutoSaveTimerRef.current)
      }
    }
  }, [sendResetTimer])

  // Close link dialog on outside click
  useEffect(() => {
    if (!linkInputOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (linkDialogRef.current && !linkDialogRef.current.contains(e.target as Node)) {
        setLinkInputOpen(false)
        setLinkInputValue("")
        setLinkTextValue("")
        setLinkDialogPosition(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [linkInputOpen])

  // Autosave draft HTML and state to localStorage
  useEffect(() => {
    if (!emailId || !draftHtml || !showDraft) return

    if (draftAutoSaveTimerRef.current) {
      clearTimeout(draftAutoSaveTimerRef.current)
    }

    draftAutoSaveTimerRef.current = setTimeout(() => {
      try {
        setAutoSaving(true)
        // Save full draft state including showDraft flag and draftId
        localStorage.setItem(`draft_${emailId}`, JSON.stringify({
          html: draftHtml,
          text: draftText,
          draftId: draftId,
          showDraft: true
        }))
        setTimeout(() => setAutoSaving(false), 500)
      } catch {
        // Ignore localStorage errors
      }
    }, 1000)

    return () => {
      if (draftAutoSaveTimerRef.current) {
        clearTimeout(draftAutoSaveTimerRef.current)
      }
    }
  }, [draftHtml, emailId, showDraft])

  const latestRequestRef = useRef(0)
  const prevEmailIdRef = useRef<string | null>(null)
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (emailId) {
      // CRITICAL: Clean up previous request and timers when switching emails
      // Only clear state and timers if switching to a different email
      const isDifferentEmail = prevEmailIdRef.current !== emailId

      if (isDifferentEmail) {
        // CRITICAL: Clean up previous request and timers only when switching emails
        if (abortControllerRef.current) {
          abortControllerRef.current.abort()
        }
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current)
        }

        prevEmailIdRef.current = emailId
        // PERFORMANCE: If we have full body content, set loading=false IMMEDIATELY
        // This prevents the loading skeleton from flashing when data is already available
        const hasFullBody = initialEmailData && initialEmailData.body && initialEmailData.body.length > (initialEmailData.snippet?.length || 0)
        if (hasFullBody) {
          setLoading(false)
          setEmailSummary({
            id: emailId,
            threadId: initialEmailData.threadId,
            subject: initialEmailData.subject || '',
            from: initialEmailData.from || '',
            to: initialEmailData.to || '',
            date: initialEmailData.date || '',
            body: initialEmailData.body || '',
            snippet: initialEmailData.snippet,
            attachments: initialEmailData.attachments,
          })
          setThreadMessages([{
            id: emailId,
            threadId: initialEmailData.threadId,
            subject: initialEmailData.subject || '',
            from: initialEmailData.from || '',
            to: initialEmailData.to || '',
            date: initialEmailData.date || '',
            body: initialEmailData.body || '',
            snippet: initialEmailData.snippet,
            attachments: initialEmailData.attachments,
          }])
        }

        // Trigger smooth fade transition
        setIsTransitioning(true)

        // Brief delay to allow fade-out effect
        transitionTimeoutRef.current = setTimeout(() => {
          setLoadingFullContent(false)

          // If we already set the data above, skip re-setting it
          if (hasFullBody) {
            // Already handled above - just reset UI state
          } else if (initialEmailData) {
            // We only have snippet, set it and show loading state while fetching full content
            setLoading(true)
            setEmailSummary({
              id: emailId,
              threadId: initialEmailData.threadId,
              subject: initialEmailData.subject || '',
              from: initialEmailData.from || '',
              to: initialEmailData.to || '',
              date: initialEmailData.date || '',
              body: initialEmailData.body || initialEmailData.snippet || '',
              snippet: initialEmailData.snippet,
              attachments: initialEmailData.attachments,
            })
            setThreadMessages([{
              id: emailId,
              threadId: initialEmailData.threadId,
              subject: initialEmailData.subject || '',
              from: initialEmailData.from || '',
              to: initialEmailData.to || '',
              date: initialEmailData.date || '',
              body: initialEmailData.body || initialEmailData.snippet || '',
              snippet: initialEmailData.snippet,
              attachments: initialEmailData.attachments,
            }])
          } else {
            // No initial data, clear everything and show loading
            setLoading(true)
            setThreadMessages([])
            setEmailSummary(null)
          }

          // Reset draft/UI state whenever user selects a new email
          setShowDraft(false)
          setDraftMinimized(false)
          setDraftText("")
          setDraftHtml("")
          setDraftId(null)
          setCopied(false)
          setGenerating(false)
          setError(null)
          setConversationSummary("")
          setSummaryExpanded(false)

          // End transition after content loads
          setIsTransitioning(false)
        }, 100) // Match fade-out animation duration
      }

      // Try to load autosaved draft from localStorage
      // Always try to restore draft, whether it's the same email or a different one
      // This handles the case where user collapses and reopens the same email
      try {
        const saved = localStorage.getItem(`draft_${emailId}`)
        if (saved) {
          const parsed = JSON.parse(saved)
          if (parsed?.html) {
            setDraftHtml(parsed.html)
            setDraftText(parsed.text || toPlainText(parsed.html))
            if (parsed.draftId) {
              setDraftId(parsed.draftId)
            }
            // Restore showDraft state if draft exists
            if (parsed.showDraft) {
              setShowDraft(true)
            }
          }
        }
      } catch {
        // Ignore localStorage errors
      }

      // Bump request token to guard against race conditions from rapid clicks
      latestRequestRef.current += 1
      const requestToken = latestRequestRef.current

      // Create new AbortController for this request
      abortControllerRef.current = new AbortController()

      // Fetch the email content immediately (guarded by current token)
      if (isDifferentEmail) {
        fetchThread(requestToken, abortControllerRef.current.signal)
      }
    }

    // Cleanup function
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current)
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [emailId, initialEmailData])

  const fetchThread = async (requestToken?: number, signal?: AbortSignal) => {
    try {
      setError(null)

      // PERFORMANCE: Use force-cache to leverage browser cache from prefetch
      // This makes email loading instant if it was prefetched
      const emailResponse = await fetch(`/api/emails/${emailId}`, {
        cache: 'force-cache',
        signal
      })

      // Check if request was aborted
      if (signal?.aborted) return

      if (!emailResponse.ok) {
        throw new Error('Failed to fetch email')
      }

      const emailData = await emailResponse.json()
      const email: EmailSummary = emailData.email
      // If user switched emails, abort applying this result
      if (requestToken && requestToken !== latestRequestRef.current) return
      if (signal?.aborted) return

      // Update email summary with full data
      setEmailSummary(email)
      setLoading(false) // Content is ready to display

      // Now fetch the thread using the threadId
      const threadId = email.threadId || emailId
      const threadResponse = await fetch(`/api/emails/threads/${encodeURIComponent(threadId)}`, {
        signal
      })

      // Check if request was aborted
      if (signal?.aborted) return

      if (threadResponse.ok) {
        const threadData = await threadResponse.json()
        // Fix: thread data is nested under 'thread' key from API
        const thread: EmailMessage[] = threadData.thread?.messages || threadData.messages || []
        if (requestToken && requestToken !== latestRequestRef.current) return
        if (signal?.aborted) return

        if (thread.length > 0) {
          setThreadMessages(thread)
        } else {
          // If no thread, show the single email with attachments
          setThreadMessages([{
            id: email.id,
            threadId: email.threadId,
            subject: email.subject,
            from: email.from,
            to: email.to,
            date: email.date,
            body: email.body,
            snippet: email.snippet,
            labels: email.labels,
            attachments: email.attachments,
          }])
        }
      } else {
        // Thread fetch failed, show single email with attachments
        if (requestToken && requestToken !== latestRequestRef.current) return
        if (signal?.aborted) return
        setThreadMessages([{
          id: email.id,
          threadId: email.threadId,
          subject: email.subject,
          from: email.from,
          to: email.to,
          date: email.date,
          body: email.body,
          snippet: email.snippet,
          labels: email.labels,
          attachments: email.attachments,
        }])
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      console.error('Error fetching email:', err)
      setError(err instanceof Error ? err.message : 'Failed to load email')
      setLoading(false)
    } finally {
      setLoadingFullContent(false)
    }
  }

  const handleGenerateDraft = async () => {
    if (!emailId) return

    try {
      setGenerating(true)
      setError(null)
      const response = await fetch(`/api/emails/${emailId}/draft`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to generate draft')
      }

      const data = await response.json()
      const regenerated = data.draft || ''
      setDraftText(regenerated)
      setDraftHtml(textToHtml(regenerated))
      setDraftId(data.draftId || null)
      setShowDraft(true)

      // Immediately save to localStorage so it persists when reopening
      if (emailId) {
        try {
          localStorage.setItem(`draft_${emailId}`, JSON.stringify({
            html: textToHtml(regenerated),
            text: regenerated,
            draftId: data.draftId || null,
            showDraft: true
          }))
        } catch {
          // Ignore localStorage errors
        }
      }

      onDraftGenerated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate draft')
      console.error('Error generating draft:', err)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopy = () => {
    const text = draftHtml ? toPlainText(draftHtml) : draftText
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRegenerate = async () => {
    if (!emailId) return

    try {
      setGenerating(true)
      setError(null)
      const response = await fetch(`/api/emails/${emailId}/draft?regenerate=true`, {
        method: 'POST'
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to regenerate draft')
      }

      const data = await response.json()
      const regenerated = data.draft || ''
      // Replace entire draft: both text and HTML, regardless of current edits
      setDraftHtml(textToHtml(regenerated))
      setDraftText(regenerated)
      setDraftId(data.draftId || null)
      setShowDraft(true)

      // Immediately save to localStorage so it persists when reopening
      if (emailId) {
        try {
          localStorage.setItem(`draft_${emailId}`, JSON.stringify({
            html: textToHtml(regenerated),
            text: regenerated,
            draftId: data.draftId || null,
            showDraft: true
          }))
        } catch {
          // Ignore localStorage errors
        }
      }

      onDraftGenerated?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate draft')
      console.error('Error regenerating draft:', err)
    } finally {
      setGenerating(false)
    }
  }

  const handleSendReply = async (opts?: { closeTicket?: boolean }) => {
    if (!emailId) return
    if (sending) return // Prevent double-submit

    // Get HTML from either:
    // 1. Explicitly set draftHtml (if available)
    // 2. Editor's innerHTML (if user edited in editor)
    // 3. Convert draftText to HTML (if AI generated plain text)
    let htmlValue = draftHtml || editorRef.current?.innerHTML || ""

    // If no HTML but we have plain text, convert it to HTML
    if (!htmlValue && draftText) {
      htmlValue = textToHtml(draftText)
    }

    const textValue = draftText || toPlainText(htmlValue)

    if (!textValue.trim() && !htmlValue.trim()) {
      setError("Draft is empty. Please edit it before sending.")
      return
    }

    setSendSuccess(false)

    try {
      setSending(true)
      setSendingAction(opts?.closeTicket ? 'send-close' : 'send')
      setError(null)

      const response = await fetch(`/api/emails/${emailId}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          draftText: textValue,
          draftHtml: htmlValue,
          draftId: draftId || null,
          attachments: attachments.map(att => ({ filename: att.name, mimeType: att.type, data: att.data })),
        }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Failed to send reply")
      }

      setSendSuccess(true)

      // Add sent message to thread immediately (optimistic UI update)
      // Get the user's email from the first message's 'to' field (since it was sent to us)
      const userEmail = threadMessages[0]?.to || emailSummary?.to || 'You'
      const newMessage: EmailMessage = {
        id: `sent-${Date.now()}`,
        threadId: emailSummary?.threadId,
        subject: emailSummary?.subject || '(No subject)',
        from: userEmail, // Your email
        to: emailSummary?.from || '', // Recipient
        date: new Date().toISOString(),
        body: htmlValue,
        snippet: textValue.substring(0, 100)
      }
      setThreadMessages(prev => [...prev, newMessage])

      // Clear draft UI and autosaved data after successful send
      try {
        localStorage.removeItem(`draft_${emailId}`)
      } catch {
        // Ignore localStorage errors
      }
      setDraftText("")
      setDraftHtml("")
      setDraftId(null)
      setShowDraft(false)
      setDraftMinimized(false)

      if (sendResetTimer) {
        clearTimeout(sendResetTimer)
      }
      setSendResetTimer(
        setTimeout(() => {
          setSendSuccess(false)
          setSendResetTimer(null)
        }, 5000) // Show success for 5 seconds instead of 3
      )

      toast({
        title: "Reply sent",
        description: "Your reply was delivered via Gmail.",
      })

      // Use the ticketId returned from the reply API (it ensures creation) or the prop ticketId
      const activeTicketId = data?.ticketId || ticketId

      // Always assign ticket to replier if unassigned (first replier gets it)
      if (activeTicketId && currentUserId && !opts?.closeTicket) {
        try {
          // Check if ticket is already assigned, if not, assign it
          const ticketCheckResponse = await fetch(`/api/tickets/${activeTicketId}`)
          if (ticketCheckResponse.ok) {
            const ticketData = await ticketCheckResponse.json()
            const ticket = ticketData.ticket

            // Only assign if ticket is unassigned
            if (ticket && !ticket.assigneeUserId) {
              console.log('📝 Auto-assigning ticket to first replier:', activeTicketId, 'user:', currentUserId)
              const assignResponse = await fetch(`/api/tickets/${activeTicketId}/assign`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assigneeUserId: currentUserId }),
              })

              if (assignResponse.ok) {
                console.log('✅ Ticket auto-assigned to replier')
                // Broadcast event to switch to "assigned" tab
                window.dispatchEvent(new CustomEvent('ticketUpdated', {
                  detail: { ticketId: activeTicketId, assigneeUserId: currentUserId, status: 'pending', switchToTab: 'assigned' }
                }))
              }
            } else {
              // Ticket already assigned
              const assignedToCurrentUser = ticket?.assigneeUserId === currentUserId
              // If assigned to current user, switch to assigned tab
              window.dispatchEvent(new CustomEvent('ticketUpdated', {
                detail: {
                  ticketId: activeTicketId,
                  assigneeUserId: ticket?.assigneeUserId || currentUserId,
                  status: 'pending',
                  switchToTab: assignedToCurrentUser ? 'assigned' : undefined
                }
              }))
            }
          }
        } catch (assignError) {
          console.warn('⚠️ Failed to auto-assign ticket (non-critical):', assignError)
          // Still broadcast the update even if assignment fails
          window.dispatchEvent(new CustomEvent('ticketUpdated', {
            detail: { ticketId: activeTicketId, assigneeUserId: currentUserId, status: 'pending' }
          }))
        }
        window.dispatchEvent(new Event('ticketsForceRefresh'))
      }

      // If closeTicket option is set and we have a ticketId, assign and close it
      if (opts?.closeTicket && activeTicketId && currentUserId) {
        console.log('🎫 Starting Send & Close for ticket:', activeTicketId, 'user:', currentUserId)

        // Execute assign and close sequentially - wait for completion
        try {
          // Step 1: Assign the ticket
          console.log('📝 Step 1: Assigning ticket to user...')
          const assignResponse = await fetch(`/api/tickets/${activeTicketId}/assign`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assigneeUserId: currentUserId }),
          })

          console.log('📝 Assign response status:', assignResponse.status)

          if (!assignResponse.ok) {
            const error = await assignResponse.json().catch(() => ({}))
            console.error('❌ Failed to assign ticket:', error)
            throw new Error(error.error || 'Failed to assign ticket')
          }

          const assignResult = await assignResponse.json()
          console.log('✅ Ticket assigned successfully:', assignResult)

          // Step 2: Close the ticket
          console.log('🔒 Step 2: Closing ticket...')
          const closeResponse = await fetch(`/api/tickets/${activeTicketId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'closed' }),
          })

          console.log('🔒 Close response status:', closeResponse.status)

          if (!closeResponse.ok) {
            const error = await closeResponse.json().catch(() => ({}))
            console.error('❌ Failed to close ticket:', error)
            throw new Error(error.error || 'Failed to close ticket')
          }

          const closeResult = await closeResponse.json()
          console.log('✅ Ticket closed successfully:', closeResult)

          // Step 3: Broadcast event to refresh tickets page and switch to closed tab
          console.log('📢 Broadcasting ticket update event...')
          console.log('📦 Event detail:', { ticketId: activeTicketId, status: 'closed', assigneeUserId: currentUserId })
          window.dispatchEvent(new CustomEvent('ticketUpdated', {
            detail: { ticketId: activeTicketId, status: 'closed', assigneeUserId: currentUserId, switchToTab: 'closed' }
          }))
          // Also fire a simpler refresh event for listeners
          window.dispatchEvent(new Event('ticketsForceRefresh'))
          console.log('✅ Events dispatched - ticketUpdated and ticketsForceRefresh')
          console.log('✅ Send & Close completed successfully!')

          // Show success toast
          toast({
            title: "Ticket closed",
            description: "Ticket has been assigned to you and closed",
          })

        } catch (error) {
          console.error('❌ Error in Send & Close:', error)
          toast({
            title: "Ticket update failed",
            description: error instanceof Error ? error.message : "Failed to update ticket",
            variant: "destructive",
          })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send reply"
      setError(message)
      setSendSuccess(false)
      toast({
        title: "Couldn't send reply",
        description: message,
        variant: "destructive",
      })
    } finally {
      setSending(false)
      setSendingAction(null)
    }
  }

  const handleEditorInput = () => {
    const html = editorRef.current?.innerHTML || ""
    setDraftHtml(html)
    setDraftText(toPlainText(html))
  }

  const execAndSync = (fn: () => void) => {
    fn()
    handleEditorInput()
  }

  const makeListFromSelection = (ordered: boolean) => {
    if (typeof window === 'undefined' || !editorRef.current) {
      execAndSync(() => applyCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'))
      return
    }
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) {
      execAndSync(() => applyCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'))
      return
    }
    const range = sel.getRangeAt(0)
    if (range.collapsed) {
      execAndSync(() => applyCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'))
      return
    }
    // If selection spans partial text, extract and insert as its own list item
    const frag = range.extractContents()
    const list = document.createElement(ordered ? 'ol' : 'ul')
    const li = document.createElement('li')
    li.appendChild(frag)
    list.appendChild(li)
    range.insertNode(list)
    // Place caret after the inserted list
    sel.removeAllRanges()
    const after = document.createTextNode(' ')
    list.parentNode?.insertBefore(after, list.nextSibling)
    const newRange = document.createRange()
    newRange.setStartAfter(list)
    newRange.collapse(true)
    sel.addRange(newRange)
    handleEditorInput()
  }

  // Sync external HTML into the editor without breaking selection; only touch DOM when content actually changes
  // Also sync when expanding from minimized state - use a small delay to ensure DOM is ready
  useEffect(() => {
    if (!editorRef.current) return
    // If minimized, don't sync (editor is hidden)
    if (draftMinimized) return

    // Use a timeout to ensure DOM is ready when expanding from minimized state
    const timeoutId = setTimeout(() => {
      if (!editorRef.current || draftMinimized) return
      const html = draftHtml || textToHtml(draftText)
      const current = editorRef.current.innerHTML || ''
      // Only update if content differs (to avoid breaking user's cursor position)
      if (html && current.trim() !== html.trim()) {
        editorRef.current.innerHTML = html
      }
      if (!html && current.trim() !== '') {
        editorRef.current.innerHTML = ''
      }
    }, 50) // Delay to ensure DOM is ready when expanding

    return () => clearTimeout(timeoutId)
  }, [draftHtml, draftText, draftMinimized])

  const handleEditorShortcut = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); execAndSync(() => applyCommand('bold')); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); execAndSync(() => applyCommand('italic')); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') { e.preventDefault(); execAndSync(() => applyCommand('underline')); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); handleInsertLink(); return }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); execAndSync(() => document.execCommand('undo')); return }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey || e.key.toLowerCase() === 'y')) { e.preventDefault(); execAndSync(() => document.execCommand('redo')); return }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') { /* native paste as plain text in many browsers */ return }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSendReply(); return }
    // Gmail-like: Ctrl+Shift+8 bullets, Ctrl+Shift+7 numbers, Ctrl+Shift+9 quote
    if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
      const key = e.key
      if (key === '8') { e.preventDefault(); makeListFromSelection(false); return }
      if (key === '7') { e.preventDefault(); makeListFromSelection(true); return }
      if (key === '9') { e.preventDefault(); toggleBlockquote(); return }
      const lower = e.key.toLowerCase()
      if (lower === 'l') { e.preventDefault(); makeListFromSelection(false); return }
      if (lower === 'e') { e.preventDefault(); execAndSync(() => applyCommand('outdent')); return }
      if (lower === 'o') { e.preventDefault(); execAndSync(() => applyCommand('indent')); return }
      // Do not preventDefault for other Ctrl+Shift combos to allow native selection (e.g., Ctrl+Shift+Arrow)
    }
  }

  const toggleBlockquote = () => {
    if (typeof window === 'undefined') return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    const range = sel.getRangeAt(0)
    let node = range.commonAncestorContainer as Node

    // If it's a text node, get its parent element
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode as Node
    }

    // Check if we're inside a blockquote
    const inQuote = !!(node as HTMLElement).closest?.('blockquote')

    execAndSync(() => {
      if (inQuote) {
        // Remove blockquote by converting to paragraph
        applyCommand('formatBlock', 'p')
      } else {
        // Apply blockquote
        applyCommand('formatBlock', 'blockquote')
      }
    })
  }

  const toggleHeading = () => {
    if (typeof window === 'undefined') return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return

    const range = sel.getRangeAt(0)
    let node = range.commonAncestorContainer as Node

    // If it's a text node, get its parent element
    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentNode as Node
    }

    // Check if we're inside an h2
    const inHeading = !!(node as HTMLElement).closest?.('h2')

    execAndSync(() => {
      if (inHeading) {
        // Remove heading by converting to paragraph
        applyCommand('formatBlock', 'p')
      } else {
        // Apply heading
        applyCommand('formatBlock', 'h2')
      }
    })
  }

  const [savedRange, setSavedRange] = React.useState<Range | null>(null)

  const handleInsertLink = () => {
    if (typeof window === 'undefined') return

    const sel = window.getSelection()
    if (!sel) return

    // Ensure we have a range (create one at cursor if needed)
    let range: Range
    if (sel.rangeCount > 0) {
      range = sel.getRangeAt(0)
    } else {
      // Create a range at the end of the editor if no selection
      range = document.createRange()
      if (editorRef.current) {
        range.selectNodeContents(editorRef.current)
        range.collapse(false)
      }
    }

    // Save the range
    setSavedRange(range.cloneRange())

    // Get position to show dialog above it
    const rect = range.getBoundingClientRect()
    const editorRect = editorRef.current?.getBoundingClientRect()

    if (editorRect) {
      // Position dialog above the selection/cursor, relative to editor
      const topPos = rect.top - editorRect.top - 80 // 80px above
      const leftPos = rect.left - editorRect.left

      setLinkDialogPosition({
        top: Math.max(10, topPos), // Don't go above editor
        left: Math.max(10, leftPos)
      })
    }

    // Check if text is selected
    const hasSelection = !range.collapsed
    const selectedText = hasSelection ? sel.toString().trim() : ""

    setLinkTextValue(selectedText)
    setLinkHasSelection(hasSelection)
    setLinkInputOpen(true)

    setTimeout(() => {
      const el = document.getElementById('link-input-inline') as HTMLInputElement | null
      el?.focus()
    }, 50)
  }

  const applyLink = () => {
    const url = linkInputValue.trim()
    if (!url) {
      setLinkInputOpen(false)
      setLinkInputValue("")
      setLinkTextValue("")
      setSavedRange(null)
      setLinkDialogPosition(null)
      return
    }

    if (typeof window === 'undefined' || !savedRange) return

    // Focus the editor first
    editorRef.current?.focus()

    // Restore the saved selection range
    const sel = window.getSelection()
    if (sel) {
      sel.removeAllRanges()
      sel.addRange(savedRange)
    }

    setTimeout(() => {
      execAndSync(() => {
        if (linkHasSelection) {
          // If text was selected, wrap it with a link
          const link = document.createElement('a')
          link.href = url
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.textContent = linkTextValue

          const range = savedRange
          if (range) {
            range.deleteContents()
            range.insertNode(link)
            // Add space after link
            const space = document.createTextNode('\u00A0')
            if (link.parentNode) {
              link.parentNode.insertBefore(space, link.nextSibling)
              // Move cursor after the space
              range.setStartAfter(space)
              range.setEndAfter(space)
              sel?.removeAllRanges()
              sel?.addRange(range)
            }
          }
        } else {
          // No text selected, insert new link with custom or URL text
          const displayText = linkTextValue.trim() || url
          const link = document.createElement('a')
          link.href = url
          link.target = '_blank'
          link.rel = 'noopener noreferrer'
          link.textContent = displayText

          const range = savedRange
          if (range) {
            range.insertNode(link)
            // Add space after link
            const space = document.createTextNode('\u00A0')
            if (link.parentNode) {
              link.parentNode.insertBefore(space, link.nextSibling)
              // Move cursor after the space
              range.setStartAfter(space)
              range.setEndAfter(space)
              sel?.removeAllRanges()
              sel?.addRange(range)
            }
          }
        }
      })

      // Trigger input event to sync state
      handleEditorInput()
    }, 10)

    setLinkInputOpen(false)
    setLinkInputValue("")
    setLinkTextValue("")
    setSavedRange(null)
    setLinkDialogPosition(null)
  }

  const handleClearFormatting = () => {
    execAndSync(() => applyCommand('removeFormat'))
  }

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const next: { id: string; name: string; type: string; size: number; data: string }[] = []
    for (const file of Array.from(files)) {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const [, dataPart] = result.split(',')
          resolve(dataPart)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
      })
      next.push({ id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: base64 })
    }
    setAttachments(prev => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleInsertInlineImage = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = files[0]
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
    execAndSync(() => applyCommand('insertHTML', `<img src="${dataUrl}" style="max-width:100%;height:auto;" />`))
    if (imageInputRef.current) imageInputRef.current.value = ''
  }

  if (loading) {
    return (
      <div className="flex flex-col h-full overflow-hidden animate-in fade-in duration-300">
        {/* Header skeleton */}
        <div className="border-b border-border px-6 py-5 bg-card">
          <div className="h-6 bg-muted rounded w-1/3 animate-pulse mb-3" />
          <div className="h-4 bg-muted rounded w-1/4 animate-pulse" />
        </div>

        {/* Messages skeleton */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="border border-border rounded-xl p-5 bg-card">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="h-5 bg-muted rounded w-1/3 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-20 animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-full animate-pulse" />
                  <div className="h-4 bg-muted rounded w-5/6 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-4/5 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error && threadMessages.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center space-y-3">
        {onBack && (
          <Button
            onClick={onBack}
            variant="ghost"
            size="sm"
            className="md:hidden self-start -mt-2 -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        )}
        <div className="text-sm font-medium text-destructive">{error}</div>
        <Button
          onClick={() => fetchThread()}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          Retry
        </Button>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col bg-background overflow-hidden animate-in fade-in duration-300">
        {onBack && (
          <div className="md:hidden px-4 pt-3 pb-2 flex-shrink-0 bg-background border-b border-border">
            <Button
              onClick={onBack}
              variant="ghost"
              size="sm"
              className="h-8 text-xs -ml-2"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ paddingTop: '0.75rem' }}>
          <Card className="mx-4 md:mx-6 mt-4 mb-3 shadow-lg border-border relative overflow-hidden" style={{ borderRadius: '1rem' }}>
            {/* Shimmer overlay */}
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent z-10" />

            <div className="px-6 py-5 border-b border-border relative">
              <div className="space-y-3">
                <div className="h-7 bg-muted/70 rounded-md w-3/4" />
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted/70" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted/70 rounded w-1/3" />
                    <div className="h-3 bg-muted/50 rounded w-1/2" />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 space-y-4 relative">
              <div className="space-y-2">
                <div className="h-4 bg-muted/70 rounded w-full" />
                <div className="h-4 bg-muted/70 rounded w-full" />
                <div className="h-4 bg-muted/70 rounded w-5/6" />
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-muted/50 rounded w-full" />
                <div className="h-4 bg-muted/50 rounded w-4/5" />
              </div>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (threadMessages.length === 0 && !emailSummary) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <Mail className="w-12 h-12 mx-auto text-muted-foreground/40" />
          <div className="text-sm font-medium text-muted-foreground">No email selected</div>
          <p className="text-xs text-muted-foreground/70">Select an email to view the conversation</p>
        </div>
      </div>
    )
  }

  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleString()
    } catch {
      return dateString
    }
  }

  return (
    <div className={`h-full flex flex-col bg-background overflow-hidden transition-opacity duration-200 ${isTransitioning ? 'opacity-70' : 'opacity-100'}`}>
      {onBack && (
        <div className="md:hidden px-4 pt-3 pb-2 flex-shrink-0 bg-background border-b border-border animate-in fade-in slide-in-from-top-2 duration-300">
          <Button
            onClick={onBack}
            variant="ghost"
            size="sm"
            className="h-8 text-xs -ml-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </div>
      )}

      {/* Scrollable email content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden animate-in fade-in duration-300" style={{ paddingTop: '0.75rem' }}>
        <Card className="mx-4 md:mx-6 mt-4 mb-3 shadow-lg border-border animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ borderRadius: '1rem' }}>
          <div className="px-6 py-5 border-b border-border flex-shrink-0 bg-card">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h2 className="text-xl font-bold text-foreground line-clamp-2 break-words flex-1">
                {threadMessages[threadMessages.length - 1]?.subject || emailSummary?.subject || "(No subject)"}
              </h2>
              {threadMessages.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    if (!conversationSummary) {
                      setGeneratingSummary(true)
                      try {
                        // Convert HTML to plain text before sending to AI
                        const summary = threadMessages.map(m => {
                          const plainText = htmlToText(m.body || m.subject || "")
                          return `${m.from}: ${plainText.substring(0, 200)}`
                        }).join("\n\n")
                        const response = await fetch("/api/ai/summarize", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ conversation: summary })
                        })
                        if (response.ok) {
                          const data = await response.json()
                          setConversationSummary(data.summary)
                          setSummaryExpanded(true)
                        } else {
                          setConversationSummary("Unable to generate summary at this time.")
                          setSummaryExpanded(true)
                        }
                      } catch (err) {
                        setConversationSummary("Error generating summary.")
                        setSummaryExpanded(true)
                      } finally {
                        setGeneratingSummary(false)
                      }
                    } else {
                      setSummaryExpanded(!summaryExpanded)
                    }
                  }}
                  className="h-8 px-3 text-xs flex-shrink-0"
                  disabled={generatingSummary}
                >
                  {generatingSummary ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Summarizing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3 h-3 mr-1" />
                      {conversationSummary ? (summaryExpanded ? "Hide Summary" : "Show Summary") : "Summarize"}
                    </>
                  )}
                </Button>
              )}
            </div>
            {conversationSummary && summaryExpanded && (
              <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-md">
                <div className="flex items-start gap-2">
                  <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-foreground/90 leading-relaxed">
                    {conversationSummary}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
            <div className="space-y-6 max-w-full">{threadMessages.length > 0 ? (
              threadMessages.map((msg, index) => (
                <div
                  key={msg.id}
                  className="pb-6 border-b border-border last:border-b-0 last:pb-0 overflow-hidden"
                >
                  <div className="flex justify-between items-start gap-4 mb-3 min-w-0">
                    <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
                      {/* Clickable Avatar for Shopify */}
                      {onToggleShopify && (
                        <button
                          onClick={() => onToggleShopify(msg.from)}
                          className="flex-shrink-0 transition-colors duration-200 cursor-pointer group"
                          title="View Shopify customer info"
                        >
                          <Avatar className="h-10 w-10 border-2 border-border group-hover:border-primary transition-colors">
                            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                              {msg.from.split("<")[0].trim()
                                ? msg.from.split("<")[0].trim()
                                  .replace(/["'""''`]/g, "")
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")
                                  .slice(0, 2)
                                  .toUpperCase()
                                : msg.from.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        </button>
                      )}
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-2 mb-1.5 min-w-0">
                          <div className="text-sm font-semibold text-foreground truncate">
                            {msg.from.split("<")[0].trim() || msg.from}
                          </div>
                          {index === 0 && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">Original</Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          To: {msg.to.split("<")[0].trim() || msg.to}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                      {formatDate(msg.date)}
                    </div>
                  </div>
                  <div className="text-sm text-foreground/90 leading-relaxed overflow-hidden break-words">
                    {msg.body && msg.body.trim() ? (
                      <EmailContentViewer
                        content={msg.body}
                        emailId={msg.id}
                        attachments={msg.attachments}
                        className="rounded-md overflow-hidden"
                      />
                    ) : (
                      <div className="text-muted-foreground italic">
                        No content
                      </div>
                    )}

                    {/* Attachments for this specific message */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="mt-4 pt-3 border-t border-border/50">
                        <AttachmentList
                          attachments={msg.attachments.map(att => ({
                            ...att,
                            downloadUrl: `/api/emails/${msg.id}/attachments/${att.id}?filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType || 'application/octet-stream')}`
                          }))}
                          compact={false}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              // Fallback: show emailSummary if we have it but no thread messages yet
              emailSummary ? (
                <div className="pb-4 border-b border-border/50 last:border-b-0">
                  <div className="flex justify-between items-start gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="text-xs font-medium text-muted-foreground">Message</div>
                        <div className="text-xs font-semibold text-foreground truncate">
                          {emailSummary.from.split("<")[0].trim() || emailSummary.from}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        To: {emailSummary.to.split("<")[0].trim() || emailSummary.to}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                      {formatDate(emailSummary.date)}
                    </div>
                  </div>
                  <div className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed overflow-hidden" style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>
                    {emailSummary.body || emailSummary.snippet || "Loading content..."}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Loading content...</div>
              )
            )}
            </div>
          </div>
        </Card>
      </div>

      {/* Sticky action buttons at bottom */}
      <div className="flex-shrink-0 border-t border-border bg-card shadow-lg animate-in fade-in slide-in-from-bottom duration-300">
        {error && (
          <div className="mx-4 md:mx-6 mt-3 px-4 py-3 text-sm font-medium text-destructive bg-destructive/10 rounded-lg border border-destructive/20">
            {error}
          </div>
        )}

        {/* Consolidated Attachment List removed - attachments are now shown per-message */}

        <div className="mx-4 md:mx-6 py-4 space-y-3">
          {onToggleShopify && emailSummary && (
            <Button
              variant={showShopifySidebar ? "default" : "outline"}
              size="sm"
              onClick={() => onToggleShopify(emailSummary.from)}
              className="w-full gap-2"
            >
              <ShoppingBag className="w-4 h-4" />
              {showShopifySidebar ? "Hide" : "Show"} Customer Info
            </Button>
          )}
          <Button
            onClick={handleGenerateDraft}
            disabled={generating || showDraft}
            className="w-full h-11 text-base font-semibold shadow-md hover:shadow-lg"
          >
            {generating ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Generating draft...
              </>
            ) : showDraft ? (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Draft generated
              </>
            ) : (
              <>
                <Sparkles className="w-5 h-5 mr-2" />
                Generate AI draft
              </>
            )}
          </Button>
        </div>

        {showDraft && (
          <div className="mx-4 md:mx-6 mb-4 border-t border-border pt-4">
            <div className="bg-card rounded-lg shadow-lg border border-border overflow-hidden max-h-[60vh] flex flex-col">
              <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border bg-muted/50">
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  AI-Generated Draft
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraftMinimized(!draftMinimized)}
                  className="h-9 px-3 hover:bg-accent/10"
                  title={draftMinimized ? "Expand draft" : "Minimize draft"}
                >
                  {draftMinimized ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                </Button>
              </div>
              {draftMinimized ? (
                <div className="text-sm text-muted-foreground italic py-4 px-6 bg-muted/30">
                  Draft minimized - click to expand
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1 items-center bg-muted/40 border border-border rounded-lg px-2 py-1.5">
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('bold'))} aria-label="Bold"><Bold className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('italic'))} aria-label="Italic"><Italic className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('underline'))} aria-label="Underline"><Underline className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('strikeThrough'))} aria-label="Strikethrough"><Strikethrough className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={toggleHeading} aria-label="Heading"><Type className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('hiliteColor', '#fef08a'))} aria-label="Highlight"><Highlighter className="w-3.5 h-3.5 text-amber-500" /></button>

                      <div className="w-px h-5 bg-border mx-0.5" />

                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => makeListFromSelection(false)} aria-label="Bullet list"><List className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => makeListFromSelection(true)} aria-label="Numbered list"><ListOrdered className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={toggleBlockquote} aria-label="Quote"><Quote className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('justifyLeft'))} aria-label="Align left"><AlignLeft className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('justifyCenter'))} aria-label="Align center"><AlignCenter className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('justifyRight'))} aria-label="Align right"><AlignRight className="w-3.5 h-3.5" /></button>

                      <div className="w-px h-5 bg-border mx-0.5" />

                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={handleInsertLink} aria-label="Insert link"><LinkIcon className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => execAndSync(() => applyCommand('insertHTML', '<code></code>'))} aria-label="Inline code"><Code className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => imageInputRef.current?.click()} aria-label="Inline image"><ImageIcon className="w-3.5 h-3.5" /></button>
                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-accent" onClick={() => fileInputRef.current?.click()} aria-label="Attach file"><Paperclip className="w-3.5 h-3.5" /></button>

                      <div className="w-px h-5 bg-border mx-0.5" />

                      <button type="button" onMouseDown={(e) => e.preventDefault()} className="h-7 px-2.5 inline-flex items-center justify-center rounded hover:bg-accent text-xs font-medium" onClick={handleClearFormatting} aria-label="Clear formatting">Clear</button>
                    </div>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleAttachFiles(e.target.files)} />
                    <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleInsertInlineImage(e.target.files)} />
                    <div className="relative">
                      {linkInputOpen && linkDialogPosition && (
                        <div
                          ref={linkDialogRef}
                          className="absolute z-50 bg-popover border border-border rounded-md p-1.5 shadow-md text-xs"
                          style={{
                            top: `${linkDialogPosition.top}px`,
                            left: `${linkDialogPosition.left}px`,
                            minWidth: '280px',
                            maxWidth: '320px'
                          }}
                        >
                          <div className="space-y-1">
                            {linkHasSelection && linkTextValue && (
                              <div className="text-[9px] text-muted-foreground px-1 pb-0.5">
                                <span className="font-medium">Selected:</span> "{linkTextValue}"
                              </div>
                            )}
                            <Input
                              id="link-input-inline"
                              value={linkInputValue}
                              onChange={(e) => setLinkInputValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && linkInputValue.trim()) {
                                  e.preventDefault()
                                  applyLink()
                                } else if (e.key === 'Escape') {
                                  setLinkInputOpen(false)
                                  setLinkInputValue("")
                                  setLinkTextValue("")
                                  setLinkDialogPosition(null)
                                }
                              }}
                              placeholder="URL"
                              className="h-7 text-xs px-2"
                            />
                            {!linkHasSelection && (
                              <Input
                                id="link-text-inline"
                                value={linkTextValue}
                                onChange={(e) => setLinkTextValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && linkInputValue.trim()) {
                                    e.preventDefault()
                                    applyLink()
                                  } else if (e.key === 'Escape') {
                                    setLinkInputOpen(false)
                                    setLinkInputValue("")
                                    setLinkTextValue("")
                                    setLinkDialogPosition(null)
                                  }
                                }}
                                placeholder="Text (optional)"
                                className="h-7 text-xs px-2"
                              />
                            )}
                            <div className="flex items-center gap-1">
                              <Button size="sm" onClick={applyLink} disabled={!linkInputValue.trim()} className="flex-1 h-6 text-[11px] px-2">
                                Insert
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => { setLinkInputOpen(false); setLinkInputValue(""); setLinkTextValue(""); setLinkDialogPosition(null) }} className="h-6 text-[11px] px-2">
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                      <div
                        ref={editorRef}
                        contentEditable
                        suppressContentEditableWarning
                        onClick={(e) => {
                          // Clear selection when clicking on empty area (not on text)
                          const target = e.target as HTMLElement
                          if (target === editorRef.current) {
                            const sel = window.getSelection()
                            sel?.removeAllRanges()
                          }
                        }}
                        onInput={handleEditorInput}
                        onPaste={(e) => {
                          e.preventDefault()
                          const text = e.clipboardData.getData('text/plain')
                          execAndSync(() => {
                            if (!document.execCommand('insertText', false, text)) {
                              document.execCommand('insertHTML', false, text)
                            }
                          })
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setDraftMinimized(true)
                            e.preventDefault()
                          }
                          if ((e.key === 'Backspace' || e.key === 'Delete') && typeof window !== 'undefined') {
                            const sel = window.getSelection()
                            const node = sel?.anchorNode as HTMLElement | null
                            const img = node?.nodeType === 1 ? (node as HTMLElement).closest('img') : node?.parentElement?.closest('img')
                            if (img) {
                              e.preventDefault()
                              execAndSync(() => img.remove())
                              return
                            }
                          }
                          handleEditorShortcut(e)
                        }}
                        className="w-full min-h-[200px] max-h-[300px] overflow-y-auto p-4 border-2 border-border rounded-xl bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-all duration-200 prose prose-sm max-w-none prose-img:max-w-full prose-img:max-h-96"
                        aria-label="Email draft editor"
                      />
                      {autoSaving && (
                        <div className="text-xs text-muted-foreground bg-background/90 px-2 py-1 rounded shadow-sm border border-border absolute top-3 right-3 pointer-events-none select-none">
                          Saving...
                        </div>
                      )}
                      {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                          {attachments.map(att => (
                            <div key={att.id} className="flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/40">
                              <Paperclip className="w-3 h-3" />
                              <span>{att.name}</span>
                              <button type="button" onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))} className="text-xs text-foreground hover:text-destructive">✕</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {!draftMinimized && (
                      <div className="space-y-3 pt-4 border-t border-border">
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handleSendReply()}
                            disabled={sending || sendSuccess}
                            className={`flex-1 h-10 text-sm font-semibold shadow-md transition-all duration-300 ease-out hover:shadow-lg disabled:cursor-not-allowed ${sendSuccess
                              ? "bg-green-600 text-white hover:bg-green-600"
                              : "disabled:opacity-50"
                              }`}
                          >
                            {sendingAction === 'send' ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Sending...
                              </>
                            ) : sendSuccess ? (
                              "✓ Reply sent!"
                            ) : (
                              "Send Reply"
                            )}
                          </Button>
                          {ticketId && !hideCloseButton && (
                            <Button
                              variant="secondary"
                              onClick={() => handleSendReply({ closeTicket: true })}
                              disabled={sending || sendSuccess}
                              className="flex-1 h-10 text-sm font-semibold shadow-md transition-all duration-300 ease-out hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {sendingAction === 'send-close' ? (
                                <>
                                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                  Sending...
                                </>
                              ) : sendSuccess ? (
                                "✓ Sent & Closed!"
                              ) : (
                                "Send & Close"
                              )}
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <Button
                            onClick={handleCopy}
                            variant="outline"
                            className="h-10 text-sm font-medium hover:bg-accent/10 hover:border-primary/50 transition-all duration-200"
                          >
                            {copied ? "✓ Copied!" : "Copy Draft"}
                          </Button>
                          <Button
                            onClick={handleRegenerate}
                            variant="outline"
                            disabled={generating}
                            className="h-10 text-sm font-medium hover:bg-accent/10 hover:border-primary/50 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {generating ? "Regenerating..." : "Regenerate"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
