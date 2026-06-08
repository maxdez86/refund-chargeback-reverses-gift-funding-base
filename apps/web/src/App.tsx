### Test
import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Navigation } from "@/components/Navigation";
import { PaymentConfirmationDialog } from "@/components/PaymentConfirmationDialog";
import { Hero } from "@/components/sections/Hero";
import { Countdown } from "@/components/sections/Countdown";
import { Story } from "@/components/sections/Story";
import { StoryReview } from "@/components/sections/StoryReview";
import { PreWedding } from "@/components/sections/PreWedding";
import { Local } from "@/components/sections/Local";
import { Padrinhos } from "@/components/sections/Padrinhos";
import { Fornecedores } from "@/components/sections/Fornecedores";
import { Presentes } from "@/components/sections/Presentes";
import { RSVP } from "@/components/sections/RSVP";
import { GuestMessages } from "@/components/sections/GuestMessages";
import { FAQ } from "@/components/sections/FAQ";
import { Footer } from "@/components/sections/Footer";
import { scrollToAnchor } from "@/lib/scroll-to-anchor";

const queryClient = new QueryClient();

// Mirrors the in-app "Confirmar Presença" button: scrolls to the captured hash
// (via scrollToAnchor) once the page has settled, so direct visits to
// /#confirmar-presenca land identically to a button click. The captured hash
// comes from the head-script in index.html, which strips it pre-load to suppress
// the browser's premature native anchor jump.
function useInitialHashScroll() {
  useEffect(() => {
    const w = window as Window & { __brimaxInitialHash?: string };
    const hash = w.__brimaxInitialHash || window.location.hash;
    if (!hash || hash === "#") return;

    let cancelled = false;
    let cancelScroll: (() => void) | null = null;
    delete w.__brimaxInitialHash;

    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search + hash
    );

    const run = async () => {
      if (document.readyState !== "complete") {
        await new Promise<void>((resolve) =>
          window.addEventListener("load", () => resolve(), { once: true })
        );
      }
      const fonts = (
        document as Document & { fonts?: { ready: Promise<unknown> } }
      ).fonts;
      if (fonts?.ready) {
        try {
          await fonts.ready;
        } catch {
          /* ignore font-loading errors */
        }
      }
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      if (cancelled) return;

      // scrollToAnchor settles the landing position over ~3s, re-correcting for
      // any layout shift above the target (e.g. lazy-loaded images) that would
      // otherwise leave a cold/incognito first visit parked short. Non-anchor
      // hashes (e.g. "#paymentId=...&paymentStatus=success") resolve to a no-op
      // inside the helper rather than crashing.
      cancelScroll = scrollToAnchor(hash, { settleMs: 3000 });
    };

    void run();
    return () => {
      cancelled = true;
      cancelScroll?.();
    };
  }, []);
}

function Home() {
  useInitialHashScroll();
  return (
    <div className="min-h-screen w-full bg-background flex flex-col">
      <Navigation />
      <main className="flex-1">
        <Hero />
        <Countdown />
        <Story />
        <StoryReview />
        <PreWedding />
        <Local />
        <Padrinhos />
        <Fornecedores />
        <Presentes />
        <RSVP />
        <GuestMessages />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <PaymentConfirmationDialog />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
