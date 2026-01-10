/**
 * Helper function to get userEmail for ticket operations
 * For business accounts, allows access even if user doesn't have Gmail connected
 * Invited users (agents) should be able to access tickets from business's connected accounts
 */
export async function getUserEmailForTickets(): Promise<string | null> {
  const { getCurrentUserEmail } = await import('@/lib/storage');
  let userEmail = await getCurrentUserEmail();
  
  if (!userEmail) {
    // Check if this is a business account user
    const { validateBusinessSession } = await import('@/lib/session');
    const businessSession = await validateBusinessSession();
    
    if (businessSession?.businessId) {
      // For business accounts, use any connected account email from the business
      const { loadBusinessTokens } = await import('@/lib/storage');
      const connectedAccounts = await loadBusinessTokens(businessSession.businessId, businessSession?.email || undefined);
      if (connectedAccounts.length > 0) {
        userEmail = connectedAccounts[0].email;
        console.log(`[Ticket Helpers] User has no Gmail, using business account email: ${userEmail}`);
      }
    }
  }
  
  return userEmail;
}

