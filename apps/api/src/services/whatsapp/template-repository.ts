import { randomUUID } from "node:crypto";
import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient
} from "@aws-sdk/lib-dynamodb";
import { getEnv } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { createTracedAwsClient } from "../../lib/xray";
import { dynamoDbDocumentClient } from "../dynamodb/client";
import {
  whatsappTemplateActivationKeys,
  whatsappTemplateActiveKeys,
  whatsappTemplateVersionKeys
} from "../dynamodb/key-builder";
import {
  WhatsappTemplateActiveItemSchema,
  WhatsappTemplateDefinitionSchema,
  WhatsappTemplatePurposeSchema,
  WhatsappTemplateVersionItemSchema,
  type WhatsappTemplateDefinition
} from "./schemas";

export class WhatsappTemplateNotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
    this.name = "WhatsappTemplateNotFoundError";
  }
}

export class WhatsappTemplateConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
    this.name = "WhatsappTemplateConflictError";
  }
}

export class WhatsappTemplateRepository {
  private readonly documentClient: DynamoDBDocumentClient;

  constructor(
    documentClient: DynamoDBDocumentClient = dynamoDbDocumentClient,
    private readonly tableName = getEnv().weddingTableName
  ) {
    this.documentClient = createTracedAwsClient(documentClient, {
      annotations: { repository: "whatsapp_template_repository", table_role: "wedding" },
      subsegmentPrefix: "whatsapp_template_repository"
    });
  }

  async createVersion(input: WhatsappTemplateDefinition) {
    const definition = WhatsappTemplateDefinitionSchema.parse(input);
    const item = {
      ...whatsappTemplateVersionKeys(definition.purpose, definition.version),
      entityType: "WhatsappTemplateVersion" as const,
      ...definition
    };

    try {
      await this.documentClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: "attribute_not_exists(PK)"
        })
      );
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") {
        throw new WhatsappTemplateConflictError("WhatsApp template version already exists.");
      }
      throw error;
    }

    return definition;
  }

  async getVersion(purpose: string, version: number) {
    const validatedPurpose = WhatsappTemplatePurposeSchema.parse(purpose);
    const result = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: whatsappTemplateVersionKeys(validatedPurpose, version),
        ConsistentRead: true
      })
    );
    if (!result.Item) return null;
    const parsed = WhatsappTemplateVersionItemSchema.safeParse(result.Item);
    if (!parsed.success) throw new AppError("Stored WhatsApp template version is invalid.", 500);
    return {
      purpose: parsed.data.purpose,
      version: parsed.data.version,
      name: parsed.data.name,
      language: parsed.data.language,
      components: parsed.data.components,
      createdAt: parsed.data.createdAt
    };
  }

  async getActive(purpose: string) {
    const validatedPurpose = WhatsappTemplatePurposeSchema.parse(purpose);
    const pointerResult = await this.documentClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: whatsappTemplateActiveKeys(validatedPurpose),
        ConsistentRead: true
      })
    );
    if (!pointerResult.Item) return null;
    const pointer = WhatsappTemplateActiveItemSchema.safeParse(pointerResult.Item);
    if (!pointer.success) throw new AppError("Stored WhatsApp active-template pointer is invalid.", 500);
    const definition = await this.getVersion(validatedPurpose, pointer.data.activeVersion);
    if (!definition) throw new AppError("Active WhatsApp template version does not exist.", 500);
    return definition;
  }

  async listVersions(purpose: string) {
    const validatedPurpose = WhatsappTemplatePurposeSchema.parse(purpose);
    const result = await this.documentClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :version)",
        ExpressionAttributeValues: {
          ":pk": whatsappTemplateActiveKeys(validatedPurpose).PK,
          ":version": "VERSION#"
        },
        ConsistentRead: true
      })
    );
    return (result.Items ?? []).map((item) => {
      const parsed = WhatsappTemplateVersionItemSchema.safeParse(item);
      if (!parsed.success) throw new AppError("Stored WhatsApp template version is invalid.", 500);
      return {
        purpose: parsed.data.purpose,
        version: parsed.data.version,
        name: parsed.data.name,
        language: parsed.data.language,
        components: parsed.data.components,
        createdAt: parsed.data.createdAt
      };
    });
  }

  async activate(purpose: string, version: number, activatedAt = new Date().toISOString()) {
    const validatedPurpose = WhatsappTemplatePurposeSchema.parse(purpose);
    if (!(await this.getVersion(validatedPurpose, version))) {
      throw new WhatsappTemplateNotFoundError("WhatsApp template version does not exist.");
    }

    const activeKeys = whatsappTemplateActiveKeys(validatedPurpose);
    const current = await this.documentClient.send(
      new GetCommand({ TableName: this.tableName, Key: activeKeys, ConsistentRead: true })
    );
    const currentPointer = current.Item
      ? WhatsappTemplateActiveItemSchema.safeParse(current.Item)
      : undefined;
    if (currentPointer && !currentPointer.success) {
      throw new AppError("Stored WhatsApp active-template pointer is invalid.", 500);
    }

    const activationId = randomUUID();
    const pointer = {
      ...activeKeys,
      entityType: "WhatsappTemplateActive",
      purpose: validatedPurpose,
      activeVersion: version,
      activatedAt
    };
    const history = {
      ...whatsappTemplateActivationKeys(validatedPurpose, activatedAt, activationId),
      entityType: "WhatsappTemplateActivation",
      purpose: validatedPurpose,
      version,
      previousVersion: currentPointer?.success ? currentPointer.data.activeVersion : undefined,
      activatedAt,
      activationId
    };
    const hasCurrent = Boolean(currentPointer?.success);

    try {
      await this.documentClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: pointer,
                ConditionExpression: hasCurrent
                  ? "activeVersion = :expectedVersion"
                  : "attribute_not_exists(PK)",
                ExpressionAttributeValues: hasCurrent
                  ? { ":expectedVersion": currentPointer?.success ? currentPointer.data.activeVersion : 0 }
                  : undefined
              }
            },
            {
              Put: {
                TableName: this.tableName,
                Item: history,
                ConditionExpression: "attribute_not_exists(PK)"
              }
            }
          ]
        })
      );
    } catch (error) {
      if (error instanceof TransactionCanceledException || (error instanceof Error && error.name === "TransactionCanceledException")) {
        throw new WhatsappTemplateConflictError("WhatsApp active template changed concurrently.");
      }
      throw error;
    }

    return { purpose: validatedPurpose, version, previousVersion: history.previousVersion, activatedAt };
  }
}
