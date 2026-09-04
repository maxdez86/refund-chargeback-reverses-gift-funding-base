import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GiftEditorModal, NewGiftModal } from "@/components/dashboard/modals/GiftModals";
import { createFixtureDashboardSnapshot } from "@/lib/admin-dashboard-fixtures";
import {
  buildSharedWidthImageFallbackSrc,
  buildSharedWidthImageSources
} from "@/lib/media";
import type { AdminGift } from "@/lib/admin-dashboard-types";

/** The first fixture gift, which carries a real catalog image slug and no local preview. */
const fixtureGift = (overrides: Partial<AdminGift> = {}): AdminGift => ({
  ...createFixtureDashboardSnapshot().gifts[0],
  ...overrides
});

describe("GiftEditorModal image preview", () => {
  it("renders the catalog image from the gift slug when there is no local photo", () => {
    const gift = fixtureGift({ photoUrl: null });

    render(<GiftEditorModal gift={gift} onCancel={vi.fn()} onSave={vi.fn()} />);

    const image = screen.getByRole("img", { name: gift.name });
    expect(image).toHaveAttribute(
      "src",
      buildSharedWidthImageFallbackSrc("presentes", gift.image)
    );
    expect(image.getAttribute("src")).toContain(`/media/presentes/${gift.image}/`);

    const picture = image.closest("picture");
    expect(picture).not.toBeNull();
    const srcSets = Array.from(picture!.querySelectorAll("source")).map((source) =>
      source.getAttribute("srcset")
    );
    for (const source of buildSharedWidthImageSources("presentes", gift.image, "any")) {
      expect(srcSets).toContain(source.srcSet);
    }
  });

  it("keeps showing the locally picked preview when photoUrl is set", () => {
    const gift = fixtureGift({ photoUrl: "blob:test-preview" });

    const { container } = render(
      <GiftEditorModal gift={gift} onCancel={vi.fn()} onSave={vi.fn()} />
    );

    expect(screen.queryByRole("img", { name: gift.name })).toBeNull();
    expect(
      container.ownerDocument.querySelector('[style*="blob:test-preview"]')
    ).not.toBeNull();
  });
});

describe("GiftEditorModal payer names", () => {
  it("renders all distinct payer names for a gift", () => {
    const gift = fixtureGift({ payerNames: ["Maria Clara", "João Pedro"] });

    render(<GiftEditorModal gift={gift} onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText("PAGANTES").nextElementSibling).toHaveTextContent("Maria Clara");
    expect(screen.getByText("PAGANTES").nextElementSibling).toHaveTextContent("João Pedro");
  });

  it("renders the empty payer fallback", () => {
    render(<GiftEditorModal gift={fixtureGift()} onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText("Nenhum pagante identificado")).toBeInTheDocument();
  });
});

describe("NewGiftModal", () => {
  it("stays a local placeholder and makes no network request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<NewGiftModal onCancel={vi.fn()} onCreate={vi.fn()} />);

    expect(screen.getByText("Enviar imagem do presente")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});
