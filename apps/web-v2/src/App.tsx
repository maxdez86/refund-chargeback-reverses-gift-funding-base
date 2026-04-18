import { useEffect, useMemo, useState, type FormEvent, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { motion } from "framer-motion";
import { Calendar, ChevronDown, Clock, MapPin, Menu, X } from "lucide-react";
import { Toaster, toast } from "sonner";
import heroImg from "./assets/hero.jpg";
import storyImg from "./assets/story.jpg";
import venueImg from "./assets/venue.jpg";
import { faqs, giftItems, storyMilestones, vendors, wedding, weddingParty } from "./content";

const navLinks = [
  { href: "#inicio", label: "Início" },
  { href: "#historia", label: "Nossa História" },
  { href: "#cerimonia", label: "Cerimônia" },
  { href: "#padrinhos", label: "Padrinhos" },
  { href: "#presentes", label: "Presentes" },
  { href: "#rsvp", label: "RSVP" },
  { href: "#ao-vivo", label: "Ao Vivo" },
  { href: "#faq", label: "FAQ" }
];

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0
});

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function diff(target: number) {
  const ms = Math.max(0, target - Date.now());
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);

  return { days, hours, minutes, seconds };
}

function Button({
  children,
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function AnchorButton({
  children,
  className,
  href,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      {children}
    </a>
  );
}

function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
}

function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  );
}

function Label({
  children,
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("text-sm font-medium leading-none", className)} {...props}>
      {children}
    </label>
  );
}

function SiteNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-500",
          scrolled ? "border-b border-border/60 bg-background/80 backdrop-blur-xl" : "bg-transparent"
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 md:h-20 md:px-10">
          <a href="#inicio" className="font-serif text-xl tracking-[0.25em] text-foreground md:text-2xl">
            {wedding.monogram}
          </a>

          <nav className="hidden items-center gap-8 lg:flex">
            {navLinks.slice(1, -1).map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-xs uppercase tracking-[0.18em] text-ink-soft transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <AnchorButton
              href="#rsvp"
              className="hidden h-8 bg-gradient-gold px-3 text-xs text-ink shadow-soft hover:opacity-90 md:inline-flex"
            >
              Confirmar Presença
            </AnchorButton>
            <button
              type="button"
              aria-label="Abrir menu"
              onClick={() => setOpen(true)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-foreground lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <div
        className={cn(
          "fixed inset-0 z-[60] bg-background transition-opacity duration-300 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      >
        <div className="flex h-16 items-center justify-between px-5 md:h-20">
          <span className="font-serif text-xl tracking-[0.25em]">{wedding.monogram}</span>
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex flex-col items-center gap-6 px-6 pt-10">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="font-serif text-3xl text-foreground"
            >
              {link.label}
            </a>
          ))}
          <AnchorButton
            href="#rsvp"
            onClick={() => setOpen(false)}
            className="mt-6 h-10 bg-gradient-gold px-8 text-base text-ink hover:opacity-90"
          >
            Confirmar Presença
          </AnchorButton>
        </nav>
      </div>

      <a
        href="#rsvp"
        className={cn(
          "fixed inset-x-5 bottom-5 z-40 flex h-12 items-center justify-center rounded-full bg-gradient-gold text-sm font-medium tracking-wide text-ink shadow-elegant transition-all duration-500 md:hidden",
          scrolled && !open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-6 opacity-0"
        )}
      >
        Confirmar Presença
      </a>
    </>
  );
}

function HeroSection() {
  return (
    <section id="inicio" className="relative flex min-h-[100svh] items-center justify-center overflow-hidden">
      <div className="absolute inset-0">
        <img
          src={heroImg}
          alt="Casal de mãos dadas ao pôr do sol"
          className="h-full w-full object-cover"
          fetchPriority="high"
        />
        <div className="bg-gradient-hero absolute inset-0" />
        <div className="absolute inset-0 bg-ink/20" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mx-auto max-w-4xl px-6 text-center text-ivory"
      >
        <p className="text-xs uppercase tracking-[0.4em] text-champagne">
          {wedding.weekday} · {wedding.dateShort}
        </p>
        <h1 className="text-balance mt-6 font-serif text-[clamp(3.5rem,11vw,8.5rem)] leading-[0.95] tracking-tight">
          {wedding.brideShort}
          <span className="mx-3 italic text-champagne">&</span>
          {wedding.groomShort}
        </h1>
        <div className="mx-auto my-8 h-px w-24 bg-champagne/70" />
        <p className="mx-auto max-w-xl font-serif text-lg italic text-ivory/90 md:text-xl">
          Dois caminhos, uma só história. Celebre com a gente.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <AnchorButton
            href="#rsvp"
            className="h-12 min-w-[220px] bg-gradient-gold px-8 text-ink hover:opacity-90"
          >
            Confirmar Presença
          </AnchorButton>
          <AnchorButton
            href="#presentes"
            className="h-12 min-w-[220px] border border-ivory/60 bg-transparent px-8 text-ivory hover:bg-ivory/10"
          >
            Lista de Presentes
          </AnchorButton>
        </div>
      </motion.div>
    </section>
  );
}

function CountdownSection() {
  const target = useMemo(() => new Date(wedding.dateISO).getTime(), []);
  const [time, setTime] = useState(() => diff(target));

  useEffect(() => {
    const id = window.setInterval(() => setTime(diff(target)), 1000);
    return () => window.clearInterval(id);
  }, [target]);

  const items = [
    { label: "Dias", value: time.days },
    { label: "Horas", value: time.hours },
    { label: "Minutos", value: time.minutes },
    { label: "Segundos", value: time.seconds }
  ];

  return (
    <section className="bg-sand py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">A contagem começou</p>
        <h2 className="text-balance mt-4 font-serif text-3xl md:text-5xl">
          Faltam pouquíssimos dias para dizermos sim.
        </h2>
        <div className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
          {items.map((item) => (
            <div key={item.label} className="rounded-2xl border border-border bg-background/60 p-6 shadow-soft md:p-8">
              <div className="font-serif text-5xl text-foreground tabular-nums md:text-6xl">
                {String(item.value).padStart(2, "0")}
              </div>
              <div className="mt-2 text-xs uppercase tracking-[0.25em] text-ink-soft">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StorySection() {
  return (
    <section id="historia" className="bg-background py-24 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">Nossa história</p>
          <h2 className="text-balance mt-4 font-serif text-4xl md:text-6xl">
            De um encontro casual a um para sempre.
          </h2>
          <div className="gold-divider mx-auto mt-8 w-24" />
        </div>

        <div className="mt-16 grid gap-12 md:grid-cols-[1fr_1.2fr] md:items-start md:gap-16">
          <div className="overflow-hidden rounded-3xl shadow-elegant md:sticky md:top-28">
            <img src={storyImg} alt="Alianças sobre tecido" loading="lazy" className="h-full w-full object-cover" />
          </div>

          <ol className="relative space-y-10 border-l border-border pl-8 md:space-y-14">
            {storyMilestones.map((milestone, index) => (
              <motion.li
                key={milestone.year}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.7, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                className="relative"
              >
                <span className="absolute -left-[37px] top-2 h-3 w-3 rounded-full bg-gradient-gold ring-4 ring-background" />
                <div className="text-xs uppercase tracking-[0.3em] text-champagne-deep">{milestone.year}</div>
                <h3 className="mt-2 font-serif text-2xl md:text-3xl">{milestone.title}</h3>
                <p className="mt-3 max-w-prose text-base leading-relaxed text-ink-soft">
                  {milestone.description}
                </p>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function CeremonySection() {
  const items = [
    { icon: Calendar, label: "Data", value: `${wedding.weekday}, ${wedding.dateLong}` },
    {
      icon: Clock,
      label: "Cerimônia",
      value: `${wedding.ceremonyTime} · Recepção a partir das ${wedding.receptionTime}`
    },
    { icon: MapPin, label: "Local", value: `${wedding.venueName} — ${wedding.venueAddress}` }
  ];

  return (
    <section id="cerimonia" className="relative overflow-hidden bg-ink py-24 text-ivory md:py-36">
      <div className="absolute inset-0 opacity-30">
        <img src={venueImg} alt="" loading="lazy" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-ink/60" />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-champagne">Cerimônia & Festa</p>
        <h2 className="text-balance mt-4 font-serif text-4xl md:text-6xl">
          Onde nossa nova vida começa.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-ivory/80">
          Será um dia inteiro pensado com carinho. Chegue cedo, fique até o fim — queremos vocês perto da gente.
        </p>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {items.map(({ icon: Icon, label, value }) => (
            <div
              key={label}
              className="rounded-2xl border border-ivory/15 bg-ivory/5 p-8 text-left backdrop-blur-sm"
            >
              <Icon className="h-6 w-6 text-champagne" />
              <div className="mt-4 text-xs uppercase tracking-[0.25em] text-champagne">{label}</div>
              <p className="mt-2 font-serif text-xl leading-snug text-ivory">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-12">
          <AnchorButton
            href={wedding.mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="h-10 bg-gradient-gold px-8 text-ink hover:opacity-90"
          >
            Como chegar
          </AnchorButton>
          <p className="mt-4 text-sm text-ivory/70">Traje: {wedding.dressCode}</p>
        </div>
      </div>
    </section>
  );
}

function PartySection() {
  const madrinhas = weddingParty.filter((person) => person.role === "Madrinha");
  const padrinhos = weddingParty.filter((person) => person.role === "Padrinho");

  return (
    <section id="padrinhos" className="bg-background py-24 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">Padrinhos & Madrinhas</p>
          <h2 className="text-balance mt-4 font-serif text-4xl md:text-5xl">
            As pessoas que caminham com a gente.
          </h2>
          <p className="mt-6 text-ink-soft">
            Quem segura nossa mão nos dias bons — e nos não tão bons. Para sempre, obrigado.
          </p>
          <div className="gold-divider mx-auto mt-8 w-24" />
        </div>

        <div className="mt-16 grid gap-12 md:grid-cols-2">
          <PartyColumn title="Madrinhas" people={madrinhas} />
          <PartyColumn title="Padrinhos" people={padrinhos} />
        </div>
      </div>
    </section>
  );
}

function PartyColumn({
  people,
  title
}: {
  people: ReadonlyArray<{ name: string; relation: string }>;
  title: string;
}) {
  return (
    <div>
      <h3 className="font-serif text-2xl text-champagne-deep">{title}</h3>
      <ul className="mt-6 divide-y divide-border">
        {people.map((person, index) => (
          <motion.li
            key={person.name}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: index * 0.04 }}
            className="flex items-baseline justify-between gap-4 py-4"
          >
            <span className="font-serif text-xl text-foreground">{person.name}</span>
            <span className="text-sm text-ink-soft">{person.relation}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function VendorsSection() {
  return (
    <section className="bg-sand py-20 md:py-24">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">Por trás do nosso dia</p>
        <h2 className="text-balance mt-4 font-serif text-3xl md:text-4xl">
          Profissionais que tornaram tudo possível.
        </h2>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-x-8 gap-y-6 md:grid-cols-4">
          {vendors.map((vendor) => (
            <div key={vendor.name} className="text-center">
              <div className="font-serif text-lg text-foreground">{vendor.name}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.2em] text-ink-soft">
                {vendor.role}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function GiftsSection() {
  return (
    <section id="presentes" className="bg-background py-24 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">Lista de presentes</p>
          <h2 className="text-balance mt-4 font-serif text-4xl md:text-5xl">
            Sua presença é o nosso maior presente.
          </h2>
          <p className="mt-6 text-ink-soft">
            Se desejar nos presentear, escolhemos com carinho algumas opções. Cada gesto é guardado com gratidão.
          </p>
          <div className="gold-divider mx-auto mt-8 w-24" />
        </div>

        <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {giftItems.map((gift, index) => (
            <motion.article
              key={gift.id}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: (index % 3) * 0.05 }}
              className="group flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-shadow hover:shadow-elegant"
            >
              <div className="text-3xl">{gift.emoji}</div>
              <h3 className="mt-4 font-serif text-xl text-foreground">{gift.name}</h3>
              <p className="mt-2 flex-1 text-sm text-ink-soft">{gift.description}</p>
              <div className="mt-6 flex items-center justify-between">
                <span className="font-serif text-lg text-champagne-deep">{brl.format(gift.price)}</span>
                <Button
                  className="h-8 border border-champagne-deep/40 bg-background px-3 text-xs text-foreground shadow-sm hover:bg-champagne/20"
                  onClick={() =>
                    toast.success("Quase lá!", {
                      description:
                        "Em breve enviaremos os dados de pagamento por e-mail. Obrigado pelo carinho ❤"
                    })
                  }
                >
                  Presentear
                </Button>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

function RsvpSection() {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim();

    if (!name) {
      toast.error("Por favor, conte seu nome para a gente.");
      return;
    }

    setLoading(true);
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    setLoading(false);
    form.reset();
    toast.success("Presença confirmada!", {
      description: "Que alegria ter você com a gente. Em breve enviaremos mais detalhes."
    });
  }

  return (
    <section id="rsvp" className="bg-sand py-24 md:py-36">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">RSVP</p>
          <h2 className="text-balance mt-4 font-serif text-4xl md:text-5xl">
            Sua presença é o nosso maior presente.
          </h2>
          <p className="mt-6 text-ink-soft">
            Por favor, confirme até <strong className="text-foreground">{wedding.rsvpDeadline}</strong>. É rapidinho.
          </p>
          <div className="gold-divider mx-auto mt-8 w-24" />
        </div>

        <form
          onSubmit={handleSubmit}
          className="mt-12 space-y-5 rounded-3xl border border-border bg-background p-6 shadow-soft md:p-10"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Nome completo</Label>
            <Input id="name" name="name" placeholder="Como devemos te chamar?" required />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" placeholder="seu@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="guests">Quantas pessoas?</Label>
              <Input id="guests" name="guests" type="number" min={1} max={6} defaultValue={1} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Você poderá comparecer?</Label>
            <div className="flex gap-3">
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm has-[:checked]:border-champagne-deep has-[:checked]:bg-accent/40">
                <input type="radio" name="attending" value="sim" defaultChecked className="accent-champagne-deep" />
                Sim, vou estar lá
              </label>
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-border bg-card px-4 py-3 text-sm has-[:checked]:border-champagne-deep has-[:checked]:bg-accent/40">
                <input type="radio" name="attending" value="nao" className="accent-champagne-deep" />
                Infelizmente não
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Recado para os noivos (opcional)</Label>
            <Textarea id="message" name="message" rows={4} placeholder="Deixe um carinho aqui..." />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="h-10 w-full bg-gradient-gold px-8 text-ink hover:opacity-90"
          >
            {loading ? "Enviando..." : "Confirmar minha presença"}
          </Button>
        </form>
      </div>
    </section>
  );
}

function LiveSection() {
  return (
    <section id="ao-vivo" className="bg-background py-24 md:py-32">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">Transmissão ao vivo</p>
          <h2 className="text-balance mt-4 font-serif text-4xl md:text-5xl">
            Não pode estar com a gente? Acompanhe ao vivo.
          </h2>
          <p className="mt-6 text-ink-soft">
            A transmissão começa às {wedding.ceremonyTime}, no horário de Brasília. Prepare uma taça e celebre conosco de onde estiver.
          </p>
          <div className="gold-divider mx-auto mt-8 w-24" />
        </div>

        <div className="mt-12 overflow-hidden rounded-3xl border border-border bg-ink shadow-elegant">
          <div className="aspect-video w-full">
            <iframe
              src={wedding.liveUrl}
              title="Transmissão ao vivo do casamento"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
              loading="lazy"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqItem({
  answer,
  isOpen,
  onClick,
  question
}: {
  answer: string;
  isOpen: boolean;
  onClick: () => void;
  question: string;
}) {
  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center justify-between py-4 text-left font-serif text-lg text-foreground md:text-xl"
      >
        <span>{question}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200", isOpen && "rotate-180")} />
      </button>
      <div className={cn("overflow-hidden text-base leading-relaxed text-ink-soft transition-[grid-template-rows] duration-200", isOpen ? "grid grid-rows-[1fr]" : "grid grid-rows-[0fr]")}>
        <div className="overflow-hidden">
          <div className="pb-4">{answer}</div>
        </div>
      </div>
    </div>
  );
}

function FaqSection() {
  const [openItem, setOpenItem] = useState<string | null>("item-0");

  return (
    <section id="faq" className="bg-sand py-24 md:py-32">
      <div className="mx-auto max-w-3xl px-6">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-champagne-deep">Perguntas frequentes</p>
          <h2 className="text-balance mt-4 font-serif text-4xl md:text-5xl">Tire suas dúvidas.</h2>
          <div className="gold-divider mx-auto mt-8 w-24" />
        </div>

        <div className="mt-12">
          {faqs.map((faq, index) => {
            const key = `item-${index}`;
            const isOpen = openItem === key;
            return (
              <FaqItem
                key={key}
                question={faq.question}
                answer={faq.answer}
                isOpen={isOpen}
                onClick={() => setOpenItem(isOpen ? null : key)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="bg-ink py-16 text-ivory md:py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <div className="font-serif text-2xl tracking-[0.3em] text-champagne">{wedding.monogram}</div>
        <p className="mx-auto mt-6 max-w-md font-serif text-2xl italic text-ivory md:text-3xl">
          Com amor, {wedding.brideShort} & {wedding.groomShort}.
        </p>
        <p className="mt-3 text-sm text-ivory/70">
          {wedding.dateLong} · {wedding.city}
        </p>

        <div className="gold-divider mx-auto my-10 w-24" />

        <div className="flex flex-col items-center justify-center gap-3 text-sm text-ivory/70 md:flex-row md:gap-8">
          <a href={`mailto:${wedding.contactEmail}`} className="hover:text-champagne">
            {wedding.contactEmail}
          </a>
          <span className="hidden md:inline">·</span>
          <span>Instagram {wedding.instagram}</span>
          <span className="hidden md:inline">·</span>
          <span>{wedding.domain}</span>
        </div>
      </div>
    </footer>
  );
}

export function App() {
  return (
    <div className="min-h-screen bg-background">
      <SiteNav />
      <main>
        <HeroSection />
        <CountdownSection />
        <StorySection />
        <CeremonySection />
        <PartySection />
        <VendorsSection />
        <GiftsSection />
        <RsvpSection />
        <LiveSection />
        <FaqSection />
      </main>
      <SiteFooter />
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast: "bg-background text-foreground border-border shadow-lg",
            description: "text-muted-foreground",
            actionButton: "bg-primary text-primary-foreground",
            cancelButton: "bg-muted text-muted-foreground"
          }
        }}
      />
    </div>
  );
}
