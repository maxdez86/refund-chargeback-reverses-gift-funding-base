import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Navigation } from "@/components/Navigation";
import { Hero } from "@/components/sections/Hero";
import { Countdown } from "@/components/sections/Countdown";
import { Story } from "@/components/sections/Story";
import { PreWedding } from "@/components/sections/PreWedding";
import { Local } from "@/components/sections/Local";
import { Padrinhos } from "@/components/sections/Padrinhos";
import { Fornecedores } from "@/components/sections/Fornecedores";
import { Presentes } from "@/components/sections/Presentes";
import { RSVP } from "@/components/sections/RSVP";
import { FAQ } from "@/components/sections/FAQ";
import { Footer } from "@/components/sections/Footer";

const queryClient = new QueryClient();

function Home() {
  return (
    <div className="min-h-screen w-full bg-background flex flex-col">
      <Navigation />
      <main className="flex-1">
        <Hero />
        <Countdown />
        <Story />
        <PreWedding />
        <Local />
        <Padrinhos />
        <Fornecedores />
        <Presentes />
        <RSVP />
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
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
