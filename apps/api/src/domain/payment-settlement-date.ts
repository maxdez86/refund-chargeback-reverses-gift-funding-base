const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function logNormalizationFailure(source: "asaas", field: "confirmedOn" | "receivedOn", value: string) {
  console.warn(JSON.stringify({ metric: "PAYMENT_SETTLEMENT_DATE_NORMALIZATION_FAILED", source, field, value }));
}

export function normalizeSettlementDate(
  rawValue: string | undefined,
  field: "confirmedOn" | "receivedOn",
  source: "asaas" = "asaas"
) {
  if (!rawValue) {
    return undefined;
  }

  const value = rawValue.trim();

  if (!value) {
    return undefined;
  }

  if (!ISO_DATE_REGEX.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    logNormalizationFailure(source, field, rawValue);
    return undefined;
  }

  return value;
}
