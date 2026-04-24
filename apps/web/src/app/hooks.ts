import { useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);

    update();
    query.addEventListener("change", update);

    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

export function useCountdown(targetIso: string) {
  const target = new Date(targetIso).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const rawDistance = target - now;
  const distance = Math.max(rawDistance, 0);

  return {
    isComplete: rawDistance <= 0,
    days: Math.floor(distance / (1000 * 60 * 60 * 24)),
    hours: Math.floor((distance / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((distance / (1000 * 60)) % 60),
    seconds: Math.floor((distance / 1000) % 60)
  };
}

export function useRevealItems(reducedMotion: boolean): void {
  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>(".reveal-item"));

    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      items.forEach((item) => item.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );

    items.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, [reducedMotion]);
}

export function useMobileRsvpShortcut(): void {
  useEffect(() => {
    const update = () => {
      const heroSection = document.getElementById("inicio");
      const mobileRsvp = document.querySelector(".mobile-rsvp");

      if (!heroSection || !mobileRsvp) {
        return;
      }

      const revealPoint = heroSection.offsetTop + heroSection.offsetHeight - window.innerHeight * 0.24;
      const actionInView = Array.from(
        document.querySelectorAll<HTMLElement>("[data-rsvp-action-surface]")
      ).some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.top < window.innerHeight - 16 && rect.bottom > 16;
      });

      document.body.classList.toggle("has-mobile-rsvp", window.scrollY > revealPoint && !actionInView);
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      document.body.classList.remove("has-mobile-rsvp");
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
}
