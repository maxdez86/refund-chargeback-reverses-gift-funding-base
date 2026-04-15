import { FaqSection } from "../features/faq/FaqSection";
import { LandingSection } from "../features/landing/LandingSection";
import { RegistrySection } from "../features/registry/RegistrySection";
import { RsvpSection } from "../features/rsvp/RsvpSection";
import "./styles.css";

export function App() {
  return (
    <main className="page-shell">
      <LandingSection />
      <section className="content-grid">
        <RsvpSection />
        <RegistrySection />
        <FaqSection />
      </section>
    </main>
  );
}
