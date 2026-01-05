"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Paperclip, Download, FileText, Image, File, FileVideo, FileArchive, Loader2 } from "lucide-react"

export interface AttachmentInfo {
    id: string
    filename: string
    mimeType: string
    size?: number
    downloadUrl?: string
}

interface AttachmentListProps {
    attachments: AttachmentInfo[]
    onDownload?: (attachment: AttachmentInfo) => void
    className?: string
    compact?: boolean
}

// Get appropriate icon for file type
function getFileIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return Image
    if (mimeType.startsWith('video/')) return FileVideo
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text/')) return FileText
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('compressed')) return FileArchive
    return File
}

// Format file size
function formatSize(bytes?: number): string {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Get file extension color
function getExtensionColor(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    const colorMap: Record<string, string> = {
        pdf: 'bg-red-500/10 text-red-600 dark:text-red-400',
        doc: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        docx: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        xls: 'bg-green-500/10 text-green-600 dark:text-green-400',
        xlsx: 'bg-green-500/10 text-green-600 dark:text-green-400',
        ppt: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
        pptx: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
        jpg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
        jpeg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
        png: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
        gif: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
        mp4: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
        zip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        rar: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    }
    return colorMap[ext] || 'bg-muted text-muted-foreground'
}

export function AttachmentList({
    attachments,
    onDownload,
    className = "",
    compact = false
}: AttachmentListProps) {
    const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
    const [downloading, setDownloading] = useState<Record<string, boolean>>({})

    if (!attachments || attachments.length === 0) return null

    const handleDownload = async (att: AttachmentInfo) => {
        if (onDownload) {
            onDownload(att)
            return
        }
        
        if (att.downloadUrl) {
            // For data URLs or simple downloads, just trigger immediately
            if (att.downloadUrl.startsWith('data:')) {
                const link = document.createElement('a')
                link.href = att.downloadUrl
                link.download = att.filename
                link.target = '_blank'
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                return
            }

            // For API downloads, show progress
            setDownloading(prev => ({ ...prev, [att.id]: true }))
            setDownloadProgress(prev => ({ ...prev, [att.id]: 0 }))

            try {
                const response = await fetch(att.downloadUrl)
                if (!response.ok) throw new Error('Download failed')

                const contentLength = response.headers.get('content-length')
                const total = contentLength ? parseInt(contentLength, 10) : att.size || 0

                const reader = response.body?.getReader()
                if (!reader) throw new Error('No reader available')

                const chunks: Uint8Array[] = []
                let receivedLength = 0

                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break

                    chunks.push(value)
                    receivedLength += value.length

                    if (total > 0) {
                        const progress = (receivedLength / total) * 100
                        setDownloadProgress(prev => ({ ...prev, [att.id]: progress }))
                    }
                }

                // Create blob and download
                const blob = new Blob(chunks, { type: att.mimeType })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = att.filename
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)

                setDownloadProgress(prev => ({ ...prev, [att.id]: 100 }))
                setTimeout(() => {
                    setDownloading(prev => ({ ...prev, [att.id]: false }))
                    setDownloadProgress(prev => ({ ...prev, [att.id]: 0 }))
                }, 1000)
            } catch (error) {
                console.error('Download error:', error)
                setDownloading(prev => ({ ...prev, [att.id]: false }))
                setDownloadProgress(prev => ({ ...prev, [att.id]: 0 }))
            }
        }
    }

    if (compact) {
        return (
            <div className={`flex flex-wrap gap-2 ${className}`}>
                {attachments.map((att) => {
                    const Icon = getFileIcon(att.mimeType)
                    const isDownloading = downloading[att.id]
                    const progress = downloadProgress[att.id] || 0
                    
                    return (
                        <button
                            key={att.id}
                            onClick={() => handleDownload(att)}
                            disabled={isDownloading}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted/60 hover:bg-muted border border-border/50 transition-all duration-200 hover:scale-[1.02] hover:shadow-sm group disabled:opacity-70 disabled:cursor-wait"
                            title={`Download ${att.filename}${att.size ? ` (${formatSize(att.size)})` : ''}`}
                        >
                            {isDownloading ? (
                                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                            ) : (
                                <Icon className="w-3 h-3 text-muted-foreground group-hover:text-foreground transition-colors" />
                            )}
                            <span className="max-w-[120px] truncate">{att.filename}</span>
                            {isDownloading ? (
                                <span className="text-[10px] text-primary font-semibold">{Math.round(progress)}%</span>
                            ) : (
                                <Download className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                            )}
                        </button>
                    )
                })}
            </div>
        )
    }

    return (
        <div className={`space-y-2 ${className}`}>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Paperclip className="w-4 h-4" />
                <span>Attachments ({attachments.length})</span>
            </div>
            <div className="grid gap-2">
                {attachments.map((att) => {
                    const Icon = getFileIcon(att.mimeType)
                    const ext = att.filename.split('.').pop()?.toUpperCase() || 'FILE'
                    const colorClass = getExtensionColor(att.filename)

                    const isDownloading = downloading[att.id]
                    const progress = downloadProgress[att.id] || 0

                    return (
                        <div
                            key={att.id}
                            className="flex flex-col gap-2 p-3 rounded-lg border border-border/60 bg-card hover:bg-muted/50 transition-all duration-200 group hover:shadow-sm"
                        >
                            <div className="flex items-center gap-3">
                                {/* File type badge */}
                                <div className={`flex items-center justify-center w-10 h-10 rounded-lg ${colorClass} transition-transform duration-200 group-hover:scale-105`}>
                                    {isDownloading ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <Icon className="w-5 h-5" />
                                    )}
                                </div>

                                {/* File info */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate text-foreground group-hover:text-primary transition-colors">
                                        {att.filename}
                                    </p>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className="font-medium">{ext}</span>
                                        {att.size && (
                                            <>
                                                <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                                                <span>{formatSize(att.size)}</span>
                                            </>
                                        )}
                                        {isDownloading && (
                                            <>
                                                <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                                                <span className="text-primary font-semibold">{Math.round(progress)}%</span>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Download button */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleDownload(att)}
                                    disabled={isDownloading}
                                    className="h-8 w-8 p-0 opacity-70 hover:opacity-100 hover:bg-primary/10 hover:text-primary transition-all duration-200 hover:scale-110 disabled:opacity-50 disabled:cursor-wait"
                                    title={`Download ${att.filename}`}
                                >
                                    {isDownloading ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <Download className="w-4 h-4" />
                                    )}
                                </Button>
                            </div>
                            
                            {/* Progress bar */}
                            {isDownloading && (
                                <Progress value={progress} className="h-1" />
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

// Simple indicator for email list showing attachment count
export function AttachmentIndicator({ count }: { count: number }) {
    if (count === 0) return null

    return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground" title={`${count} attachment${count > 1 ? 's' : ''}`}>
            <Paperclip className="w-3 h-3" />
            {count > 1 && <span>{count}</span>}
        </div>
    )
}
