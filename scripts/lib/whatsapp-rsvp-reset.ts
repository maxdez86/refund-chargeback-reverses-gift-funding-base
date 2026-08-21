import { pathToFileURL } from "node:url";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { invitationKeys, rsvpKeys } from "../../apps/api/src/services/dynamodb/key-builder.ts";
import { GSI1_NAME } from "../../apps/api/src/services/dynamodb/table.ts";

type Key = { PK: string; SK: string };
type DynamoCommand = QueryCommand | DeleteCommand | UpdateCommand;
type ResetDependencies = {
  send: (command: DynamoCommand) => Promise<unknown>;
};

export function parseWhatsappRsvpResetArgs(argv: readonly string[]) {
  const codes: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--invitation-code") continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --invitation-code.");
    codes.push(...value.split(",").map((code) => code.trim()).filter(Boolean));
    index += 1;
  }
  if (codes.length === 0) throw new Error("Provide at least one --invitation-code.");
  if (argv.some((value) => value !== "--apply" && value !== "--invitation-code" && !codes.includes(value) && !codes.some((code) => value.includes(code)))) {
    throw new Error("Expected --invitation-code <CODE[,CODE...]> and optionally --apply.");
  }
  return { invitationCodes: [...new Set(codes)], apply: argv.includes("--apply") };
}

async function queryConversationKeys(tableName: string, invitationCode: string, dependencies: ResetDependencies): Promise<Key[]> {
  const keys: Key[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await dependencies.send(new QueryCommand({
      TableName: tableName,
      IndexName: GSI1_NAME,
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: {
        ":pk": `INVITATION#${invitationCode}`,
        ":prefix": "WHATSAPP#"
      },
      ProjectionExpression: "PK, SK",
      ExclusiveStartKey
    }));
    keys.push(...((result.Items ?? []) as Key[]));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return keys;
}

async function invitationExists(tableName: string, invitationCode: string, dependencies: ResetDependencies) {
  const result = await dependencies.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": invitationKeys(invitationCode).PK },
    ProjectionExpression: "PK, SK, entityType"
  }));
  return (result.Items ?? []).some((item: { entityType?: string }) => item.entityType === "Invitation");
}

export async function resetWhatsappRsvpFlow(
  tableName: string,
  invitationCodes: readonly string[],
  apply: boolean,
  dependencies: ResetDependencies
) {
  const results: { invitationCode: string; conversationItems: number; applied: boolean }[] = [];
  for (const invitationCode of invitationCodes) {
    if (!(await invitationExists(tableName, invitationCode, dependencies))) {
      throw new Error(`Invitation not found: ${invitationCode}`);
    }
    const conversationKeys = await queryConversationKeys(tableName, invitationCode, dependencies);
    if (apply) {
      await dependencies.send(new DeleteCommand({ TableName: tableName, Key: rsvpKeys(invitationCode) }));
      for (const key of conversationKeys) {
        await dependencies.send(new DeleteCommand({ TableName: tableName, Key: { PK: key.PK, SK: key.SK } }));
      }
      const now = new Date().toISOString();
      await dependencies.send(new UpdateCommand({
        TableName: tableName,
        Key: invitationKeys(invitationCode),
        UpdateExpression: "SET #status = :idle, #updated = :now REMOVE #stage, #outbound, #inbound, #completed, #fallback, #failure, #attendance",
        ExpressionAttributeNames: {
          "#status": "whatsappFlowStatus",
          "#updated": "whatsappFlowUpdatedAt",
          "#stage": "whatsappFlowStage",
          "#outbound": "whatsappLastOutboundMessageId",
          "#inbound": "whatsappLastInboundMessageId",
          "#completed": "whatsappFlowCompletedAt",
          "#fallback": "whatsappFallbackSentAt",
          "#failure": "whatsappFailureReason",
          "#attendance": "whatsappAttendance"
        },
        ExpressionAttributeValues: { ":idle": "idle", ":now": now },
        ConditionExpression: "attribute_exists(PK)"
      }));
    }
    results.push({ invitationCode, conversationItems: conversationKeys.length, applied: apply });
  }
  return results;
}

async function main() {
  const args = parseWhatsappRsvpResetArgs(process.argv.slice(2));
  if (process.env.STAGE !== "dev") throw new Error("The RSVP flow reset is dev-only; set STAGE=dev.");
  const tableName = process.env.WEDDING_TABLE_NAME;
  if (!tableName) throw new Error("Missing WEDDING_TABLE_NAME.");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const results = await resetWhatsappRsvpFlow(
    tableName,
    args.invitationCodes,
    args.apply,
    { send: (command) => client.send(command) }
  );
  console.log(JSON.stringify({ mode: args.apply ? "applied" : "dry-run", results }, null, 2));
  if (!args.apply) console.log("Re-run with --apply to reset these flows.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
