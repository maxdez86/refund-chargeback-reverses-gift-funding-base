import { scrollToAnchor } from "@/lib/scroll-to-anchor";

type ReturnToPresentesOptions = {
  clearPaymentParams?: boolean;
};

const PRESENTES_HASH = "#presentes";

export function returnToPresentes(options: ReturnToPresentesOptions = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const w = window as Window & { __brimaxInitialHash?: string };
  if (w.__brimaxInitialHash) {
    delete w.__brimaxInitialHash;
  }

  const url = new URL(window.location.href);

  if (options.clearPaymentParams) {
    url.searchParams.delete("paymentId");
    url.searchParams.delete("paymentStatus");
  }

  url.hash = "presentes";
  window.history.replaceState({}, "", `${url.pathname}${url.search}${PRESENTES_HASH}`);

  // scrollToAnchor issues an immediate scroll and then re-corrects over its
  // settle window, subsuming the single requestAnimationFrame defer this used
  // to need to wait for layout.
  scrollToAnchor(PRESENTES_HASH);
}
