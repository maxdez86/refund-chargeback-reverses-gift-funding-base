export type NewInvitationGuest = {
  guestName: string;
  slot: number;
  isChild?: boolean;
};

export type NewInvitation = {
  invitationCode: string;
  householdName: string;
  guests: NewInvitationGuest[];
};

export const NEW_INVITATIONS: readonly NewInvitation[] = [
  {
    invitationCode: "JQ9472",
    householdName: "Cristiane Lima e Aristides Cruz",
    guests: [
      { guestName: "Cristiane Lima", slot: 1 },
      { guestName: "Aristides Cruz", slot: 2 }
    ]
  }
] as const;
