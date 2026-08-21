/** Pure pt-BR formatters shared by every dashboard screen. */

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const pad = (value: number) => String(value).padStart(2, "0");

/** Up to two initials, skipping short connectives ("Marcos de Souza" -> "MS"). */
export function initials(name: string) {
  const letters = name
    .split(" ")
    .filter((word) => word.length > 2)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return letters || "—";
}

/** "18 ago" — the compact form used in tables and timelines. */
export function formatShortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** "18 ago 2026, 20h18" — the long form used in detail fields. */
export function formatLongDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${pad(date.getHours())}h${pad(date.getMinutes())}`;
}

/** "20h18" of a long date, or "—" when there is no timestamp. */
export function formatDateTimeOfDay(iso: string | null | undefined) {
  const long = formatLongDate(iso);
  return long === "—" ? "—" : long.split(", ")[1];
}

/** "20:18" — chat bubble timestamps. */
export function formatClockTime(iso: string) {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Calendar-day identity, so consecutive chat messages group under one separator. */
export function dayKey(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** "Hoje" / "Ontem" / "18 de agosto de 2026" relative to `reference`. */
export function formatDayLabel(iso: string, reference: Date = new Date()) {
  const date = new Date(iso);
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOfDay(reference) - startOfDay(date)) / 86_400_000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Ontem";
  return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

/** E.164 digits to "+55 11 91234-5678". Falls back to the raw value when too short to split. */
export function formatPhone(phoneNumber: string) {
  const digits = String(phoneNumber).replace(/\D/g, "");
  if (digits.length < 10) return digits ? `+${digits}` : "—";
  const country = digits.slice(0, 2);
  const area = digits.slice(2, 4);
  const rest = digits.slice(4);
  const split = rest.length > 8 ? 5 : 4;
  return `+${country} ${area} ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** "R$ 1.450,00" */
export function formatBrl(cents: number) {
  return `R$ ${(cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/** "R$ 1.450" — headline figures, where the cents are noise. */
export function formatBrlShort(cents: number) {
  return `R$ ${Math.round(cents / 100).toLocaleString("pt-BR")}`;
}

/** Parses a pt-BR money input ("1.450,00") into cents; 0 when unparseable. */
export function parseBrlToCents(value: string) {
  const normalized = parseFloat(
    String(value).replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, "")
  );
  return Number.isNaN(normalized) ? 0 : Math.round(normalized * 100);
}

/** Cents back into the "1.450,00" shape a money input expects. */
export function formatCentsInput(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/** Clamped percentage string for the funding bars. */
export function percentWidth(part: number, whole: number) {
  const raw = whole ? (part / whole) * 100 : 0;
  return `${Math.max(0, Math.min(100, raw)).toFixed(1)}%`;
}

/** "1 pessoa" / "3 pessoas" — pluralization used across counters. */
export function pluralize(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}
