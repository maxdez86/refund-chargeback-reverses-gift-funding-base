import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAQ } from "@/components/sections/FAQ";
import { Hero } from "@/components/sections/Hero";
import { Local } from "@/components/sections/Local";
import { Padrinhos } from "@/components/sections/Padrinhos";
import { Story } from "@/components/sections/Story";

const scrollToAnchorMock = vi.fn();

type EmblaHandler = () => void;
type FakeEmblaApi = {
  canScrollNext: () => boolean;
  canScrollPrev: () => boolean;
  on: (_event: string, handler: EmblaHandler) => void;
  rootNode: () => HTMLDivElement;
  scrollNext: () => void;
  scrollPrev: () => void;
};

function createMotionPassthrough(tag: ElementType) {
  return function MotionComponent({
    initial: _initial,
    transition: _transition,
    viewport: _viewport,
    whileInView: _whileInView,
    children,
    animate: _animate,
    ...props
  }: ComponentPropsWithoutRef<"div"> & {
    animate?: unknown;
    children?: ReactNode;
    initial?: unknown;
    transition?: unknown;
    viewport?: unknown;
    whileInView?: unknown;
  }) {
    const Component = tag;
    return <Component {...props}>{children}</Component>;
  };
}

vi.mock("@/lib/scroll-to-anchor", () => ({
  scrollToAnchor: (...args: unknown[]) => scrollToAnchorMock(...args),
}));

vi.mock("framer-motion", () => ({
  motion: {
    article: createMotionPassthrough("article"),
    div: createMotionPassthrough("div"),
  },
}));

vi.mock("@/components/ResponsivePhoto", () => ({
  ResponsivePhoto: ({ alt, className }: { alt: string; className?: string }) => (
    <img alt={alt} className={className} />
  ),
}));

vi.mock("embla-carousel-react", () => ({
  default: () => {
    let root = document.createElement("div");
    const handlers = new Map<string, EmblaHandler[]>();
    const api: FakeEmblaApi = {
      canScrollNext: () => true,
      canScrollPrev: () => true,
      on: (event, handler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      rootNode: () => root,
      scrollNext: vi.fn(),
      scrollPrev: vi.fn(),
    };

    const ref = (node: HTMLDivElement | null) => {
      if (node) {
        root = node;
      }
      for (const event of ["select", "reInit"]) {
        for (const handler of handlers.get(event) ?? []) {
          handler();
        }
      }
    };

    return [ref, api];
  },
}));

describe("landing page sections", () => {
  beforeEach(() => {
    scrollToAnchorMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("routes both Hero CTAs through scrollToAnchor", () => {
    render(<Hero />);

    fireEvent.click(screen.getByRole("link", { name: "Confirmar Presença" }));
    fireEvent.click(screen.getByRole("link", { name: "Lista de Presentes" }));

    expect(scrollToAnchorMock).toHaveBeenNthCalledWith(1, "#confirmar-presenca");
    expect(scrollToAnchorMock).toHaveBeenNthCalledWith(2, "#presentes");
  });

  describe("Local", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("copies the venue address and announces success", async () => {
      const writeTextMock = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue(undefined);

      render(<Local />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copiar endereço" }));
        await Promise.resolve();
      });

      expect(writeTextMock).toHaveBeenCalledWith(
        "Buffet Tulipas Villa Valentim, Rua Valentim Magalhães, 293 - São Paulo",
      );

      await act(async () => {
        vi.advanceTimersByTime(30);
      });

      expect(screen.getByRole("button", { name: "Endereço copiado" })).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Endereço copiado.");
    });

    it("announces when clipboard copy fails", async () => {
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard blocked"));

      render(<Local />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copiar endereço" }));
        await Promise.resolve();
      });

      await act(async () => {
        vi.advanceTimersByTime(30);
      });

      expect(screen.getByRole("status")).toHaveTextContent(
        "Não foi possível copiar. Selecione o endereço manualmente.",
      );
    });

    it("downloads the calendar invite as an ICS file", async () => {
      const createElementSpy = vi.spyOn(document, "createElement");
      const createObjectURLSpy = vi
        .spyOn(window.URL, "createObjectURL")
        .mockReturnValue("blob:calendar");
      const revokeObjectURLSpy = vi.spyOn(window.URL, "revokeObjectURL");
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      render(<Local />);

      fireEvent.click(screen.getByRole("button", { name: "Adicionar ao calendário" }));

      expect(createElementSpy).toHaveBeenCalledWith("a");
      expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:calendar");
    });
  });

  it("starts Story video playback and scrolls to the next section", () => {
    render(<Story />);

    fireEvent.click(screen.getByRole("button", { name: /Reproduzir Sob a luz dos seus olhos/i }));
    expect(screen.getByTitle("Sob a luz dos seus olhos")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Rolar para a próxima seção" }));
    expect(scrollToAnchorMock).toHaveBeenCalledWith("#review");
  });

  it("routes Padrinhos section navigation buttons through scrollToAnchor", () => {
    render(<Padrinhos />);

    fireEvent.click(screen.getByRole("button", { name: "Rolar para a seção anterior" }));
    fireEvent.click(screen.getByRole("button", { name: "Rolar para a próxima seção" }));

    expect(scrollToAnchorMock).toHaveBeenNthCalledWith(1, "#local");
    expect(scrollToAnchorMock).toHaveBeenNthCalledWith(2, "#fornecedores");
  });

  it("toggles FAQ items open and closed", () => {
    render(<FAQ />);

    const button = screen.getByRole("button", { name: "Crianças são bem-vindas?" });
    const answerPanel = button.parentElement?.querySelector("div:last-child");

    expect(answerPanel?.className).toContain("grid-rows-[0fr]");

    fireEvent.click(button);
    expect(answerPanel?.className).toContain("grid-rows-[1fr]");

    fireEvent.click(button);
    expect(answerPanel?.className).toContain("grid-rows-[0fr]");
  });
});
