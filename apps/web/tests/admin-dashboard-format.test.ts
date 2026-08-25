import { describe, expect, it } from "vitest";
import {
  dayKey,
  formatBrl,
  formatBrlShort,
  formatCentsInput,
  formatClockTime,
  formatDateTimeOfDay,
  formatDayLabel,
  formatLongDate,
  formatPhone,
  formatRelativeMinutes,
  formatShortDate,
  initials,
  parseBrlToCents,
  percentWidth,
  pluralize
} from "@/lib/admin-dashboard-format";

/** Built from local parts so the assertions hold in any CI timezone. */
const localIso = (
  year: number,
  monthIndex: number,
  day: number,
  hours = 12,
  minutes = 0
) => new Date(year, monthIndex, day, hours, minutes).toISOString();

describe("admin dashboard formatters", () => {
  it("takes up to two initials and skips short connectives", () => {
    expect(initials("Marcos Vinícius Alves")).toBe("MV");
    expect(initials("Amanda Moura e Chris Kaneda")).toBe("AM");
    expect(initials("")).toBe("—");
  });

  it("formats dates in the panel's short and long shapes", () => {
    const iso = localIso(2026, 7, 18, 20, 17);
    expect(formatShortDate(iso)).toBe("18 ago");
    expect(formatLongDate(iso)).toBe("18 ago 2026, 20h17");
    expect(formatDateTimeOfDay(iso)).toBe("20h17");
    expect(formatClockTime(iso)).toBe("20:17");
  });

  it("renders a dash for missing or unparseable timestamps", () => {
    expect(formatShortDate(null)).toBe("—");
    expect(formatLongDate(undefined)).toBe("—");
    expect(formatLongDate("not-a-date")).toBe("—");
    expect(formatDateTimeOfDay(null)).toBe("—");
  });

  it("labels chat days relative to a reference date", () => {
    const reference = new Date(2026, 7, 20, 10, 0);
    expect(formatDayLabel(localIso(2026, 7, 20, 9), reference)).toBe("Hoje");
    expect(formatDayLabel(localIso(2026, 7, 19, 9), reference)).toBe("Ontem");
    expect(formatDayLabel(localIso(2026, 7, 12, 9), reference)).toBe("12 de ago de 2026");
  });

  it("keys chat groups by calendar day, not by timestamp", () => {
    expect(dayKey(localIso(2026, 7, 18, 1))).toBe(dayKey(localIso(2026, 7, 18, 23)));
    expect(dayKey(localIso(2026, 7, 18, 23))).not.toBe(dayKey(localIso(2026, 7, 19, 1)));
  });

  it("formats Brazilian phone numbers with eight and nine digit lines", () => {
    expect(formatPhone("5511914362818")).toBe("+55 11 91436-2818");
    expect(formatPhone("551196365517")).toBe("+55 11 9636-5517");
    expect(formatPhone("")).toBe("—");
  });

  it("round-trips money between cents and the pt-BR input shape", () => {
    expect(formatBrl(145_000)).toBe("R$ 1.450,00");
    expect(formatBrlShort(145_000)).toBe("R$ 1.450");
    expect(formatCentsInput(145_000)).toBe("1.450,00");
    expect(parseBrlToCents("1.450,00")).toBe(145_000);
    expect(parseBrlToCents("R$ 69,90")).toBe(6_990);
    expect(parseBrlToCents("abc")).toBe(0);
  });

  it("clamps funding bar widths to the 0-100% range", () => {
    expect(percentWidth(50, 200)).toBe("25.0%");
    expect(percentWidth(300, 200)).toBe("100.0%");
    expect(percentWidth(10, 0)).toBe("0.0%");
  });

  it("pluralizes counters", () => {
    expect(pluralize(1, "pessoa", "pessoas")).toBe("1 pessoa");
    expect(pluralize(3, "pessoa", "pessoas")).toBe("3 pessoas");
  });

  it("formats the sidebar refresh caption relative to now", () => {
    const now = localIso(2026, 7, 20, 10, 30);
    const nowMs = new Date(now).getTime();
    expect(formatRelativeMinutes(null, nowMs)).toBe("—");
    expect(formatRelativeMinutes(now, nowMs)).toBe("Atualizado agora mesmo");
    expect(formatRelativeMinutes(localIso(2026, 7, 20, 10, 29), nowMs)).toBe("Atualizado há 1 min");
    expect(formatRelativeMinutes(localIso(2026, 7, 20, 9, 15), nowMs)).toBe("Atualizado há 75 min");
  });
});
