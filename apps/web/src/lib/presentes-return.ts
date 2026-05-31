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

  const scroll = () => {
    const section = document.getElementById("presentes");
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(scroll);
    return;
  }

  window.setTimeout(scroll, 0);
}
