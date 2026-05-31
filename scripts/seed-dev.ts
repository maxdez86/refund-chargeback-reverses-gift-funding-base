import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand
} from "@aws-sdk/lib-dynamodb";
import { invitationKeys, guestKeys } from "../apps/api/src/services/dynamodb/key-builder.ts";
import { TABLE_PRIMARY_KEY } from "../apps/api/src/services/dynamodb/table.ts";
import { INVITATION_CODE_REGEX } from "../packages/contracts/src/invitation-code.ts";
import { pathToFileURL } from "node:url";

type SeedGuest = {
  guestName: string;
  slot: number;
  isChild?: boolean;
};

type SeedInvitation = {
  invitationCode: string;
  householdName: string;
  guests: SeedGuest[];
};

// Placeholder rows with no guest names were intentionally excluded from the
export const PRODUCTION_INVITATIONS: readonly SeedInvitation[] = [
  {
    invitationCode: "AB2345",
    householdName: "Cristiane Andrade da Silva e família",
    guests: [
      { guestName: "Cristiane Andrade da Silva", slot: 1 },
      { guestName: "Juliano Teles", slot: 2 },
      { guestName: "Maria José Andrade", slot: 3 }
    ]
  },
  {
    invitationCode: "CD6789",
    householdName: "Ronaldo da Silva e família",
    guests: [
      { guestName: "Ronaldo da Silva", slot: 1 },
      { guestName: "Jadna Carla", slot: 2 },
      { guestName: "Ana Cecília", slot: 3 }
    ]
  },
  {
    invitationCode: "EF3478",
    householdName: "João Estevo e família",
    guests: [
      { guestName: "João Estevo", slot: 1 },
      { guestName: "Sandra Regina", slot: 2 },
      { guestName: "Fernando José", slot: 3 }
    ]
  },
  {
    invitationCode: "GH5926",
    householdName: "Suzete de Cássia e Miguel Albano",
    guests: [
      { guestName: "Suzete de Cássia", slot: 1 },
      { guestName: "Miguel Albano", slot: 2 }
    ]
  },
  {
    invitationCode: "JK8234",
    householdName: "Vanuzia Andrade e família",
    guests: [
      { guestName: "Vanuzia Andrade", slot: 1 },
      { guestName: "Sidnei Souza", slot: 2 },
      { guestName: "Ana Clara Andrade", slot: 3 }
    ]
  },
  {
    invitationCode: "LM4567",
    householdName: "Débora Andrade e família",
    guests: [
      { guestName: "Débora Andrade", slot: 1 },
      { guestName: "Nael Silva", slot: 2 },
      { guestName: "Heitor Andrade", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "NP9382",
    householdName: "Denise Andrade e família",
    guests: [
      { guestName: "Denise Andrade", slot: 1 },
      { guestName: "Gusttavo Ferreira", slot: 2 },
      { guestName: "Maya Alice Andrade", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "QR2746",
    householdName: "Sirlei Furtuoso e Ayrton Furtuoso",
    guests: [
      { guestName: "Sirlei Furtuoso", slot: 1 },
      { guestName: "Ayrton Furtuoso", slot: 2 }
    ]
  },
  {
    invitationCode: "ST6354",
    householdName: "Andressa Furtuoso",
    guests: [{ guestName: "Andressa Furtuoso", slot: 1 }]
  },
  {
    invitationCode: "UV8729",
    householdName: "Samantha Furtuoso e Marido Samantha",
    guests: [
      { guestName: "Samantha Furtuoso", slot: 1 },
      { guestName: "Yrai Labate", slot: 2 }
    ]
  },
  {
    invitationCode: "WX3826",
    householdName: "Benedito Andrade e Marilize Amarilis",
    guests: [
      { guestName: "Benedito Andrade", slot: 1 },
      { guestName: "Marilize Amarilis", slot: 2 }
    ]
  },
  {
    invitationCode: "YZ5483",
    householdName: "Blenda Amarilis e Pedro Victor",
    guests: [
      { guestName: "Blenda Amarilis", slot: 1 },
      { guestName: "Pedro Victor", slot: 2 }
    ]
  },
  {
    invitationCode: "AC7295",
    householdName: "José Filho e família",
    guests: [
      { guestName: "José Filho", slot: 1 },
      { guestName: "Estela Soares", slot: 2, isChild: true },
      { guestName: "Manuela Soares", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "BD4638",
    householdName: "Vanessa Andrade e família",
    guests: [
      { guestName: "Vanessa Andrade", slot: 1 },
      { guestName: "Manoel Carlos", slot: 2 },
      { guestName: "Carlos Henrique", slot: 3, isChild: true },
      { guestName: "Vinicius Andrade", slot: 4, isChild: true }
    ]
  },
  {
    invitationCode: "CE9274",
    householdName: "Cristina Piassava e família",
    guests: [
      { guestName: "Cristina Piassava", slot: 1 },
      { guestName: "Eduardo Piassava", slot: 2 },
      { guestName: "Camila Piassava", slot: 3 }
    ]
  },
  {
    invitationCode: "DF3856",
    householdName: "Fernanda Andrade e Roberto Borges",
    guests: [
      { guestName: "Fernanda Andrade", slot: 1 },
      { guestName: "Roberto Borges", slot: 2 }
    ]
  },
  {
    invitationCode: "EG6492",
    householdName: "Raquel Maciel e Ricardo Quilici",
    guests: [
      { guestName: "Raquel Maciel", slot: 1 },
      { guestName: "Ricardo Quilici", slot: 2 }
    ]
  },
  {
    invitationCode: "FH2738",
    householdName: "Drielly Alves",
    guests: [{ guestName: "Drielly Alves", slot: 1 }]
  },
  {
    invitationCode: "GJ8526",
    householdName: "Julia Monteiro",
    guests: [{ guestName: "Julia Monteiro", slot: 1 }]
  },
  {
    invitationCode: "HK4395",
    householdName: "Erika Dutra",
    guests: [{ guestName: "Erika Dutra", slot: 1 }]
  },
  {
    invitationCode: "JL7682",
    householdName: "Yasmin Carula",
    guests: [{ guestName: "Yasmin Carula", slot: 1 }]
  },
  {
    invitationCode: "KM5934",
    householdName: "Ana Caroline Saraiva e Higor Matheus",
    guests: [
      { guestName: "Ana Caroline Saraiva", slot: 1 },
      { guestName: "Higor Matheus", slot: 2 }
    ]
  },
  {
    invitationCode: "LN2847",
    householdName: "Fernanda Alves e Giullia Perussetto",
    guests: [
      { guestName: "Fernanda Alves", slot: 1 },
      { guestName: "Giullia Perussetto", slot: 2 }
    ]
  },
  {
    invitationCode: "MP6753",
    householdName: "Yasmin Reis e Daniel Romagnolli",
    guests: [
      { guestName: "Yasmin Reis", slot: 1 },
      { guestName: "Daniel Romagnolli", slot: 2 }
    ]
  },
  {
    invitationCode: "NQ9428",
    householdName: "Geovanna Morete e João Bonifa",
    guests: [
      { guestName: "Geovanna Morete", slot: 1 },
      { guestName: "João Bonifa", slot: 2 }
    ]
  },
  {
    invitationCode: "PR3567",
    householdName: "Mayara Cândido",
    guests: [{ guestName: "Mayara Cândido", slot: 1 }]
  },
  {
    invitationCode: "QS8294",
    householdName: "Rebecca Silva",
    guests: [{ guestName: "Rebecca Silva", slot: 1 }]
  },
  {
    invitationCode: "RT4726",
    householdName: "Caio Azul e Giovanna Sena",
    guests: [
      { guestName: "Caio Azul", slot: 1 },
      { guestName: "Giovanna Sena", slot: 2 }
    ]
  },
  {
    invitationCode: "SU6385",
    householdName: "Pedro Lino e Julia Covolam",
    guests: [
      { guestName: "Pedro Lino", slot: 1 },
      { guestName: "Julia Covolam", slot: 2 }
    ]
  },
  {
    invitationCode: "TV2974",
    householdName: "Nicolas Dantas e Ana Cristina",
    guests: [
      { guestName: "Nicolas Dantas", slot: 1 },
      { guestName: "Ana Cristina", slot: 2 }
    ]
  },
  {
    invitationCode: "UW5638",
    householdName: "Bárbara Sangiorgi",
    guests: [{ guestName: "Bárbara Sangiorgi", slot: 1 }]
  },
  {
    invitationCode: "VX8425",
    householdName: "João Clímaco",
    guests: [{ guestName: "João Clímaco", slot: 1 }]
  },
  {
    invitationCode: "WY3792",
    householdName: "Edilsa Guerra e Eric",
    guests: [
      { guestName: "Edilsa Guerra", slot: 1 },
      { guestName: "Eric", slot: 2 }
    ]
  },
  {
    invitationCode: "XZ7546",
    householdName: "Giovanna Avelino",
    guests: [{ guestName: "Giovanna Avelino", slot: 1 }]
  },
  {
    invitationCode: "AD2658",
    householdName: "Tamiris Ferro",
    guests: [{ guestName: "Tamiris Ferro", slot: 1 }]
  },
  {
    invitationCode: "BE4937",
    householdName: "Milene Menezes",
    guests: [{ guestName: "Milene Menezes", slot: 1 }]
  },
  {
    invitationCode: "CF7384",
    householdName: "Nathalia Pires",
    guests: [{ guestName: "Nathalia Pires", slot: 1 }]
  },
  {
    invitationCode: "DG5826",
    householdName: "Vânia Andrade e Artur Andrade",
    guests: [
      { guestName: "Vânia Andrade", slot: 1 },
      { guestName: "Artur Andrade", slot: 2 }
    ]
  },
  {
    invitationCode: "EH9472",
    householdName: "Gabriela Garcia e família",
    guests: [
      { guestName: "Gabriela Garcia", slot: 1 },
      { guestName: "Rodrigo Silva", slot: 2 },
      { guestName: "Akin", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "FJ3658",
    householdName: "Tamires Lima e família",
    guests: [
      { guestName: "Tamires Lima", slot: 1 },
      { guestName: "Marcos Guimarães", slot: 2 },
      { guestName: "Nicolas Lima", slot: 3 }
    ]
  },
  {
    invitationCode: "GK6294",
    householdName: "Kelly Guimarães e Samuel Guimarães",
    guests: [
      { guestName: "Kelly Guimarães", slot: 1 },
      { guestName: "Samuel Guimarães", slot: 2 }
    ]
  },
  {
    invitationCode: "HL8537",
    householdName: "Elís Guimarães e família",
    guests: [
      { guestName: "Elís Guimarães", slot: 1 },
      { guestName: "Emerson Guimarães", slot: 2 },
      { guestName: "Luiza Guimarães", slot: 3, isChild: true },
      { guestName: "Samuel Soares", slot: 4 }
    ]
  },
  {
    invitationCode: "JM2746",
    householdName: "José Cerqueira e Nilza Guimarães",
    guests: [
      { guestName: "José Cerqueira", slot: 1 },
      { guestName: "Nilza Guimarães", slot: 2 }
    ]
  },
  {
    invitationCode: "KN4953",
    householdName: "Fernando Macedo e família",
    guests: [
      { guestName: "Fernando Macedo", slot: 1 },
      { guestName: "Fabiola Zampieri", slot: 2 },
      { guestName: "Arthur", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "LP7825",
    householdName: "Elisangela Cristina e família",
    guests: [
      { guestName: "Elisangela Cristina", slot: 1 },
      { guestName: "Luan Vinicius", slot: 2 },
      { guestName: "Marco Antônio", slot: 3 }
    ]
  },
  {
    invitationCode: "MQ3486",
    householdName: "Anderson Ferreira e família",
    guests: [
      { guestName: "Anderson Ferreira", slot: 1 },
      { guestName: "Rebeca Santos", slot: 2 },
      { guestName: "Michelly", slot: 3, isChild: true },
      { guestName: "Davi", slot: 4, isChild: true },
      { guestName: "Esther", slot: 5, isChild: true }
    ]
  },
  {
    invitationCode: "NR5973",
    householdName: "Jessica Souza e família",
    guests: [
      { guestName: "Jessica Souza", slot: 1 },
      { guestName: "Odair Fernandes", slot: 2 },
      { guestName: "Lívia", slot: 3, isChild: true },
      { guestName: "Heitor", slot: 4, isChild: true }
    ]
  },
  {
    invitationCode: "PS8264",
    householdName: "Vania Ribeiro e Conceição",
    guests: [
      { guestName: "Vania Ribeiro", slot: 1 },
      { guestName: "Conceição", slot: 2 }
    ]
  },
  {
    invitationCode: "QT4378",
    householdName: "Fernanda Killys e Diego Silva",
    guests: [
      { guestName: "Fernanda Killys", slot: 1 },
      { guestName: "Diego Silva", slot: 2 }
    ]
  },
  {
    invitationCode: "RU6829",
    householdName: "Elizabeth Mattes e família",
    guests: [
      { guestName: "Elizabeth Mattes", slot: 1 },
      { guestName: "José Mattes", slot: 2 },
      { guestName: "Irene Maciel", slot: 3 }
    ]
  },
  {
    invitationCode: "SV2543",
    householdName: "Júnior Mattes",
    guests: [{ guestName: "Júnior Mattes", slot: 1 }]
  },
  {
    invitationCode: "TW9637",
    householdName: "Alice Mattes",
    guests: [{ guestName: "Alice Mattes", slot: 1 }]
  },
  {
    invitationCode: "UX5784",
    householdName: "Lucas Soares e Julia Dantas",
    guests: [
      { guestName: "Lucas Soares", slot: 1 },
      { guestName: "Julia Dantas", slot: 2 }
    ]
  },
  {
    invitationCode: "VY3429",
    householdName: "Eduarda Piassava e Maikon Marques",
    guests: [
      { guestName: "Eduarda Piassava", slot: 1 },
      { guestName: "Maikon Marques", slot: 2 }
    ]
  },
  {
    invitationCode: "WZ7263",
    householdName: "Neide Saraiva",
    guests: [{ guestName: "Neide Saraiva", slot: 1 }]
  },
  {
    invitationCode: "AE8546",
    householdName: "Rafael Morais e família",
    guests: [
      { guestName: "Rafael Morais", slot: 1 },
      { guestName: "Thaís Morais", slot: 2 },
      { guestName: "Stella Morais", slot: 3, isChild: true },
      { guestName: "Selena Morais", slot: 4, isChild: true }
    ]
  },
  {
    invitationCode: "BF2937",
    householdName: "Rafael Douglas e família",
    guests: [
      { guestName: "Rafael Douglas", slot: 1 },
      { guestName: "Andreia Céu", slot: 2 },
      { guestName: "Ana Clara", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "CG6485",
    householdName: "Chris Lopes",
    guests: [{ guestName: "Chris Lopes", slot: 1 }]
  },
  {
    invitationCode: "DH4729",
    householdName: "Fernando Itano e família",
    guests: [
      { guestName: "Fernando Itano", slot: 1 },
      { guestName: "Anne Itano", slot: 2 },
      { guestName: "Rafa Itano", slot: 3, isChild: true },
      { guestName: "Fefa Itano", slot: 4, isChild: true }
    ]
  },
  {
    invitationCode: "EJ7263",
    householdName: "Tatiana Battistel e família",
    guests: [
      { guestName: "Tatiana Battistel", slot: 1 },
      { guestName: "Bruno Mendes", slot: 2 },
      { guestName: "Julia", slot: 3, isChild: true },
      { guestName: "Mel", slot: 4, isChild: true }
    ]
  },
  {
    invitationCode: "FK3958",
    householdName: "Karen Leal e família",
    guests: [
      { guestName: "Karen Leal", slot: 1 },
      { guestName: "Julio Gorato", slot: 2 },
      { guestName: "Marina", slot: 3, isChild: true },
      { guestName: "Enteado", slot: 4, isChild: true }
    ]
  },
  {
    invitationCode: "GL8427",
    householdName: "Deborah Gobbi e família",
    guests: [
      { guestName: "Deborah Gobbi", slot: 1 },
      { guestName: "Fábio Gobbi", slot: 2 },
      { guestName: "Matteo", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "HM5392",
    householdName: "Mauro Manzano e família",
    guests: [
      { guestName: "Mauro Manzano", slot: 1 },
      { guestName: "Karn Chutikarn", slot: 2 },
      { guestName: "Mateo", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "KP2735",
    householdName: "Lila Guimarães e Welton Rocha",
    guests: [
      { guestName: "Lila Guimarães", slot: 1 },
      { guestName: "Welton Rocha", slot: 2 }
    ]
  },
  {
    invitationCode: "LQ6483",
    householdName: "Rodrigo Silva e família",
    guests: [
      { guestName: "Rodrigo Silva", slot: 1 },
      { guestName: "Lea Silva", slot: 2 },
      { guestName: "Kauê", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "MR4925",
    householdName: "Emerson Lima e família",
    guests: [
      { guestName: "Emerson Lima", slot: 1 },
      { guestName: "Flávia Lima", slot: 2 },
      { guestName: "André", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "NS7384",
    householdName: "Matheus Roque e Isabel Roque",
    guests: [
      { guestName: "Matheus Roque", slot: 1 },
      { guestName: "Isabel Roque", slot: 2 }
    ]
  },
  {
    invitationCode: "PA3675",
    householdName: "Eduardo Marques e Day Moura",
    guests: [
      { guestName: "Eduardo Marques", slot: 1 },
      { guestName: "Day Moura", slot: 2 }
    ]
  },
  {
    invitationCode: "QU8492",
    householdName: "Édipo Alves e Stephany Britani",
    guests: [
      { guestName: "Édipo Alves", slot: 1 },
      { guestName: "Stephany Britani", slot: 2 }
    ]
  },
  {
    invitationCode: "RV5826",
    householdName: "Ana Paula dos Santos e Ivan Azevedo",
    guests: [
      { guestName: "Ana Paula dos Santos", slot: 1 },
      { guestName: "Ivan Azevedo", slot: 2 }
    ]
  },
  {
    invitationCode: "SW2748",
    householdName: "Eugenia Ribeiro",
    guests: [{ guestName: "Eugenia Ribeiro", slot: 1 }]
  },
  {
    invitationCode: "TX6935",
    householdName: "Amanda Moura e Chris Kaneda",
    guests: [
      { guestName: "Amanda Moura", slot: 1 },
      { guestName: "Chris Kaneda", slot: 2 }
    ]
  },
  {
    invitationCode: "UY4583",
    householdName: "Fernando Oliveira e Diego Marquez",
    guests: [
      { guestName: "Fernando Oliveira", slot: 1 },
      { guestName: "Diego Marquez", slot: 2 }
    ]
  },
  {
    invitationCode: "VZ9274",
    householdName: "Luíza Baratojo e Rodrigo Cardinali",
    guests: [
      { guestName: "Luíza Baratojo", slot: 1 },
      { guestName: "Rodrigo Cardinali", slot: 2 }
    ]
  },
  {
    invitationCode: "AF5638",
    householdName: "Gabriel Fernando e Maiara Barrantes",
    guests: [
      { guestName: "Gabriel Fernando", slot: 1 },
      { guestName: "Maiara Barrantes", slot: 2 }
    ]
  },
  {
    invitationCode: "BG7926",
    householdName: "Marcos Paulo Albuquerque",
    guests: [{ guestName: "Marcos Paulo Albuquerque", slot: 1 }]
  },
  {
    invitationCode: "CH3854",
    householdName: "Sônia Carvalho",
    guests: [{ guestName: "Sônia Carvalho", slot: 1 }]
  },
  {
    invitationCode: "DJ6472",
    householdName: "Daniela Benedicto e Luiz Fernando Benedicto",
    guests: [
      { guestName: "Daniela Benedicto", slot: 1 },
      { guestName: "Luiz Fernando Benedicto", slot: 2 }
    ]
  },
  {
    invitationCode: "EK8395",
    householdName: "Letícia Vilas Boas e Namorado",
    guests: [
      { guestName: "Letícia Vilas Boas", slot: 1 },
      { guestName: "Namorado", slot: 2 }
    ]
  },
  {
    invitationCode: "AG2827",
    householdName: "Taísa Barbosa e Tamires Andressa",
    guests: [
      { guestName: "Taísa Barbosa", slot: 1 },
      { guestName: "Tamires Andressa", slot: 2 }
    ]
  },
  {
    invitationCode: "BH3954",
    householdName: "Wilson Freire e Patrícia Serikawa",
    guests: [
      { guestName: "Wilson Freire", slot: 1 },
      { guestName: "Patrícia Serikawa", slot: 2 }
    ]
  },
  {
    invitationCode: "CK7283",
    householdName: "Kezia Guimarães",
    guests: [{ guestName: "Kezia Guimarães", slot: 1 }]
  },
  {
    invitationCode: "DL5926",
    householdName: "Ulisses Guimarães",
    guests: [{ guestName: "Ulisses Guimarães", slot: 1 }]
  },
  {
    invitationCode: "EM4738",
    householdName: "Rafael Guimarães e família",
    guests: [
      { guestName: "Rafael Guimarães", slot: 1 },
      { guestName: "Esposa", slot: 2 },
      { guestName: "Filho", slot: 3, isChild: true }
    ]
  },
  {
    invitationCode: "FN8265",
    householdName: "Vanda Guimarães e família",
    guests: [
      { guestName: "Vanda Guimarães", slot: 1 },
      { guestName: "Denilson Lopes", slot: 2 },
      { guestName: "Júlia Guimarães", slot: 3, isChild: true },
      { guestName: "Eduarda Guimarães", slot: 4, isChild: true }
    ]
  },
  {
    invitationCode: "GP2649",
    householdName: "Margarida De Jesus",
    guests: [{ guestName: "Margarida De Jesus", slot: 1 }]
  },
  {
    invitationCode: "HR5837",
    householdName: "Patrícia Kanô e Thiago Yoshimura",
    guests: [
      { guestName: "Patrícia Kanô", slot: 1 },
      { guestName: "Thiago Yoshimura", slot: 2 }
    ]
  }
] as const;

const stage = process.env.STAGE === "dev" ? "dev" : "prod";
const tableName =
  process.env.WEDDING_TABLE_NAME ?? `${stage === "prod" ? "" : "dev-"}brimax-wedding`;

function buildGuestId(invitationCode: string, slot: number): string {
  return `${invitationCode}--guest-${String(slot).padStart(2, "0")}`;
}

export function validateSeedInvitations(invitations: readonly SeedInvitation[]) {
  const seenCodes = new Set<string>();

  for (const invitation of invitations) {
    if (!invitation.invitationCode.trim()) {
      throw new Error("Seed invitation is missing an invitationCode.");
    }
    if (!INVITATION_CODE_REGEX.test(invitation.invitationCode)) {
      throw new Error(`Invalid invitation code in seed: ${invitation.invitationCode}`);
    }
    if (seenCodes.has(invitation.invitationCode)) {
      throw new Error(`Duplicate invitation code in seed: ${invitation.invitationCode}`);
    }
    seenCodes.add(invitation.invitationCode);

    if (!invitation.householdName.trim()) {
      throw new Error(`Seed invitation ${invitation.invitationCode} is missing householdName.`);
    }
    if (invitation.guests.length === 0) {
      throw new Error(`Seed invitation ${invitation.invitationCode} has no guests.`);
    }

    const seenSlots = new Set<number>();
    for (const guest of invitation.guests) {
      if (!guest.guestName.trim()) {
        throw new Error(`Seed invitation ${invitation.invitationCode} has a blank guest name.`);
      }
      if (seenSlots.has(guest.slot)) {
        throw new Error(
          `Seed invitation ${invitation.invitationCode} has a duplicate guest slot: ${guest.slot}.`
        );
      }
      seenSlots.add(guest.slot);
    }
  }
}

async function resetInvitationPartition(
  client: DynamoDBDocumentClient,
  invitationCode: string,
  tableNameValue: string
) {
  const result = await client.send(
    new QueryCommand({
      TableName: tableNameValue,
      KeyConditionExpression: `${TABLE_PRIMARY_KEY} = :pk`,
      ExpressionAttributeValues: {
        ":pk": invitationKeys(invitationCode).PK
      }
    })
  );

  for (const item of result.Items ?? []) {
    await client.send(
      new DeleteCommand({
        TableName: tableNameValue,
        Key: {
          PK: item.PK,
          SK: item.SK
        }
      })
    );
  }
}

export async function seedInvitations(
  client: DynamoDBDocumentClient,
  invitations: readonly SeedInvitation[],
  tableNameValue: string
) {
  validateSeedInvitations(invitations);

  for (const invitation of invitations) {
    await resetInvitationPartition(client, invitation.invitationCode, tableNameValue);

    await client.send(
      new PutCommand({
        TableName: tableNameValue,
        Item: {
          ...invitationKeys(invitation.invitationCode),
          entityType: "Invitation",
          invitationCode: invitation.invitationCode,
          householdName: invitation.householdName
        }
      })
    );

    for (const guest of invitation.guests) {
      const guestId = buildGuestId(invitation.invitationCode, guest.slot);
      await client.send(
        new PutCommand({
          TableName: tableNameValue,
          Item: {
            ...guestKeys(invitation.invitationCode, guestId),
            entityType: "InvitationGuest",
            invitationCode: invitation.invitationCode,
            guestId,
            guestName: guest.guestName,
            sortOrder: guest.slot,
            allowedPlusOnes: 0,
            rsvpStatus: "pending",
            isChild: guest.isChild ?? false
          }
        })
      );
    }
  }
}

async function main() {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  await seedInvitations(client, PRODUCTION_INVITATIONS, tableName);

  console.log(`Seeded ${PRODUCTION_INVITATIONS.length} invitations into ${tableName}:`);
  for (const invitation of PRODUCTION_INVITATIONS) {
    console.log(`  ${invitation.invitationCode}  ${invitation.householdName}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
