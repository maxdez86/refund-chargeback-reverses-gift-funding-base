import { describe, expect, it, vi } from "vitest";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { recordWhatsappCommandEnqueued } from "../src/services/whatsapp/command-enqueue";

const queued = { status: "queued" as const, enqueuedAt: "2026-08-26T19:00:23.002Z" };

describe("recordWhatsappCommandEnqueued", () => {
  it("records the acknowledgement only while the command is unclaimed", async () => {
    const updateWhatsappCommand = vi.fn().mockResolvedValue(undefined);
    await expect(recordWhatsappCommandEnqueued({ updateWhatsappCommand }, "command-1", queued)).resolves.toBe(true);
    expect(updateWhatsappCommand).toHaveBeenCalledWith("command-1", {
      ...queued,
      updatedAt: queued.enqueuedAt
    }, {
      expression: "(#status = :queued OR #status = :queueUnavailable) AND attribute_not_exists(#startedAt)",
      names: { "#status": "status", "#startedAt": "startedAt" },
      values: { ":queued": "queued", ":queueUnavailable": "queue_unavailable" }
    });
  });

  it("treats a worker claim as a successful enqueue acknowledgement", async () => {
    const updateWhatsappCommand = vi.fn().mockRejectedValue(new ConditionalCheckFailedException({
      message: "worker claimed command", $metadata: {}
    }));
    await expect(recordWhatsappCommandEnqueued({ updateWhatsappCommand }, "command-1", queued)).resolves.toBe(false);
  });

  it("propagates non-conditional persistence failures", async () => {
    const error = new Error("DynamoDB unavailable");
    const updateWhatsappCommand = vi.fn().mockRejectedValue(error);
    await expect(recordWhatsappCommandEnqueued({ updateWhatsappCommand }, "command-1", queued)).rejects.toBe(error);
  });
});
