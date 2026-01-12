# Team Member Removal Feature Added

## Summary
Added the ability to remove team members from the team management interface. Previously, you could only edit a team member's access/departments but couldn't remove them completely.

## Changes Made

### 1. Updated `components/team-management.tsx`

#### New Icons Imported
- `Trash2` - For the remove button icon
- `AlertTriangle` - For the warning in the confirmation dialog

#### New State Variables
```tsx
const [deleteMemberDialogOpen, setDeleteMemberDialogOpen] = useState(false)
const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null)
const [deletingMember, setDeletingMember] = useState(false)
```

#### New Functions
1. **`handleRemoveMember`** - Opens the confirmation dialog when clicking the remove button
2. **`confirmRemoveMember`** - Calls the DELETE API endpoint to remove the user

#### UI Changes
1. **Added Remove Button**: Next to the "Edit Access" button for each team member (except the current user), there's now a red trash icon button
2. **Delete Confirmation Dialog**: Shows a warning dialog before removing a team member with:
   - Warning icon and message
   - Information that the action will deactivate the user account
   - Cancel and Remove buttons
   - Loading state while removing

## How It Works

1. **Click the trash icon** next to any team member (you cannot remove yourself)
2. **Confirmation dialog appears** asking you to confirm the removal
3. **Click "Remove Member"** to proceed
4. The system calls `DELETE /api/users/[id]` which deactivates the user
5. The team list refreshes automatically to show the updated team

## Permissions
- Only **Admin** users can remove team members
- You cannot remove yourself
- The feature is only available for business accounts

## Technical Details
- Uses the existing `DELETE /api/users/[id]` endpoint
- The endpoint deactivates the user (sets `is_active = false`) rather than deleting the record
- The user will no longer have access to the team workspace
- The change is reflected immediately in the team member list after successful removal
