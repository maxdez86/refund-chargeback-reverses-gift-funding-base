export type NewInvitationGuest = {
  guestName: string;
  slot: number;
  isChild?: boolean;
};

export type NewInvitation = {
  invitationCode: string;
  householdName: string;
  phoneNumber?: string;
  guests: NewInvitationGuest[];
};

export const NEW_INVITATIONS: readonly NewInvitation[] = [
  {
    invitationCode: "BL6782",
    householdName: "Aline Mattes e Douglas Zampieri",
    guests: [
      { guestName: "Aline Mattes", slot: 1 },
      { guestName: "Douglas Zampieri", slot: 2 },
      { guestName: "Isabella", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "LT7524",
    householdName: "Nayare Seixas",
    guests: [
      { guestName: "Nayare Seixas", slot: 1 }
    ]
  },
  {
    invitationCode: "AC7295",
    householdName: "José Filho e família",
    guests: [
      { guestName: "José Filho", slot: 1 },
      { guestName: "Estela Soares", slot: 2, isChild: true },
      { guestName: "Manuela Soares", slot: 3, isChild: true },
      { guestName: "Micheane Pereira", slot: 4 },
    ]
  },
  {
    invitationCode: "EM4738",
    householdName: "Rafael Guimarães e família",
    guests: [
      { guestName: "Rafael Guimarães", slot: 1 },
      { guestName: "Lívia Guimarães", slot: 2 },
      { guestName: "Mayla", slot: 3, isChild: true },
      { guestName: "Laura", slot: 4, isChild: true }
    ]
  },
] as const;
