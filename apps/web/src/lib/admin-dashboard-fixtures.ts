import { deriveGift, trailingInboundCount } from "@/lib/admin-dashboard-model";
import type {
  AdminDashboardSnapshot,
  AdminGift,
  AdminGuestMessage,
  AdminInvitation,
  AdminWhatsappConversationSummary,
  AdminWhatsappMessage
} from "@/lib/admin-dashboard-types";
import type { WhatsappFreeTextWindow } from "@brimax/contracts";

/**
 * Demonstration data for the administrative dashboard.
 *
 * Nothing here is real. It exists so the panel can be reviewed end to end before the
 * admin list endpoints exist; `admin-dashboard-source.ts` is the single seam that
 * swaps it for live data.
 */

/**
 * Declared without `whatsappConversation`: the summary is derived from `threads` below so the
 * two can never drift, exactly as the backend derives it from the stored messages.
 */
const invitations: Omit<AdminInvitation, "whatsappConversation" | "whatsappSendAvailability" | "whatsappFreeTextWindow">[] = [
  {
    invitationCode: "SW2748",
    householdName: "Eugênia Ribeiro",
    phoneNumber: "5511914362818",
    phoneNumberSource: "operator",
    phoneNumberUpdatedAt: "2026-08-18T20:17:36Z",
    whatsappFlowStatus: "completed",
    whatsappFlowStage: "reconfirmation",
    whatsappFlowUpdatedAt: "2026-08-18T20:18:40Z",
    whatsappFlowCompletedAt: "2026-08-18T20:18:40Z",
    whatsappFallbackSentAt: "2026-08-18T21:28:26Z",
    whatsappLastInboundMessageId: "wamid.HBgNNTUxMTkxNDM2MjgxOBUCABIYIEE1MTFFQUFCQzE3Q0E2RDFF",
    whatsappLastOutboundMessageId: "wamid.HBgNNTUxMTkxNDM2MjgxOBUCABEYEkRENUE2MjAzQ0MzMjE3",
    reconciliationStatus: "none",
    rsvp: {
      status: "attending",
      updatedAt: "2026-08-18T20:17:25Z",
      submittedBy: "SW2748--guest-01",
      attending: 1,
      paid: 1,
      childrenSixOrYounger: 0,
      note: "Música sugerida: Evidências - Chitãozinho e Xororó"
    },
    guests: [
      {
        guestId: "SW2748--guest-01",
        guestName: "Eugênia Ribeiro",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      }
    ],
    commands: [
      {
        commandId: "cmd-SW2748-03",
        createdAt: "2026-08-18T20:18:40Z",
        templateId: "wedding_rsvp_attending_followup_single",
        stage: "followup",
        status: "sent",
        retryCount: 1,
        reconciliationStatus: "none"
      },
      {
        commandId: "cmd-SW2748-02",
        createdAt: "2026-08-18T20:16:02Z",
        templateId: "wedding_rsvp_reconfirmation_single",
        stage: "reconfirmation",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      },
      {
        commandId: "cmd-SW2748-01",
        createdAt: "2026-08-10T13:04:11Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      }
    ]
  },
  {
    invitationCode: "TX6935",
    householdName: "Amanda Moura e Chris Kaneda",
    phoneNumber: "551196365517",
    phoneNumberSource: "operator",
    phoneNumberUpdatedAt: "2026-08-18T00:18:53Z",
    whatsappFlowStatus: "message_sent",
    whatsappFlowStage: "reconfirmation",
    whatsappFlowUpdatedAt: "2026-08-18T00:21:22Z",
    whatsappFlowCompletedAt: null,
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: null,
    whatsappLastOutboundMessageId: "wamid.HBgNNTUxMTk5NjM2NTUxNxUCABEYEkE4REM3OTcyRTYwRjY5",
    reconciliationStatus: "none",
    rsvp: {
      status: "attending",
      updatedAt: "2026-08-18T00:07:51Z",
      submittedBy: "TX6935--guest-01",
      attending: 2,
      paid: 2,
      childrenSixOrYounger: 0,
      note: "Música sugerida: Sozinho - Caetano Veloso"
    },
    guests: [
      {
        guestId: "TX6935--guest-01",
        guestName: "Amanda Moura",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      },
      {
        guestId: "TX6935--guest-02",
        guestName: "Christian Kaneda",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      }
    ],
    commands: [
      {
        commandId: "cmd-TX6935-02",
        createdAt: "2026-08-18T00:21:22Z",
        templateId: "wedding_rsvp_reconfirmation",
        stage: "reconfirmation",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      },
      {
        commandId: "cmd-TX6935-01",
        createdAt: "2026-08-11T09:32:07Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      }
    ]
  },
  {
    invitationCode: "HL4120",
    householdName: "Família Tavares",
    phoneNumber: "5531981207745",
    phoneNumberSource: "import",
    phoneNumberUpdatedAt: "2026-07-29T11:02:10Z",
    whatsappFlowStatus: "attendance_confirmed_whatsapp",
    whatsappFlowStage: "followup",
    whatsappFlowUpdatedAt: "2026-08-14T18:44:02Z",
    whatsappFlowCompletedAt: null,
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: "wamid.HBgNNTUzMTk4MTIwNzc0NRUCABIYIDc3QjJEMEE1",
    whatsappLastOutboundMessageId: "wamid.HBgNNTUzMTk4MTIwNzc0NRUCABEYEjZDMUEyNDQ0",
    reconciliationStatus: "none",
    rsvp: {
      status: "attending",
      updatedAt: "2026-08-14T18:41:33Z",
      submittedBy: "HL4120--guest-01",
      attending: 4,
      // Manuela confirmed "6 anos ou menos"; Bento is a criança who answered "7 anos ou mais",
      // so he keeps a paying seat. The two flags are not the same fact.
      paid: 3,
      childrenSixOrYounger: 1,
      note: "Música sugerida: Anna Júlia - Los Hermanos"
    },
    guests: [
      {
        guestId: "HL4120--guest-01",
        guestName: "Sofia Mendes Tavares",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 1,
        rsvpStatus: "attending"
      },
      {
        guestId: "HL4120--guest-02",
        guestName: "Paulo Tavares",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      },
      {
        guestId: "HL4120--guest-03",
        guestName: "Manuela Tavares",
        isChild: true,
        isChildSixOrYounger: true,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      },
      {
        guestId: "HL4120--guest-04",
        guestName: "Bento Tavares",
        isChild: true,
        isChildSixOrYounger: false,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      }
    ],
    commands: [
      {
        commandId: "cmd-HL4120-02",
        createdAt: "2026-08-14T18:44:02Z",
        templateId: "wedding_rsvp_attending_followup",
        stage: "followup",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      },
      {
        commandId: "cmd-HL4120-01",
        createdAt: "2026-08-12T10:15:48Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      }
    ]
  },
  {
    invitationCode: "QP8814",
    householdName: "Helena Prado Ribeiro",
    phoneNumber: "5521984551190",
    phoneNumberSource: "guest",
    phoneNumberUpdatedAt: "2026-08-06T15:12:44Z",
    whatsappFlowStatus: "website_update_required",
    whatsappFlowStage: "followup",
    whatsappFlowUpdatedAt: "2026-08-16T09:12:31Z",
    whatsappFlowCompletedAt: null,
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: "wamid.HBgNNTUyMTk4NDU1MTE5MBUCABIYIEFBMTJDMDQ0",
    whatsappLastOutboundMessageId: "wamid.HBgNNTUyMTk4NDU1MTE5MBUCABEYEjkwQkYxMkEz",
    reconciliationStatus: "required",
    rsvp: {
      status: "pending",
      updatedAt: "2026-08-06T15:12:44Z",
      submittedBy: null,
      attending: 0,
      paid: 0,
      childrenSixOrYounger: 0
    },
    guests: [
      {
        guestId: "QP8814--guest-01",
        guestName: "Helena Prado Ribeiro",
        isChild: false,
        allowedPlusOnes: 1,
        rsvpStatus: "pending"
      }
    ],
    commands: [
      {
        commandId: "cmd-QP8814-02",
        createdAt: "2026-08-16T09:12:31Z",
        templateId: "wedding_rsvp_pending_reminder_single",
        stage: "followup",
        status: "reconciliation_required",
        retryCount: 2,
        reconciliationStatus: "required"
      },
      {
        commandId: "cmd-QP8814-01",
        createdAt: "2026-08-06T15:10:02Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      }
    ]
  },
  {
    invitationCode: "ZR5567",
    householdName: "Eduardo Nunes Filho",
    phoneNumber: "5511977338021",
    phoneNumberSource: "import",
    phoneNumberUpdatedAt: "2026-08-02T08:20:00Z",
    whatsappFlowStatus: "undecided",
    whatsappFlowStage: "followup",
    whatsappFlowUpdatedAt: "2026-08-15T22:03:10Z",
    whatsappFlowCompletedAt: null,
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: "wamid.HBgNNTUxMTk3NzMzODAyMRUCABIYIDMzRUE0NDIx",
    whatsappLastOutboundMessageId: "wamid.HBgNNTUxMTk3NzMzODAyMRUCABEYEjExQ0Y0NEEy",
    reconciliationStatus: "none",
    rsvp: {
      status: "pending",
      updatedAt: "2026-08-15T22:03:10Z",
      submittedBy: null,
      attending: 0,
      paid: 0,
      childrenSixOrYounger: 0
    },
    guests: [
      {
        guestId: "ZR5567--guest-01",
        guestName: "Eduardo Nunes Filho",
        isChild: false,
        allowedPlusOnes: 1,
        rsvpStatus: "pending"
      },
      {
        guestId: "ZR5567--guest-02",
        guestName: "Convidado(a) a definir",
        isChild: false,
        allowedPlusOnes: 0,
        rsvpStatus: "pending"
      }
    ],
    commands: [
      {
        commandId: "cmd-ZR5567-02",
        createdAt: "2026-08-15T22:03:10Z",
        templateId: "wedding_rsvp_undecided_followup",
        stage: "followup",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      },
      {
        commandId: "cmd-ZR5567-01",
        createdAt: "2026-08-03T14:41:55Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      }
    ]
  },
  {
    invitationCode: "MV2093",
    householdName: "Marcos e Juliana Alves",
    phoneNumber: "5511996142280",
    phoneNumberSource: "operator",
    phoneNumberUpdatedAt: "2026-07-20T17:45:12Z",
    whatsappFlowStatus: "completed",
    whatsappFlowStage: "followup",
    whatsappFlowUpdatedAt: "2026-08-09T11:22:40Z",
    whatsappFlowCompletedAt: "2026-08-09T11:22:40Z",
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: "wamid.HBgNNTUxMTk5NjE0MjI4MBUCABIYIEJDMzMxMEEx",
    whatsappLastOutboundMessageId: "wamid.HBgNNTUxMTk5NjE0MjI4MBUCABEYEkFEMTIzNDU2",
    reconciliationStatus: "none",
    rsvp: {
      status: "attending",
      updatedAt: "2026-08-09T11:20:05Z",
      submittedBy: "MV2093--guest-01",
      attending: 2,
      paid: 2,
      childrenSixOrYounger: 0,
      note: "Trem-Bala - Ana Vilela"
    },
    guests: [
      {
        guestId: "MV2093--guest-01",
        guestName: "Marcos Vinícius Alves",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      },
      {
        guestId: "MV2093--guest-02",
        guestName: "Juliana Alves",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 0,
        rsvpStatus: "attending"
      }
    ],
    commands: [
      {
        commandId: "cmd-MV2093-02",
        createdAt: "2026-08-09T11:22:40Z",
        templateId: "wedding_rsvp_attending_followup",
        stage: "followup",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      },
      {
        commandId: "cmd-MV2093-01",
        createdAt: "2026-07-21T09:00:31Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      }
    ]
  },
  {
    invitationCode: "RQ7712",
    householdName: "Rafael Queiroz",
    phoneNumber: "5511966223318",
    phoneNumberSource: "operator",
    phoneNumberUpdatedAt: "2026-07-28T19:33:00Z",
    whatsappFlowStatus: "attendance_declined",
    whatsappFlowStage: "followup",
    whatsappFlowUpdatedAt: "2026-08-10T20:14:09Z",
    whatsappFlowCompletedAt: "2026-08-10T20:14:09Z",
    whatsappFallbackSentAt: null,
    whatsappLastInboundMessageId: "wamid.HBgNNTUxMTk2NjIyMzMxOBUCABIYIDU1QUExMjMz",
    whatsappLastOutboundMessageId: "wamid.HBgNNTUxMTk2NjIyMzMxOBUCABEYEjc3RUUxMTAw",
    reconciliationStatus: "resolved",
    rsvp: {
      status: "declined",
      updatedAt: "2026-08-10T20:12:47Z",
      submittedBy: "RQ7712--guest-01",
      attending: 0,
      paid: 0,
      childrenSixOrYounger: 0,
      note: "Música sugerida: Tempo Perdido - Legião Urbana"
    },
    guests: [
      {
        guestId: "RQ7712--guest-01",
        guestName: "Rafael Queiroz",
        isChild: false,
        isChildSixOrYounger: false,
        allowedPlusOnes: 1,
        rsvpStatus: "declined"
      }
    ],
    commands: [
      {
        commandId: "cmd-RQ7712-02",
        createdAt: "2026-08-10T20:14:09Z",
        templateId: "wedding_rsvp_declined_followup_single",
        stage: "followup",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      },
      {
        commandId: "cmd-RQ7712-01",
        createdAt: "2026-07-29T08:12:20Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "sent",
        retryCount: 0,
        reconciliationStatus: "none"
      }
    ]
  },
  {
    invitationCode: "LB6640",
    householdName: "Luciana Barros Freitas",
    phoneNumber: "5511990804432",
    phoneNumberSource: "import",
    phoneNumberUpdatedAt: "2026-08-15T10:05:00Z",
    whatsappFlowStatus: "failed",
    whatsappFlowStage: "fallback",
    whatsappFlowUpdatedAt: "2026-08-17T07:41:52Z",
    whatsappFlowCompletedAt: null,
    whatsappFallbackSentAt: "2026-08-17T07:45:03Z",
    whatsappLastInboundMessageId: null,
    whatsappLastOutboundMessageId: null,
    reconciliationStatus: "required",
    rsvp: {
      status: "pending",
      updatedAt: "2026-08-15T10:05:00Z",
      submittedBy: null,
      attending: 0,
      paid: 0,
      childrenSixOrYounger: 0
    },
    guests: [
      {
        guestId: "LB6640--guest-01",
        guestName: "Luciana Barros Freitas",
        isChild: false,
        allowedPlusOnes: 1,
        rsvpStatus: "pending"
      },
      {
        guestId: "LB6640--guest-02",
        guestName: "Antônio Freitas",
        isChild: true,
        allowedPlusOnes: 0,
        rsvpStatus: "pending"
      }
    ],
    commands: [
      {
        commandId: "cmd-LB6640-02",
        createdAt: "2026-08-17T07:41:52Z",
        templateId: "wedding_rsvp_pending_reminder_group",
        stage: "fallback",
        status: "failed",
        retryCount: 3,
        reconciliationStatus: "required"
      },
      {
        commandId: "cmd-LB6640-01",
        createdAt: "2026-08-15T10:07:44Z",
        templateId: "wedding_invitation",
        stage: "pending",
        status: "queue_unavailable",
        retryCount: 1,
        reconciliationStatus: "none"
      }
    ]
  }
];

const threads: Record<string, Omit<AdminWhatsappMessage, "messageId">[]> = {
  SW2748: [
    {
      direction: "outbound",
      sentAt: "2026-08-10T13:04:11Z",
      templateId: "wedding_invitation",
      text: "Eugênia, é com muita alegria que convidamos você para o casamento de Brenda e Max, no dia 06 de dezembro de 2026, em São Paulo. Para confirmar sua presença, responda CONFIRMO ou acesse o site com o código SW2748."
    },
    { direction: "inbound", sentAt: "2026-08-10T13:26:40Z", text: "Oi! Recebi o convite, que notícia linda 🥰" },
    { direction: "inbound", sentAt: "2026-08-10T13:27:02Z", text: "CONFIRMO, claro que vou" },
    {
      direction: "outbound",
      sentAt: "2026-08-10T13:31:18Z",
      text: "Que bom, Eugênia! Presença confirmada para 1 pessoa. Vamos te mandar as informações de local e horário mais perto da data."
    },
    {
      direction: "outbound",
      sentAt: "2026-08-18T20:16:02Z",
      templateId: "wedding_rsvp_reconfirmation_single",
      text: "Eugênia, estamos fechando o número de convidados com o buffet. Você confirma que continua tudo certo para o dia 06/12?"
    },
    { direction: "inbound", sentAt: "2026-08-18T20:17:25Z", text: "Tudo certo, pode contar comigo!" },
    {
      direction: "outbound",
      sentAt: "2026-08-18T20:18:40Z",
      text: "Perfeito, obrigada pela resposta rápida. Já deixamos registrado aqui."
    }
  ],
  TX6935: [
    {
      direction: "outbound",
      sentAt: "2026-08-11T09:32:07Z",
      templateId: "wedding_invitation",
      text: "Amanda e Chris, queremos vocês com a gente no casamento de Brenda e Max, dia 06 de dezembro de 2026. Confirme por aqui ou no site com o código TX6935."
    },
    { direction: "inbound", sentAt: "2026-08-11T10:04:51Z", text: "Que amor! Vamos sim, nós dois" },
    {
      direction: "outbound",
      sentAt: "2026-08-11T10:09:12Z",
      text: "Anotado: 2 lugares para Amanda e Christian. Obrigada!"
    },
    {
      direction: "inbound",
      sentAt: "2026-08-17T23:58:10Z",
      text: "Uma dúvida: a festa é no mesmo lugar da cerimônia?"
    },
    {
      direction: "outbound",
      sentAt: "2026-08-18T00:07:51Z",
      text: "É sim, cerimônia e recepção no mesmo espaço. A cerimônia começa às 16h30 e pedimos chegada até 16h."
    },
    {
      direction: "outbound",
      sentAt: "2026-08-18T00:21:22Z",
      templateId: "wedding_rsvp_reconfirmation",
      text: "Vocês confirmam que seguem os 2 lugares para o dia 06/12?"
    }
  ],
  HL4120: [
    {
      direction: "outbound",
      sentAt: "2026-08-12T10:15:48Z",
      templateId: "wedding_invitation",
      text: "Família Tavares, vocês estão convidados para o casamento de Brenda e Max, dia 06 de dezembro de 2026. O convite contempla 4 pessoas. Código HL4120."
    },
    {
      direction: "inbound",
      sentAt: "2026-08-12T12:40:03Z",
      text: "Oi, que felicidade! Vamos todos, eu, o Paulo e as crianças"
    },
    {
      direction: "inbound",
      sentAt: "2026-08-12T12:41:22Z",
      text: "As crianças podem ir mesmo? A Manuela tem 6 e o Bento 4"
    },
    {
      direction: "outbound",
      sentAt: "2026-08-12T13:02:44Z",
      text: "Podem sim, Sofia. As duas crianças entram como cortesia e vamos ter um espaço reservado para elas durante a recepção."
    },
    { direction: "inbound", sentAt: "2026-08-14T18:41:33Z", text: "Maravilha então. Confirmado para os 4 🙌" },
    {
      direction: "outbound",
      sentAt: "2026-08-14T18:44:02Z",
      templateId: "wedding_rsvp_attending_followup",
      text: "Confirmado: 4 presenças (2 adultos e 2 crianças). Em outubro enviamos os detalhes de estacionamento e traje."
    }
  ],
  QP8814: [
    {
      direction: "outbound",
      sentAt: "2026-08-06T15:10:02Z",
      templateId: "wedding_invitation",
      text: "Helena, você e um acompanhante estão convidados para o casamento de Brenda e Max, dia 06 de dezembro de 2026. Código QP8814."
    },
    {
      direction: "inbound",
      sentAt: "2026-08-06T15:12:44Z",
      text: "Obrigada pelo convite! Ainda não sei se levo acompanhante, posso responder depois?"
    },
    {
      direction: "outbound",
      sentAt: "2026-08-06T15:20:31Z",
      text: "Sem problema, Helena. Pode responder até o fim de outubro."
    },
    {
      direction: "outbound",
      sentAt: "2026-08-16T09:12:31Z",
      templateId: "wedding_rsvp_pending_reminder_single",
      text: "Helena, seu RSVP ainda está pendente. Você vai ao casamento no dia 06/12? Responda CONFIRMO, NÃO VOU ou AINDA NÃO SEI."
    },
    { direction: "inbound", sentAt: "2026-08-19T21:40:12Z", text: "Vou sim! E vou levar acompanhante" },
    { direction: "inbound", sentAt: "2026-08-19T21:41:05Z", text: "Consegui atualizar no site? Não apareceu nada lá" }
  ],
  ZR5567: [
    {
      direction: "outbound",
      sentAt: "2026-08-03T14:41:55Z",
      templateId: "wedding_invitation",
      text: "Eduardo, você e um acompanhante estão convidados para o casamento de Brenda e Max, dia 06 de dezembro de 2026. Código ZR5567."
    },
    {
      direction: "inbound",
      sentAt: "2026-08-03T19:22:09Z",
      text: "Valeu pelo convite! Vou ver se consigo me organizar com a viagem"
    },
    {
      direction: "outbound",
      sentAt: "2026-08-15T22:03:10Z",
      templateId: "wedding_rsvp_undecided_followup",
      text: "Eduardo, ainda dá tempo de decidir. Você consegue nos dar uma resposta até o fim do mês?"
    },
    { direction: "inbound", sentAt: "2026-08-15T22:30:47Z", text: "Consigo sim, semana que vem eu te falo" }
  ],
  MV2093: [
    {
      direction: "outbound",
      sentAt: "2026-07-21T09:00:31Z",
      templateId: "wedding_invitation",
      text: "Marcos e Juliana, contamos com vocês no casamento de Brenda e Max, dia 06 de dezembro de 2026. Código MV2093."
    },
    { direction: "inbound", sentAt: "2026-07-21T09:44:18Z", text: "Estaremos lá, com certeza!" },
    {
      direction: "inbound",
      sentAt: "2026-08-09T11:20:05Z",
      text: "Confirmando os 2 lugares, viu? Já bloqueamos a data"
    },
    {
      direction: "outbound",
      sentAt: "2026-08-09T11:22:40Z",
      templateId: "wedding_rsvp_attending_followup",
      text: "Tudo confirmado para vocês dois. Obrigada!"
    }
  ],
  RQ7712: [
    {
      direction: "outbound",
      sentAt: "2026-07-29T08:12:20Z",
      templateId: "wedding_invitation",
      text: "Rafael, você está convidado para o casamento de Brenda e Max, dia 06 de dezembro de 2026. Código RQ7712."
    },
    {
      direction: "inbound",
      sentAt: "2026-08-10T20:11:52Z",
      text: "Oi, obrigado pelo convite. Infelizmente não vou conseguir ir, estarei fora do país nessa semana"
    },
    {
      direction: "outbound",
      sentAt: "2026-08-10T20:14:09Z",
      text: "Que pena, Rafael! Vamos sentir sua falta. Registramos aqui como ausência."
    }
  ],
  // LB6640 has no entry on purpose. Every send for it failed or never left the queue, so it
  // owns no stored message — matching its null last-message IDs — and it is the fixture case
  // that must never appear in the WhatsApp tab.
};

const guestMessages: AdminGuestMessage[] = [
  {
    messageId: "b2f91fa5-41dc-4444-b466-9ca5f974cabc",
    authorName: "Eugênia Ribeiro",
    createdAt: "2026-07-19T15:58:34Z",
    message:
      "Não acredito em destino, mas vendo a história de vocês acredito fielmente que estavam destinados a se encontrar. Tenho certeza que serão muito felizes."
  },
  {
    messageId: "7c30a1e2-9b44-4d21-8f0a-15c7ab993410",
    authorName: "Amanda Moura",
    createdAt: "2026-08-02T09:12:07Z",
    message: "Que alegria imensa poder celebrar esse dia com vocês. Já estamos contando os dias!"
  },
  {
    messageId: "e51b7740-2c88-49aa-b0d6-4f2ac1d6b7e9",
    authorName: "Marcos Vinícius Alves",
    createdAt: "2026-08-09T11:31:52Z",
    message: "Contem comigo para o que precisarem antes do grande dia. Vai ser inesquecível."
  },
  {
    messageId: "a0d4c9b1-77ef-4b1e-9c33-882be0a51d67",
    authorName: "Anônimo",
    createdAt: "2026-08-12T23:47:19Z",
    message: "Mensagem com conteúdo ofensivo reportada pela moderação do site."
  },
  {
    messageId: "2f8ee6c5-0a54-4c9e-bb17-6d3f7c204a55",
    authorName: "Sofia Mendes Tavares",
    createdAt: "2026-08-14T18:39:41Z",
    message: "Vamos todos! Já organizamos a viagem em família e as crianças estão animadíssimas."
  },
  {
    messageId: "9b1c33da-5e02-42f7-a8d1-cf4477e21b83",
    authorName: "Rafael Queiroz",
    createdAt: "2026-08-10T20:11:03Z",
    message: "Infelizmente estarei fora do país na data. Desejo toda felicidade do mundo aos dois!"
  }
];

type GiftSeed = {
  id: string;
  name: string;
  image: string;
  fractional: boolean;
  totalValueCents: number;
  partsFunded: number;
  partsReserved: number;
  paused: boolean;
  updatedAt: string;
  version: number;
};

const giftSeed: GiftSeed[] = [
  { id: "g-sofa", name: "Sofá", image: "sofa", fractional: true, totalValueCents: 145_000, partsFunded: 0, partsReserved: 0, paused: false, updatedAt: "2026-06-14T01:49:52.697Z", version: 2 },
  { id: "g-jogo-jantar", name: "Jogo de jantar", image: "jogo-jantar", fractional: true, totalValueCents: 120_000, partsFunded: 11, partsReserved: 3, paused: false, updatedAt: "2026-08-11T18:22:04.118Z", version: 9 },
  { id: "g-lua-de-mel", name: "Lua de mel em Noronha", image: "lua-de-mel", fractional: true, totalValueCents: 800_000, partsFunded: 92, partsReserved: 12, paused: false, updatedAt: "2026-08-16T13:05:41.902Z", version: 31 },
  { id: "g-geladeira", name: "Geladeira", image: "geladeira", fractional: true, totalValueCents: 310_000, partsFunded: 62, partsReserved: 0, paused: false, updatedAt: "2026-08-02T09:14:26.550Z", version: 24 },
  { id: "g-balde", name: "Balde Retrátil 10L", image: "balde-retratil", fractional: false, totalValueCents: 6_900, partsFunded: 0, partsReserved: 0, paused: false, updatedAt: "2026-06-13T16:43:09.347Z", version: 0 },
  { id: "g-cafeteira", name: "Cafeteira italiana", image: "cafeteira", fractional: false, totalValueCents: 42_000, partsFunded: 1, partsReserved: 0, paused: false, updatedAt: "2026-07-28T20:41:12.007Z", version: 3 },
  { id: "g-cama-box", name: "Cama box queen", image: "cama-box", fractional: true, totalValueCents: 275_000, partsFunded: 20, partsReserved: 4, paused: false, updatedAt: "2026-08-15T22:37:59.410Z", version: 17 },
  { id: "g-panelas", name: "Jogo de panelas", image: "panelas", fractional: true, totalValueCents: 90_000, partsFunded: 5, partsReserved: 1, paused: false, updatedAt: "2026-08-09T11:03:47.884Z", version: 7 },
  { id: "g-adega", name: "Adega climatizada", image: "adega", fractional: true, totalValueCents: 235_000, partsFunded: 0, partsReserved: 0, paused: true, updatedAt: "2026-07-04T16:52:10.221Z", version: 2 },
  { id: "g-robo", name: "Robô aspirador", image: "robo-aspirador", fractional: true, totalValueCents: 180_000, partsFunded: 12, partsReserved: 2, paused: false, updatedAt: "2026-08-18T08:19:33.640Z", version: 12 },
  { id: "g-toalhas", name: "Enxoval de toalhas", image: "toalhas", fractional: false, totalValueCents: 28_000, partsFunded: 0, partsReserved: 0, paused: false, updatedAt: "2026-06-30T14:26:05.318Z", version: 1 }
];

const gifts: AdminGift[] = giftSeed.map((gift) =>
  deriveGift({ ...gift, payerNames: [], photoUrl: null })
);

/**
 * The per-invitation summary the backend would have computed for this thread, derived rather
 * than hand-written so a fixture edit can never leave the two disagreeing. `null` for an
 * invitation with no messages, which is what keeps it out of the WhatsApp tab.
 */
function summarizeFixtureThread(
  messages: AdminWhatsappMessage[]
): AdminWhatsappConversationSummary | null {
  const last = messages.at(-1);
  if (!last) return null;
  const lastOutbound = messages.filter((message) => message.direction === "outbound").at(-1);
  const lastInbound = messages.filter((message) => message.direction === "inbound").at(-1);
  return {
    messageCount: messages.length,
    unreadCount: trailingInboundCount(messages),
    lastMessageAt: last.sentAt,
    lastMessageDirection: last.direction,
    lastMessageType: last.templateId ? "template" : "text",
    lastMessageTemplateId: last.templateId,
    lastMessagePreview: last.text.slice(0, 160),
    lastOutboundMessageTemplateId: lastOutbound?.templateId,
    lastOutboundMessagePreview: lastOutbound?.text.slice(0, 160),
    lastInboundMessageTemplateId: lastInbound?.templateId,
    lastInboundMessagePreview: lastInbound?.text.slice(0, 160)
  };
}

const FIXTURE_FREE_TEXT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Fixtures are dated, so "now" is taken as the newest message in the whole fixture set rather
 * than the wall clock. That keeps the demo deterministic while still showing both an open and a
 * lapsed 24-hour window, which is what the composer branches on.
 */
function fixtureFreeTextWindow(
  messages: AdminWhatsappMessage[],
  fixtureNow: number
): WhatsappFreeTextWindow {
  const lastInbound = messages.filter((message) => message.direction === "inbound").at(-1);
  if (!lastInbound) return { open: false };
  const expiresAtMs = Date.parse(lastInbound.sentAt) + FIXTURE_FREE_TEXT_WINDOW_MS;
  return {
    open: fixtureNow < expiresAtMs,
    lastInboundAt: lastInbound.sentAt,
    expiresAt: new Date(expiresAtMs).toISOString()
  };
}

/** A deep copy, so the reducer can mutate freely without leaking between mounts or tests. */
export function createFixtureDashboardSnapshot(): AdminDashboardSnapshot {
  const identifiedThreads = Object.fromEntries(
    Object.entries(threads).map(([invitationCode, messages]) => [
      invitationCode,
      messages.map((message, index) => ({
        ...message,
        messageId: `fixture-${invitationCode}-${index + 1}`
      }))
    ])
  );
  const fixtureNow = Math.max(
    0,
    ...Object.values(identifiedThreads).flatMap((messages) =>
      messages.map((message) => Date.parse(message.sentAt))
    )
  );
  return structuredClone({
    invitations: invitations.map((invitation) => ({
      ...invitation,
      whatsappFreeTextWindow: fixtureFreeTextWindow(
        identifiedThreads[invitation.invitationCode] ?? [],
        fixtureNow
      ),
      whatsappSendAvailability: (() => {
        const completedPending =
          invitation.whatsappFlowStatus === "completed" &&
          Boolean(invitation.whatsappFlowCompletedAt) &&
          invitation.guests.every((guest) => guest.rsvpStatus === "pending");
        const resendReason = invitation.whatsappFlowStatus === "failed"
          ? "failed" as const
          : invitation.whatsappFlowStatus === "undecided"
            ? "undecided" as const
            : completedPending
              ? "completed_pending" as const
              : undefined;
        return {
          firstAllowed: invitation.whatsappFlowStatus === "idle" && !invitation.whatsappFlowCompletedAt,
          resendAllowed: resendReason !== undefined,
          ...(resendReason ? { resendReason } : {})
        };
      })(),
      whatsappConversation: summarizeFixtureThread(
        identifiedThreads[invitation.invitationCode] ?? []
      )
    })),
    guestMessages,
    gifts,
    threads: identifiedThreads
  });
}
