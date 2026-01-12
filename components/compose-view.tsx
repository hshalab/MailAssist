"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, Sparkles, Send, CheckCircle, RotateCcw, X } from "lucide-react"
import RichTextEditor from "@/components/rich-text-editor"

interface ComposeViewProps {
  currentUserId: string | null
  onEmailSent?: () => void
  setActiveView?: (view: 'inbox' | 'sent' | 'spam' | 'trash' | 'drafts' | 'compose' | 'settings' | 'users' | 'tickets' | 'ai-settings' | 'quick-replies' | 'analytics') => void
}

export default function ComposeView({ currentUserId, onEmailSent, setActiveView }: ComposeViewProps) {
  const { toast } = useToast()
  const [composeMode, setComposeMode] = useState<'manual' | 'ai'>('manual')
  const [recipient, setRecipient] = useState("")
  const [recipientName, setRecipientName] = useState("")
  const [subject, setSubject] = useState("")
  const [bodyHtml, setBodyHtml] = useState("")
  const [bodyText, setBodyText] = useState("")
  const [attachments, setAttachments] = useState<{ id: string; name: string; size: number; type: string; data: string }[]>([])
  const [context, setContext] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [sentTicketId, setSentTicketId] = useState<string | null>(null)
  
  const resetForm = () => {
    setRecipient("")
    setRecipientName("")
    setSubject("")
    setBodyHtml("")
    setBodyText("")
    setAttachments([])
    setContext("")
    setError(null)
    setSuccess(null)
    setShowSuccess(false)
    setSentTicketId(null)
  }

  const handleGenerateDraft = async () => {
    if (!recipient.trim() || !subject.trim() || !context.trim()) {
      setError("Please fill in recipient, subject, and context")
      return
    }

    setIsGenerating(true)
    setError(null)

    try {
      const response = await fetch("/api/compose/generate-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientEmail: recipient.trim(),
          recipientName: recipientName.trim() || null,
          subject: subject.trim(),
          context: context.trim(),
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        const errorMessage = errorData.error || errorData.details || "Failed to generate draft"
        throw new Error(errorMessage)
      }

      const data = await response.json()
      // Convert plain text to HTML with paragraph tags and line breaks
      const htmlDraft = data.draft
        .split('\n\n')
        .map((para: string) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
        .join('')
      setBodyHtml(htmlDraft)
      setBodyText(data.draft)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to generate draft"
      setError(errorMessage)
      toast({ 
        title: "Draft Generation Failed", 
        description: errorMessage, 
        variant: "destructive" 
      })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSendEmail = async () => {
    if (!recipient.trim() || !subject.trim() || !bodyHtml.trim()) {
      setError("Please fill in recipient, subject, and message body")
      return
    }

    setIsSending(true)
    setError(null)

    try {
      // Ensure we have plain text version (for email clients that don't support HTML)
      const plainTextBody = bodyText.trim() || bodyHtml.replace(/<[^>]+>/g, '').trim()
      
      const response = await fetch("/api/compose/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recipientEmail: recipient.trim(),
          recipientName: recipientName.trim() || null,
          subject: subject.trim(),
          body: plainTextBody,
          bodyHtml: bodyHtml.trim(),
          attachments: attachments,
        }),
      })

      if (!response.ok) {
        if (response.status === 207) {
          // Partial success - email may have been sent
          const errorData = await response.json()
          setSuccess(errorData.error || "Email may have been sent but connection was interrupted. Please check your sent folder.")
          // Don't reset form for partial success
          return
        }
        const errorData = await response.json()
        throw new Error(errorData.error || "Failed to send email")
      }

      const data = await response.json()
      
      if (data.partialSuccess) {
        setSuccess(data.message || "Email may have been sent but encountered issues. Please check your sent folder and refresh tickets.")
        setSentTicketId(data.ticketId || null)
        setShowSuccess(true)
      } else {
        setSentTicketId(data.ticketId || null)
        setShowSuccess(true)
      }

      onEmailSent?.()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to send email"
      setError(errorMessage)
      toast({ 
        title: "Send Failed", 
        description: errorMessage, 
        variant: "destructive" 
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-background">
      <div className="p-6 md:p-8 lg:p-10 space-y-8 max-w-5xl mx-auto">
        {showSuccess ? (
          <Card className="p-10 text-center space-y-8 bg-emerald-50 dark:bg-emerald-950/30 border-2 border-emerald-500/30 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-transparent to-transparent" />
            <div className="relative flex justify-center">
              <div className="rounded-3xl bg-emerald-500/20 p-6 backdrop-blur-sm ring-2 ring-emerald-500/40 shadow-xl">
                <CheckCircle className="h-16 w-16 text-emerald-600 dark:text-emerald-400" />
              </div>
            </div>
            <div className="relative space-y-4">
              <h2 className="text-3xl font-bold text-foreground">Email sent successfully!</h2>
              {sentTicketId && (
                <p className="text-lg text-foreground/90">
                  Ticket #{sentTicketId} has been created and assigned to you.
                </p>
              )}
              <p className="text-base text-muted-foreground">
                You can track its progress in the tickets section.
              </p>
            </div>
            <div className="relative flex justify-center gap-4">
              <Button onClick={resetForm} variant="outline" size="lg" className="shadow-md hover:shadow-lg">
                <RotateCcw className="mr-2 h-5 w-5" />
                Compose another
              </Button>
              <Button onClick={() => setActiveView?.('tickets')} size="lg" className="shadow-md hover:shadow-lg">
                View tickets
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shadow-sm border border-primary/20">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-foreground tracking-tight">
                    Compose email
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Draft with focus, then polish. No glitter.
                  </p>
                </div>
              </div>
            </div>

            {error && (
              <Alert variant="destructive" className="shadow-lg border-2">
                <AlertDescription className="text-base font-semibold">
                  {error}
                </AlertDescription>
              </Alert>
            )}

            {success && !showSuccess && (
              <Alert className="border-2 border-blue-500/30 bg-blue-50 dark:bg-blue-950/30 shadow-lg">
                <AlertDescription className="text-base font-semibold text-foreground">
                  {success}
                </AlertDescription>
              </Alert>
            )}

            <Card className="p-8 space-y-6 shadow-lg border border-border/60 bg-card/90 backdrop-blur-sm">
              {/* Mode Toggle */}
              <div className="flex gap-2 p-1 bg-muted/50 rounded-lg w-fit">
                <Button
                  variant={composeMode === 'manual' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setComposeMode('manual')}
                  className="h-8"
                >
                  Manual
                </Button>
                <Button
                  variant={composeMode === 'ai' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setComposeMode('ai')}
                  className="h-8"
                >
                  <Sparkles className="w-3 h-3 mr-1.5" />
                  AI Assist
                </Button>
              </div>

              {/* Email Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="recipient" className="text-sm font-medium flex items-center gap-1.5">
                    Recipient email <span className="text-[var(--status-urgent)]">*</span>
                  </Label>
                  <Input
                    id="recipient"
                    type="email"
                    placeholder="customer@example.com"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="recipientName" className="text-sm font-medium">
                    Recipient name
                  </Label>
                  <Input
                    id="recipientName"
                    placeholder="John Doe"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    className="transition-all focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="subject" className="text-sm font-medium flex items-center gap-1.5">
                  Subject <span className="text-[var(--status-urgent)]">*</span>
                </Label>
                <Input
                  id="subject"
                  placeholder="Email subject line"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="transition-all focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* AI Mode: Context Input */}
              {composeMode === 'ai' && (
                <div className="space-y-2">
                  <Label htmlFor="context" className="text-sm font-medium flex items-center gap-1.5">
                    Context for AI <span className="text-[var(--status-urgent)]">*</span>
                  </Label>
                  <Textarea
                    id="context"
                    placeholder="Describe the purpose of this email, what you want to achieve, and any specific details..."
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    rows={5}
                    className="resize-none transition-all focus:ring-2 focus:ring-primary/20"
                  />
                  <p className="text-xs text-muted-foreground">
                    Be specific about the recipient's situation and your goals.
                  </p>
                </div>
              )}

              {/* Manual Mode or After AI Generation: Rich Text Editor */}
              {(composeMode === 'manual' || bodyHtml) && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    Message <span className="text-[var(--status-urgent)]">*</span>
                  </Label>
                  <RichTextEditor
                    value={bodyHtml}
                    onChange={(html, text) => {
                      setBodyHtml(html)
                      setBodyText(text)
                    }}
                    onAttachments={setAttachments}
                    placeholder="Type your message..."
                    minHeight={attachments.length > 0 ? "180px" : "250px"}
                    className="transition-all focus:ring-2 focus:ring-primary/20"
                  />
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2 max-h-24 overflow-y-auto">
                      {attachments.map((att) => (
                        <div key={att.id} className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md text-sm border">
                          <span className="text-muted-foreground truncate max-w-[200px]">{att.name}</span>
                          <span className="text-xs text-muted-foreground">({(att.size / 1024).toFixed(1)}KB)</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 w-5 p-0 hover:bg-destructive/10"
                            onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-6 mt-6 border-t border-border/30">
                {composeMode === 'ai' && !bodyHtml && (
                  <Button
                    onClick={handleGenerateDraft}
                    disabled={isGenerating || !recipient.trim() || !subject.trim() || !context.trim()}
                    size="lg"
                    className="bg-gradient-to-r from-[var(--ai-gradient-from)] to-[var(--ai-gradient-to)] hover:shadow-lg hover:scale-105 transition-all duration-200 shadow-md"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating draft...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Generate draft
                      </>
                    )}
                  </Button>
                )}
                {(composeMode === 'manual' || bodyHtml) && (
                  <Button
                    onClick={handleSendEmail}
                    disabled={isSending || !bodyHtml.trim() || !recipient.trim() || !subject.trim()}
                    size="lg"
                    className="bg-[var(--status-success)] hover:bg-[var(--status-success)]/90 hover:shadow-lg hover:scale-105 transition-all duration-200 shadow-md"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Send email & create ticket
                      </>
                    )}
                  </Button>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}