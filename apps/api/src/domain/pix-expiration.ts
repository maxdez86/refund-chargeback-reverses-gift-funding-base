const ISO_DATETIME_WITH_OFFSET_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ASAAS_LOCAL_DATETIME_REGEX =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})$/;
const SAO_PAULO_OFFSET = "-03:00";

function logNormalizationFailure(source: "asaas" | "stored", value: string) {
  console.warn(JSON.stringify({ metric: "PIX_EXPIRATION_NORMALIZATION_FAILED", source, value }));
}

export function normalizePixExpiresAt(rawValue: string | undefined, source: "asaas" | "stored") {
  if (!rawValue) {
    return undefined;
  }

  const value = rawValue.trim();

  if (!value) {
    return undefined;
  }

  if (ISO_DATETIME_WITH_OFFSET_REGEX.test(value)) {
    return value;
  }

  const match = ASAAS_LOCAL_DATETIME_REGEX.exec(value);

  if (!match?.groups) {
    logNormalizationFailure(source, rawValue);
    return undefined;
  }

  const { year, month, day, hour, minute, second } = match.groups;
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}${SAO_PAULO_OFFSET}`;

  if (Number.isNaN(Date.parse(normalized))) {
    logNormalizationFailure(source, rawValue);
    return undefined;
  }

  return normalized;
}
