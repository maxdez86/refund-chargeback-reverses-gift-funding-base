import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Countdown } from "@/components/sections/Countdown";

function createMotionPassthrough(tag: ElementType) {
  return function MotionComponent({
    initial: _initial,
    transition: _transition,
    viewport: _viewport,
    whileInView: _whileInView,
    children,
    ...props
  }: ComponentPropsWithoutRef<"div"> & {
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

vi.mock("framer-motion", () => ({
  motion: {
    div: createMotionPassthrough("div"),
  },
}));

const targetISO = "2026-12-06T15:00:00-03:00";

function readCards() {
  const timer = screen.getByRole("timer");

  return within(timer)
    .getAllByText(/^(Meses|Dias|Horas|Minutos|Segundos)$/)
    .map((label) => ({
      label: label.textContent,
      value: label.parentElement?.firstElementChild?.textContent,
    }));
}

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders four cards led by Meses and hides Segundos", () => {
    vi.setSystemTime(new Date("2026-08-24T15:00:00-03:00"));
    render(<Countdown />);

    expect(readCards().map((card) => card.label)).toEqual([
      "Meses",
      "Dias",
      "Horas",
      "Minutos",
    ]);
  });

  it("swaps Meses for Segundos in the final month, keeping four cards", () => {
    vi.setSystemTime(new Date("2026-11-30T15:00:00-03:00"));
    render(<Countdown />);

    expect(readCards().map((card) => card.label)).toEqual([
      "Dias",
      "Horas",
      "Minutos",
      "Segundos",
    ]);
  });

  it("splits the remaining time into whole calendar months plus a day remainder", () => {
    vi.setSystemTime(new Date("2026-08-24T15:00:00-03:00"));
    render(<Countdown />);

    // 2026-08-24 + 3 months = 2026-11-24, leaving 12 days to 2026-12-06.
    expect(readCards()).toEqual([
      { label: "Meses", value: "03" },
      { label: "Dias", value: "12" },
      { label: "Horas", value: "00" },
      { label: "Minutos", value: "00" },
    ]);
  });

  it("keeps the units summing back to the exact target instant in the final month", () => {
    vi.setSystemTime(new Date("2026-11-30T18:42:37-03:00"));
    render(<Countdown />);

    const [days, hours, minutes, seconds] = readCards().map((card) =>
      Number(card.value),
    );

    const sum = new Date("2026-11-30T18:42:37-03:00");
    sum.setTime(
      sum.getTime() +
        days * 86_400_000 +
        hours * 3_600_000 +
        minutes * 60_000 +
        seconds * 1000,
    );

    expect(sum.getTime()).toBe(new Date(targetISO).getTime());
  });

  it("leaves under a minute unaccounted while Segundos is hidden", () => {
    vi.setSystemTime(new Date("2026-09-30T18:42:37-03:00"));
    render(<Countdown />);

    const [months, days, hours, minutes] = readCards().map((card) =>
      Number(card.value),
    );

    const sum = new Date("2026-09-30T18:42:37-03:00");
    sum.setMonth(sum.getMonth() + months);
    sum.setTime(
      sum.getTime() + days * 86_400_000 + hours * 3_600_000 + minutes * 60_000,
    );

    const remainder = new Date(targetISO).getTime() - sum.getTime();
    expect(remainder).toBeGreaterThanOrEqual(0);
    expect(remainder).toBeLessThan(60_000);
  });

  it("drops the Meses card in the final month and keeps counting in days", () => {
    vi.setSystemTime(new Date("2026-11-30T15:00:00-03:00"));
    render(<Countdown />);

    expect(readCards()).toEqual([
      { label: "Dias", value: "06" },
      { label: "Horas", value: "00" },
      { label: "Minutos", value: "00" },
      { label: "Segundos", value: "00" },
    ]);
  });

  it("keeps the day card as the total remaining days once Meses is hidden", () => {
    vi.setSystemTime(new Date("2026-11-07T15:00:00-03:00"));
    render(<Countdown />);

    // 2026-11-07 to 2026-12-06 is under a calendar month, so it counts as 29 days.
    expect(readCards()).toEqual([
      { label: "Dias", value: "29" },
      { label: "Horas", value: "00" },
      { label: "Minutos", value: "00" },
      { label: "Segundos", value: "00" },
    ]);
  });

  it("uses four columns in the final month", () => {
    vi.setSystemTime(new Date("2026-11-30T15:00:00-03:00"));
    render(<Countdown />);

    const timer = screen.getByRole("timer");
    expect(timer).toHaveClass("md:grid-cols-4");
    expect(timer).not.toHaveClass("lg:grid-cols-5");
  });

  it("uses four columns while Meses is visible", () => {
    vi.setSystemTime(new Date("2026-08-24T15:00:00-03:00"));
    render(<Countdown />);

    const timer = screen.getByRole("timer");
    expect(timer).toHaveClass("md:grid-cols-4");
    expect(timer).not.toHaveClass("lg:grid-cols-5");
  });

  it("zeroes every unit once the target has passed", () => {
    vi.setSystemTime(new Date("2026-12-06T15:00:01-03:00"));
    render(<Countdown />);

    expect(readCards().map((card) => card.value)).toEqual([
      "00",
      "00",
      "00",
      "00",
    ]);
  });

  it("ticks once per second", () => {
    vi.setSystemTime(new Date("2026-12-06T14:59:00-03:00"));
    render(<Countdown />);

    expect(readCards()[3]?.value).toBe("00");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(readCards()[2]?.value).toBe("00");
    expect(readCards()[3]?.value).toBe("59");
  });
});
