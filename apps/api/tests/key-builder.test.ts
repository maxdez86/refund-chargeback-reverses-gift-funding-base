import { describe, expect, it } from "vitest";
import { invitationKeys, webhookKeys } from "../src/services/dynamodb/key-builder";

describe("DynamoDB key builders", () => {
  it("creates invitation keys", () => {
    expect(invitationKeys("ABCD1234")).toEqual({
      PK: "INVITATION#ABCD1234",
      SK: "INVITATION"
    });
  });

  it("creates webhook idempotency keys", () => {
    expect(webhookKeys("stripe", "evt_123")).toEqual({
      PK: "WEBHOOK#stripe",
      SK: "EVENT#evt_123"
    });
  });
});
