import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const listMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();
const verifyTurnstileMock = vi.fn();
let getHandler: typeof import("../src/functions/guest-messages-get/handler").handler;
let createHandler: typeof import("../src/functions/guest-messages-create/handler").handler;
let deleteHandler: typeof import("../src/functions/admin-guest-message-delete/handler").handler;

vi.mock("../src/domain/guest-message-service", () => ({
  GuestMessageService: class {
    list = listMock;
    create = createMock;
    delete = deleteMock;
  }
}));

vi.mock("../src/lib/turnstile", () => ({
  verifyTurnstile: (...args: unknown[]) => verifyTurnstileMock(...args)
}));

describe("guest message handlers", () => {
  beforeAll(async () => {
    [
      { handler: getHandler },
      { handler: createHandler },
      { handler: deleteHandler }
    ] = await Promise.all([
      import("../src/functions/guest-messages-get/handler"),
      import("../src/functions/guest-messages-create/handler"),
      import("../src/functions/admin-guest-message-delete/handler")
    ]);
  });

  beforeEach(() => {
    listMock.mockReset();
    createMock.mockReset();
    deleteMock.mockReset();
    verifyTurnstileMock.mockReset().mockResolvedValue(undefined);
  });

  it("lists guest messages with the cursor query param", async () => {
    listMock.mockResolvedValueOnce({
      ok: true,
      messages: [],
      nextCursor: "cursor-2"
    });

    const response = await getHandler({
      headers: {},
      queryStringParameters: { cursor: "cursor-1" }
    } as APIGatewayProxyEventV2);

    expect(listMock).toHaveBeenCalledWith("cursor-1");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("\"nextCursor\":\"cursor-2\"");
  });

  it("verifies turnstile before creating a guest message", async () => {
    createMock.mockResolvedValueOnce({
      response: {
        ok: true,
        message: {
          messageId: "msg-1",
          authorName: "Ana",
          message: "Com carinho.",
          createdAt: "2026-05-29T18:00:00.000Z"
        }
      },
      notificationEnqueued: true
    });

    const response = await createHandler({
      headers: {},
      body: JSON.stringify({ authorName: "Ana", message: "Com carinho." })
    } as APIGatewayProxyEventV2);

    expect(verifyTurnstileMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      authorName: "Ana",
      message: "Com carinho."
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("\"messageId\":\"msg-1\"");
  });

  it("deletes a guest message by route param", async () => {
    deleteMock.mockResolvedValueOnce({
      ok: true,
      messageId: "msg-1",
      deletedAt: "2026-05-29T18:10:00.000Z"
    });

    const response = await deleteHandler({
      headers: {},
      pathParameters: { messageId: "msg-1" }
    } as APIGatewayProxyEventV2);

    expect(deleteMock).toHaveBeenCalledWith("msg-1");
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("\"messageId\":\"msg-1\"");
  });
});
