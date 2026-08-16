import test from "node:test";
import assert from "node:assert/strict";
import { classifyPk, partitionItems } from "./lib/reset-wedding-fresh-start.ts";

test("classifies WhatsApp template rows as retained rather than unexpected", () => {
  assert.equal(classifyPk("WHATSAPP_TEMPLATE#wedding_invitation"), "WHATSAPP_TEMPLATE#");
});

test("retains WhatsApp template rows instead of deleting them", () => {
  const inventory = partitionItems([
    {
      PK: "WHATSAPP_TEMPLATE#wedding_invitation",
      SK: "VERSION#000001",
      entityType: "WhatsappTemplateVersion",
    },
    {
      PK: "WHATSAPP_TEMPLATE#wedding_invitation",
      SK: "ACTIVE",
      entityType: "WhatsappTemplateActive",
    },
    {
      PK: "WHATSAPP_TEMPLATE#wedding_invitation",
      SK: "ACTIVATION#2026-08-15T12:00:00.000Z#abc",
      entityType: "WhatsappTemplateActivation",
    },
  ]);

  assert.equal(inventory.retainedItems.length, 3);
  assert.equal(inventory.deletableItems.length, 0);
  assert.equal(inventory.unexpectedItems.length, 0);
  assert.equal(inventory.pkPrefixCounts.get("WHATSAPP_TEMPLATE#"), 3);
});

test("still deletes wedding data rows", () => {
  const inventory = partitionItems([
    { PK: "INVITATION#abc", SK: "METADATA", entityType: "Invitation" },
    { PK: "GIFT#1", SK: "STATE", entityType: "GiftState" },
  ]);

  assert.equal(inventory.deletableItems.length, 2);
  assert.equal(inventory.retainedItems.length, 0);
  assert.equal(inventory.unexpectedItems.length, 0);
});

test("still flags genuinely unknown PK families", () => {
  const inventory = partitionItems([{ PK: "SOMETHING_NEW#1", SK: "METADATA" }]);

  assert.equal(inventory.unexpectedItems.length, 1);
  assert.equal(inventory.deletableItems.length, 0);
  assert.equal(inventory.retainedItems.length, 0);
  assert.equal(inventory.pkPrefixCounts.get("UNEXPECTED"), 1);
});

test("rejects rows without PK/SK", () => {
  assert.throws(() => partitionItems([{ PK: "INVITATION#abc" }]), /without PK\/SK/);
});
