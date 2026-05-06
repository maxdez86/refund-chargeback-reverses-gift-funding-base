import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ArrowLeft, Check, AlertCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

type InvitationGroup = {
  id: string;
  primaryName: string;
  guests: string[];
};

const invitationGroups: InvitationGroup[] = [
  {
    id: "grupo-amanda-cris",
    primaryName: "Amanda e Chris",
    guests: ["Amanda", "Chris"],
  },
  {
    id: "grupo-fabi-fernando",
    primaryName: "Fabi e Fernando",
    guests: ["Fabi", "Fernando"],
  },
  {
    id: "grupo-tami-marcos",
    primaryName: "Tami e Marcos",
    guests: ["Tami", "Marcos"],
  },
  {
    id: "grupo-elis-son",
    primaryName: "Elis e Son",
    guests: ["Elis", "Son"],
  },
  {
    id: "grupo-kelly-sa",
    primaryName: "Kelly e Sá",
    guests: ["Kelly", "Sá"],
  },
  {
    id: "grupo-lila-welton",
    primaryName: "Lila e Welton",
    guests: ["Lila", "Welton"],
  },
  {
    id: "grupo-nilza-cerqueira",
    primaryName: "Nilza e Cerqueira",
    guests: ["Nilza", "Cerqueira"],
  },
  {
    id: "grupo-debora-nael",
    primaryName: "Débora e Nael",
    guests: ["Débora", "Nael"],
  },
  {
    id: "grupo-nessa-carlos",
    primaryName: "Nessa e Carlos",
    guests: ["Nessa", "Carlos"],
  },
  {
    id: "grupo-nuza-sid",
    primaryName: "Nuza e Sid",
    guests: ["Nuza", "Sid"],
  },
  {
    id: "grupo-carol-igor",
    primaryName: "Carol e Igor",
    guests: ["Carol", "Igor"],
  },
  {
    id: "grupo-alice",
    primaryName: "Alice",
    guests: ["Alice"],
  },
  {
    id: "grupo-raquel",
    primaryName: "Raquel",
    guests: ["Raquel"],
  },
  {
    id: "grupo-julia",
    primaryName: "Julia",
    guests: ["Julia"],
  },
  {
    id: "grupo-drielly",
    primaryName: "Drielly",
    guests: ["Drielly"],
  },
  {
    id: "grupo-ronaldo",
    primaryName: "Ronaldo",
    guests: ["Ronaldo"],
  },
  {
    id: "grupo-cristiane-juliano",
    primaryName: "Cristiane e Juliano",
    guests: ["Cristiane", "Juliano"],
  },
];

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

type LookupResult =
  | { kind: "empty" }
  | { kind: "not-found" }
  | { kind: "ambiguous"; groups: InvitationGroup[] }
  | { kind: "found"; group: InvitationGroup };

function lookupGroups(query: string): LookupResult {
  const q = normalize(query);
  if (!q) return { kind: "empty" };

  const exact = invitationGroups.filter((g) =>
    g.guests.some((name) => normalize(name) === q)
  );
  if (exact.length === 1) return { kind: "found", group: exact[0] };
  if (exact.length > 1) return { kind: "ambiguous", groups: exact };

  const partial = invitationGroups.filter((g) =>
    g.guests.some((name) => {
      const n = normalize(name);
      return n.includes(q) || q.includes(n);
    })
  );
  if (partial.length === 1) return { kind: "found", group: partial[0] };
  if (partial.length > 1) return { kind: "ambiguous", groups: partial };

  return { kind: "not-found" };
}

export function RSVP() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LookupResult>({ kind: "empty" });
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState<{
    group: InvitationGroup;
    confirmations: { name: string; attending: boolean }[];
  } | null>(null);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const r = lookupGroups(query);
    setResult(r);
    if (r.kind === "found") {
      const init: Record<string, boolean> = {};
      r.group.guests.forEach((g) => (init[g] = true));
      setSelections(init);
    } else {
      setSelections({});
    }
    setSubmitted(null);
  };

  const selectGroup = (group: InvitationGroup) => {
    setResult({ kind: "found", group });
    const init: Record<string, boolean> = {};
    group.guests.forEach((g) => (init[g] = true));
    setSelections(init);
  };

  const reset = () => {
    setQuery("");
    setResult({ kind: "empty" });
    setSelections({});
    setSubmitted(null);
  };

  const submitConfirmation = () => {
    if (result.kind !== "found") return;
    const confirmations = result.group.guests.map((name) => ({
      name,
      attending: !!selections[name],
    }));
    const payload = {
      invitationGroupId: result.group.id,
      searchedName: query.trim(),
      confirmations,
      submittedAt: new Date().toISOString(),
    };
    // eslint-disable-next-line no-console
    console.log("[RSVP submission]", payload);
    setSubmitted({ group: result.group, confirmations });
  };

  const attendingCount = useMemo(
    () => Object.values(selections).filter(Boolean).length,
    [selections]
  );

  return (
    <section
      id="confirmar-presenca"
      className="py-24 md:py-32 bg-secondary/30 border-t border-border/30"
    >
      <div className="container mx-auto px-6">
        <div className="max-w-2xl mx-auto">
          <motion.div
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
          >
            <h2 className="font-serif text-4xl md:text-5xl text-foreground mb-4">
              Sua presença é o nosso maior presente
            </h2>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="bg-card p-8 md:p-10 rounded-3xl shadow-sm border border-border/50"
          >
            {submitted ? (
              <SuccessState
                group={submitted.group}
                confirmations={submitted.confirmations}
                onReset={reset}
              />
            ) : (
              <>
                <form onSubmit={handleSearch} className="space-y-4">
                  <label
                    htmlFor="rsvp-name"
                    className="text-sm font-medium text-foreground block"
                  >
                    Digite seu nome para localizar seu convite
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      id="rsvp-name"
                      placeholder="Digite seu nome como está no convite"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="bg-background rounded-xl h-12 flex-1"
                      autoComplete="off"
                    />
                    <Button
                      type="submit"
                      className="rounded-full h-12 px-6 sm:px-8"
                    >
                      <Search className="h-4 w-4 mr-2" aria-hidden="true" />
                      Localizar convite
                    </Button>
                  </div>
                </form>

                {result.kind === "not-found" && (
                  <div className="mt-6 rounded-2xl border border-border/60 bg-background p-5 flex gap-3 items-start">
                    <AlertCircle
                      className="h-5 w-5 text-foreground/60 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="text-sm text-muted-foreground leading-relaxed">
                      Não encontramos esse nome. Confira a grafia ou fale com a
                      gente pelo e-mail{" "}
                      <a
                        href="mailto:casamento@brimax.life"
                        className="text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground/80"
                      >
                        casamento@brimax.life
                      </a>
                      .
                    </div>
                  </div>
                )}

                {result.kind === "ambiguous" && (
                  <div className="mt-6 space-y-3">
                    <p className="text-sm text-foreground">
                      Encontramos mais de um convite parecido. Selecione o seu
                      grupo para continuar.
                    </p>
                    <ul className="space-y-2">
                      {result.groups.map((g) => (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => selectGroup(g)}
                            className="w-full text-left rounded-xl border border-border/60 bg-background px-4 py-3 hover:border-foreground/40 transition-colors"
                          >
                            <div className="font-serif text-lg text-foreground">
                              {g.primaryName}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {g.guests.length}{" "}
                              {g.guests.length === 1 ? "convidado" : "convidados"}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.kind === "found" && (
                  <div className="mt-8 space-y-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
                          Convite localizado
                        </div>
                        <div className="font-serif text-2xl text-foreground mt-1">
                          {result.group.primaryName}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={reset}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                      >
                        <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                        Trocar
                      </button>
                    </div>

                    <p className="text-sm text-foreground">
                      Confirme quais convidados do seu convite irão comparecer:
                    </p>

                    <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-background overflow-hidden">
                      {result.group.guests.map((name) => {
                        const id = `guest-${name}`;
                        const checked = !!selections[name];
                        return (
                          <li key={name}>
                            <label
                              htmlFor={id}
                              className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                            >
                              <Checkbox
                                id={id}
                                checked={checked}
                                onCheckedChange={(v) =>
                                  setSelections((s) => ({
                                    ...s,
                                    [name]: v === true,
                                  }))
                                }
                              />
                              <span className="font-serif text-lg text-foreground">
                                {name}
                              </span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {checked ? "Vai comparecer" : "Não vai"}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                      <span className="text-sm text-muted-foreground">
                        {attendingCount}{" "}
                        {attendingCount === 1
                          ? "pessoa confirmada"
                          : "pessoas confirmadas"}
                      </span>
                      <Button
                        type="button"
                        onClick={submitConfirmation}
                        className="rounded-full h-12 px-8 w-full sm:w-auto"
                      >
                        Enviar confirmação
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </motion.div>

        </div>
      </div>
    </section>
  );
}

function SuccessState({
  group,
  confirmations,
  onReset,
}: {
  group: InvitationGroup;
  confirmations: { name: string; attending: boolean }[];
  onReset: () => void;
}) {
  const attending = confirmations.filter((c) => c.attending);
  const notAttending = confirmations.filter((c) => !c.attending);

  return (
    <div className="text-center py-6 space-y-6">
      <div className="w-16 h-16 mx-auto rounded-full bg-secondary/60 flex items-center justify-center">
        <Check className="h-7 w-7 text-foreground" aria-hidden="true" />
      </div>
      <div>
        <h3 className="font-serif text-2xl md:text-3xl text-foreground">
          Recebemos sua confirmação com carinho!
        </h3>
        <p className="text-sm text-muted-foreground mt-2">
          Convite de <span className="text-foreground">{group.primaryName}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
        <div className="rounded-2xl border border-border/60 bg-background p-5">
          <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">
            Vão comparecer
          </div>
          {attending.length === 0 ? (
            <div className="text-sm text-muted-foreground">Ninguém</div>
          ) : (
            <ul className="space-y-1">
              {attending.map((c) => (
                <li key={c.name} className="font-serif text-base text-foreground">
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-border/60 bg-background p-5">
          <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground mb-2">
            Não poderão ir
          </div>
          {notAttending.length === 0 ? (
            <div className="text-sm text-muted-foreground">Ninguém</div>
          ) : (
            <ul className="space-y-1">
              {notAttending.map((c) => (
                <li key={c.name} className="font-serif text-base text-foreground">
                  {c.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed max-w-md mx-auto">
        Confirmação registrada nesta experiência de teste. A integração final
        será conectada ao sistema de convidados.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button
          variant="outline"
          onClick={onReset}
          className="rounded-full"
        >
          Confirmar outro convite
        </Button>
        <a
          href="mailto:casamento@brimax.life"
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border/60 px-5 h-10 text-sm text-foreground hover:bg-secondary/40 transition-colors"
        >
          <Mail className="h-4 w-4" aria-hidden="true" />
          Falar com os noivos
        </a>
      </div>
    </div>
  );
}
