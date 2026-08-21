import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { WhatsappTemplateRepository } from "../src/services/whatsapp/template-repository";
import { WhatsappTemplateDefinitionSchema } from "../src/services/whatsapp/schemas";

const definition = {
  purpose: "wedding_invitation",
  version: 1,
  name: "wedding",
  language: "en",
  parameterFormat: "positional" as const,
  components: [],
  createdAt: "2026-08-15T12:00:00.000Z"
};

const versionItem = {
  PK: "WHATSAPP_TEMPLATE#wedding_invitation",
  SK: "VERSION#000001",
  entityType: "WhatsappTemplateVersion",
  ...definition
};

const definitionAsRead = {
  purpose: definition.purpose,
  version: definition.version,
  name: definition.name,
  language: definition.language,
  parameterFormat: definition.parameterFormat,
  components: definition.components,
  createdAt: definition.createdAt
};

describe("WhatsappTemplateRepository", () => {
  it("accepts generic retired purposes in persisted definitions", () => {
    expect(WhatsappTemplateDefinitionSchema.parse({
      ...definition,
      purpose: "retired_template_2024"
    }).purpose).toBe("retired_template_2024");
  });

  it("creates an immutable version", async () => {
    const send = vi.fn().mockResolvedValue({});
    const repository = new WhatsappTemplateRepository({ send } as never, "table-test");
    await expect(repository.createVersion(definition)).resolves.toEqual(definition);
    const command = send.mock.calls[0][0] as PutCommand;
    expect(command.input).toMatchObject({
      TableName: "table-test",
      Item: versionItem,
      ConditionExpression: "attribute_not_exists(PK)"
    });
  });

  it("rejects an attempt to overwrite an immutable version", async () => {
    const conflict = new Error("conditional failure");
    conflict.name = "ConditionalCheckFailedException";
    const repository = new WhatsappTemplateRepository(
      { send: vi.fn().mockRejectedValue(conflict) } as never,
      "table-test"
    );
    await expect(repository.createVersion(definition)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reads and validates the active immutable version", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Item: {
          PK: versionItem.PK,
          SK: "ACTIVE",
          entityType: "WhatsappTemplateActive",
          purpose: definition.purpose,
          activeVersion: 1,
          activatedAt: definition.createdAt
        }
      })
      .mockResolvedValueOnce({ Item: versionItem });
    const repository = new WhatsappTemplateRepository({ send } as never, "table-test");
    await expect(repository.getActive(definition.purpose)).resolves.toEqual(definitionAsRead);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(GetCommand);
  });

  it("fails closed for corrupt stored versions", async () => {
    const send = vi.fn().mockResolvedValue({ Item: { ...versionItem, language: "not valid" } });
    const repository = new WhatsappTemplateRepository({ send } as never, "table-test");
    await expect(repository.getVersion(definition.purpose, 1)).rejects.toThrow(
      "Stored WhatsApp template version is invalid"
    );
  });

  it("conditionally activates a version and writes immutable history", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: versionItem })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const repository = new WhatsappTemplateRepository({ send } as never, "table-test");
    await expect(repository.activate(definition.purpose, 1, definition.createdAt)).resolves.toMatchObject({
      purpose: definition.purpose,
      version: 1
    });
    const transaction = send.mock.calls[2][0] as TransactWriteCommand;
    expect(transaction.input.TransactItems).toHaveLength(2);
    expect(transaction.input.TransactItems?.[0].Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(PK)"
    });
    expect(transaction.input.TransactItems?.[1].Put?.Item).toMatchObject({
      entityType: "WhatsappTemplateActivation",
      version: 1
    });
  });

  it("supports rollback while conditionally preserving activation history", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: versionItem })
      .mockResolvedValueOnce({
        Item: {
          PK: versionItem.PK,
          SK: "ACTIVE",
          entityType: "WhatsappTemplateActive",
          purpose: definition.purpose,
          activeVersion: 2,
          activatedAt: "2026-08-15T11:00:00.000Z"
        }
      })
      .mockResolvedValueOnce({});
    const repository = new WhatsappTemplateRepository({ send } as never, "table-test");

    await expect(repository.activate(definition.purpose, 1, definition.createdAt)).resolves.toMatchObject({
      version: 1,
      previousVersion: 2
    });
    const transaction = send.mock.calls[2][0] as TransactWriteCommand;
    expect(transaction.input.TransactItems?.[0].Put).toMatchObject({
      ConditionExpression: "activeVersion = :expectedVersion",
      ExpressionAttributeValues: { ":expectedVersion": 2 }
    });
    expect(transaction.input.TransactItems?.[1].Put?.Item).toMatchObject({ previousVersion: 2 });
  });

  it("supports listing immutable versions", async () => {
    const send = vi.fn().mockResolvedValue({ Items: [versionItem] });
    const repository = new WhatsappTemplateRepository({ send } as never, "table-test");
    await expect(repository.listVersions(definition.purpose)).resolves.toEqual([definitionAsRead]);
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
  });

  it("preserves named parameter format when reading a version", async () => {
    const named = { ...versionItem, purpose: "wedding_rsvp_pending_reminder_group", parameterFormat: "named" as const };
    const repository = new WhatsappTemplateRepository(
      { send: vi.fn().mockResolvedValue({ Item: named }) } as never,
      "table-test"
    );
    await expect(repository.getVersion(named.purpose, named.version)).resolves.toMatchObject({
      parameterFormat: "named"
    });
  });
});
