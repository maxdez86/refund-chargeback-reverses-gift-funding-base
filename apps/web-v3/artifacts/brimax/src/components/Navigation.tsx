import React from "react";
import { Link } from "wouter";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const navLinks = [
  { href: "#historia", label: "Nossa História" },
  { href: "#pre-wedding", label: "Pré-Wedding" },
  { href: "#local", label: "Local" },
  { href: "#padrinhos", label: "Padrinhos" },
  { href: "#fornecedores", label: "Fornecedores" },
  { href: "#presentes", label: "Presentes" },
  { href: "#faq", label: "FAQ" },
];

export function Navigation() {
  const [isScrolled, setIsScrolled] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const element = document.querySelector(href);
    if (element) {
      const offset = 80;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
    }
  };

  return (
    <>
      <header
        className={`fixed top-0 w-full z-50 transition-all duration-500 ${
          isScrolled
            ? "bg-background/80 backdrop-blur-md border-b border-border/50 py-3 shadow-sm"
            : "bg-transparent py-5"
        }`}
      >
        <div className="container mx-auto px-6 md:px-12 flex items-center justify-between">
          <a
            href="#inicio"
            onClick={(e) => scrollTo(e, "#inicio")}
            className="font-serif text-2xl font-medium tracking-tight text-foreground"
            aria-label="Brimax — voltar ao início"
          >
            Brimax
          </a>

          {/* Desktop Nav */}
          <nav className="hidden lg:flex items-center gap-8">
            <ul className="flex items-center gap-6">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    onClick={(e) => scrollTo(e, link.href)}
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
            <Button
              variant="default"
              size="sm"
              className="font-medium rounded-full px-6"
              onClick={() => {
                const el = document.querySelector("#confirmar-presenca");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Confirmar Presença
            </Button>
          </nav>

          {/* Mobile Menu Toggle */}
          <button
            className="lg:hidden p-2 text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-background/95 backdrop-blur-sm lg:hidden pt-24 px-6 flex flex-col h-[100dvh]">
          <nav className="flex flex-col gap-6 items-center text-center mt-12">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={(e) => scrollTo(e, link.href)}
                className="text-xl font-serif text-foreground/80 hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <Button
              className="mt-8 rounded-full px-8 py-6 text-lg w-full max-w-xs"
              onClick={() => {
                setMobileMenuOpen(false);
                const el = document.querySelector("#confirmar-presenca");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              Confirmar Presença
            </Button>
          </nav>
        </div>
      )}

      {/* Floating Mobile CTA Bar */}
      <div className={`fixed bottom-0 left-0 right-0 p-4 z-30 lg:hidden transition-transform duration-500 ${isScrolled && !mobileMenuOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="bg-background/90 backdrop-blur-md rounded-2xl shadow-lg border border-border/50 p-2 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-xl bg-white/50"
            onClick={() => {
              const el = document.querySelector("#presentes");
              if (el) el.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Lista de Presentes
          </Button>
          <Button
            className="flex-1 rounded-xl"
            onClick={() => {
              const el = document.querySelector("#confirmar-presenca");
              if (el) el.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Confirmar Presença
          </Button>
        </div>
      </div>
    </>
  );
}