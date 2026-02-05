{/* Header row - Name and Time ONLY */ }
<div className="flex items-center justify-between gap-3">
    <h3 className={`font-semibold text-base truncate transition-colors ${selectedEmail === email.id ? "text-primary" : "text-foreground group-hover:text-primary"}`}>
        {(() => {
            const currentUserEmail = typeof window !== 'undefined' ? sessionStorage.getItem('current_user_email') : null;
            if (currentUserEmail && email.from.includes(currentUserEmail)) return "Me";
            const nameMatch = email.from.match(/^"?(.*?)"? <.*>$/);
            if (nameMatch && nameMatch[1]) return nameMatch[1];
            const emailAddress = email.from.replace(/[<>]/g, '');
            const localPart = emailAddress.split('@')[0];
            if (localPart) {
                return localPart.split(/[._]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
            }
            return emailAddress;
        })()}
    </h3>
    <span className="text-xs text-muted-foreground font-medium flex-shrink-0">
        {formatDate(email.date)}
    </span>
</div>
// ex
{/* Badges row - SEPARATE ROW */ }
<div className="flex items-center gap-1.5">
    {email.ownerEmail && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium border border-border/50 truncate max-w-[140px]" title={`Received by ${email.ownerEmail}`}>
            {email.ownerEmail}
        </span>
    )}
    <Badge variant="outline" className={email.departmentName ? "text-[10px] h-4 px-1.5 bg-primary/5 text-primary border-primary/30" : "text-[10px] h-4 px-1.5 bg-muted/50 text-muted-foreground border-border/50"}>
        {email.departmentName || "Unclassified"}
    </Badge>
    {selectedEmail === email.id && (
        <div className="w-2 h-2 bg-primary rounded-full animate-pulse shadow-sm shadow-primary/50" />
    )}
</div>
