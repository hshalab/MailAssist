import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { EmailProvider, FetchOptions, OutboundEmail, UserProfile } from './email-provider';
import { StoredEmail } from './storage';

export interface ImapConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
}

export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
}

export class GenericEmailProvider implements EmailProvider {
    private imapConfig: ImapConfig;
    private smtpConfig: SmtpConfig;

    constructor(imapConfig: ImapConfig, smtpConfig: SmtpConfig) {
        this.imapConfig = imapConfig;
        this.smtpConfig = smtpConfig;
    }

    private async getImapClient() {
        const client = new ImapFlow({
            host: this.imapConfig.host,
            port: this.imapConfig.port,
            secure: this.imapConfig.secure,
            auth: this.imapConfig.auth,
            logger: false,
        });
        await client.connect();
        return client;
    }

    private getSmtpTransporter() {
        return nodemailer.createTransport({
            host: this.smtpConfig.host,
            port: this.smtpConfig.port,
            secure: this.smtpConfig.secure,
            auth: this.smtpConfig.auth,
        });
    }

    async verifyConnection(): Promise<boolean> {
        let imapClient;
        try {
            imapClient = await this.getImapClient();
            await imapClient.logout();

            const transporter = this.getSmtpTransporter();
            await transporter.verify();

            return true;
        } catch (error) {
            console.error('Connection verification failed:', error);
            return false;
        } finally {
            if (imapClient) {
                // Ensure logout if it was connected
                try { await imapClient.logout(); } catch (e) { }
            }
        }
    }

    async getProfile(): Promise<UserProfile> {
        return {
            email: this.imapConfig.auth.user,
        };
    }

    async fetchInbox(options?: FetchOptions): Promise<StoredEmail[]> {
        return this.fetchEmails('INBOX', options);
    }

    async fetchSent(options?: FetchOptions): Promise<StoredEmail[]> {
        // Try common sent folder names
        const sentFolders = ['Sent', 'Sent Items', 'Sent Messages', '[Gmail]/Sent Mail'];
        let client;

        try {
            client = await this.getImapClient();
            const list = await client.list();

            // Find the first matching sent folder
            const sentFolder = list.find(f =>
                sentFolders.includes(f.name) ||
                (f.specialUse && f.specialUse === '\\Sent')
            );

            if (sentFolder) {
                await client.logout(); // Close first connection
                return this.fetchEmails(sentFolder.path, options);
            }

            await client.logout();
            return [];
        } catch (error) {
            console.error('Error finding sent folder:', error);
            if (client) try { await client.logout(); } catch (e) { }
            return [];
        }
    }

    private async fetchEmails(folderPath: string, options?: FetchOptions): Promise<StoredEmail[]> {
        const client = await this.getImapClient();
        const emails: StoredEmail[] = [];

        try {
            const lock = await client.getMailboxLock(folderPath);
            try {
                // Fetch latest emails
                // IMAP sequence numbers are 1-based. '*' is the last message.
                // We want the last N messages.
                const status = await client.status(folderPath, { messages: true });
                const total = status.messages || 0;

                if (total === 0) return [];

                const limit = options?.limit || 50;
                const range = `${Math.max(1, total - limit + 1)}:*`;

                // Fetch messages
                for await (const message of client.fetch(range, { envelope: true, source: true, uid: true })) {
                    try {
                        // Cast source to any to avoid type mismatch with simpleParser
                        const source = message.source as any;
                        const parsed = await simpleParser(source);

                        const subject = message.envelope?.subject || '(No Subject)';
                        const from = message.envelope?.from?.[0]?.address || '';
                        const to = message.envelope?.to?.[0]?.address || '';
                        const date = message.envelope?.date?.toISOString() || new Date().toISOString();
                        const isReply = !!message.envelope?.inReplyTo;

                        const bodyText = parsed.text || '';
                        let bodyHtml = parsed.html || '';

                        // Extract attachments from mailparser result
                        const attachments: { id: string; filename: string; mimeType: string; size: number; contentId?: string; data?: string }[] = [];
                        if (parsed.attachments && parsed.attachments.length > 0) {
                            for (const att of parsed.attachments) {
                                const attId = att.checksum || att.contentId || `att-${attachments.length}`;
                                attachments.push({
                                    id: attId,
                                    filename: att.filename || 'attachment',
                                    mimeType: att.contentType || 'application/octet-stream',
                                    size: att.size || 0,
                                    contentId: att.contentId?.replace(/^<|>$/g, ''), // strip angle brackets
                                    data: att.content.toString('base64'), // inline base64 for IMAP
                                });

                                // Replace CID references in HTML with data URIs for inline display
                                if (att.contentId && bodyHtml) {
                                    const cidClean = att.contentId.replace(/^<|>$/g, '');
                                    const dataUri = `data:${att.contentType || 'application/octet-stream'};base64,${att.content.toString('base64')}`;
                                    // Match cid:xxx patterns in src attributes
                                    const cidPatterns = [
                                        new RegExp(`src=["']cid:${cidClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'gi'),
                                        new RegExp(`src=["']cid:${(att.filename || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'gi'),
                                    ];
                                    for (const pattern of cidPatterns) {
                                        bodyHtml = bodyHtml.replace(pattern, `src="${dataUri}"`);
                                    }
                                }
                            }
                        }

                        const body = bodyHtml || bodyText || '';

                        // Generate snippet from text body, falling back to HTML, then empty string
                        const snippetText = bodyText || bodyHtml.replace(/<[^>]*>/g, '') || '';
                        const snippet = snippetText.substring(0, 200).replace(/\s+/g, ' ').trim();

                        emails.push({
                            id: message.uid.toString(), // Use UID as ID
                            subject,
                            from,
                            to,
                            body,
                            snippet,
                            date,
                            embedding: [], // Will be generated later
                            labels: [],
                            isSent: folderPath.toLowerCase().includes('sent'),
                            isReply,
                            attachments, // Include extracted attachments
                        } as any);
                    } catch (err) {
                        console.error('Error parsing message:', err);
                    }
                }
            } finally {
                lock.release();
            }
        } finally {
            await client.logout();
        }

        // Sort by date descending
        return emails.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    async sendEmail(email: OutboundEmail): Promise<{ messageId: string }> {
        const transporter = this.getSmtpTransporter();

        const info = await transporter.sendMail({
            from: this.smtpConfig.auth.user,
            to: email.to,
            cc: email.cc,
            bcc: email.bcc,
            subject: email.subject,
            text: email.text,
            html: email.html,
            replyTo: email.replyTo,
            inReplyTo: email.inReplyTo,
            references: email.references,
            attachments: email.attachments?.map(a => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType,
            })),
        });

        return { messageId: info.messageId };
    }
}
