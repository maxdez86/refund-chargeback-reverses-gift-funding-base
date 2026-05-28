import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { invitationKeys } from "../apps/api/src/services/dynamodb/key-builder";
import {
  INVITATION_CODE_ALPHABET,
  INVITATION_CODE_DIGITS,
  INVITATION_CODE_REGEX
} from "../packages/contracts/src/invitation-code";
import { resourceName, resolveStage } from "../packages/config/src";

type HouseholdSeed = {
  householdId: string;
  householdName: string;
  guestNames: string[];
};

const households: HouseholdSeed[] = [
  { householdId: "grupo-amanda-cris", householdName: "Amanda e Chris", guestNames: ["Amanda", "Chris"] },
  { householdId: "grupo-fabi-fernando", householdName: "Fabi e Fernando", guestNames: ["Fabi", "Fernando"] },
  { householdId: "grupo-tami-marcos", householdName: "Tami e Marcos", guestNames: ["Tami", "Marcos"] },
  { householdId: "grupo-elis-son", householdName: "Elís e Son", guestNames: ["Elís", "Son"] },
  { householdId: "grupo-kelly-sa", householdName: "Kelly e Sá", guestNames: ["Kelly", "Sá"] },
  { householdId: "grupo-lila-welton", householdName: "Lila e Welton", guestNames: ["Lila", "Welton"] },
  { householdId: "grupo-nilza-cerqueira", householdName: "Nilza e Cerqueira", guestNames: ["Nilza", "Cerqueira"] },
  { householdId: "grupo-debora-nael", householdName: "Débora e Nael", guestNames: ["Débora", "Nael"] },
  { householdId: "grupo-nessa-carlos", householdName: "Nessa e Carlos", guestNames: ["Nessa", "Carlos"] },
  { householdId: "grupo-nuza-sid", householdName: "Nuza e Sid", guestNames: ["Nuza", "Sid"] },
  { householdId: "grupo-carol-higor", householdName: "Carol e Higor", guestNames: ["Carol", "Higor"] },
  { householdId: "grupo-alice", householdName: "Alice", guestNames: ["Alice"] },
  { householdId: "grupo-raquel", householdName: "Raquel", guestNames: ["Raquel"] },
  { householdId: "grupo-julia", householdName: "Julia", guestNames: ["Julia"] },
  { householdId: "grupo-drielly", householdName: "Drielly", guestNames: ["Drielly"] },
  { householdId: "grupo-ronaldo", householdName: "Ronaldo", guestNames: ["Ronaldo"] },
  { householdId: "grupo-cristiane-juliano", householdName: "Cristiane e Juliano", guestNames: ["Cristiane", "Juliano"] }
];

// Canonical invitation code: 2 letters + 4 digits from a confusion-free
// alphabet (no I/O/0/1). Deterministic per household via SHA-256(householdId)
// so reruns are idempotent and print runs stay aligned with what's in the table.
function generateInvitationCode(seed: string): string {
  const digest = createHash("sha256").update(seed).digest();
  let code = "";
  for (let i = 0; i < 2; i++) {
    code += INVITATION_CODE_ALPHABET[digest[i] % INVITATION_CODE_ALPHABET.length];
  }
  for (let i = 0; i < 4; i++) {
    code += INVITATION_CODE_DIGITS[digest[2 + i] % INVITATION_CODE_DIGITS.length];
  }
  return code;
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildGuestId(householdId: string, guestName: string): string {
  return `${householdId}--${slugify(guestName)}`;
}

const stage = resolveStage(process.env.STAGE);
const tableName = process.env.WEDDING_TABLE_NAME ?? resourceName("brimax-wedding", stage);

function assertCodesAreUniqueAndValid(
  rows: Array<{ householdId: string; invitationCode: string }>
) {
  const seen = new Map<string, string>();
  for (const row of rows) {
    if (!INVITATION_CODE_REGEX.test(row.invitationCode)) {
      throw new Error(
        `Generated invitation code "${row.invitationCode}" for ${row.householdId} fails INVITATION_CODE_REGEX.`
      );
    }
    const existing = seen.get(row.invitationCode);
    if (existing) {
      throw new Error(
        `Collision: ${existing} and ${row.householdId} both map to invitation code ${row.invitationCode}. Update the seed alphabet or use a different deterministic mapping.`
      );
    }
    seen.set(row.invitationCode, row.householdId);
  }
}

async function main() {
  const planned = households.map((household) => ({
    householdId: household.householdId,
    invitationCode: generateInvitationCode(household.householdId)
  }));
  assertCodesAreUniqueAndValid(planned);
  const codeByHousehold = new Map(planned.map((p) => [p.householdId, p.invitationCode]));

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const summary: Array<{ householdName: string; invitationCode: string }> = [];

  for (const household of households) {
    const invitationCode = codeByHousehold.get(household.householdId)!;
    const guests = household.guestNames.map((guestName) => ({
      guestId: buildGuestId(household.householdId, guestName),
      guestName,
      allowedPlusOnes: 0,
      rsvpStatus: "pending" as const
    }));

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...invitationKeys(invitationCode),
          entityType: "Invitation",
          invitationCode,
          householdId: household.householdId,
          householdName: household.householdName,
          guests
        }
      })
    );

    summary.push({ householdName: household.householdName, invitationCode });
  }

  console.log(`Seeded ${summary.length} households into ${tableName}:`);
  for (const row of summary) {
    console.log(`  ${row.invitationCode}  ${row.householdName}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
