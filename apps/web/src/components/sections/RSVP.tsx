import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, ArrowLeft, Check, AlertCircle, Mail, Loader2 } from "lucide-react";
import type {
  HouseholdInvitation,
  RsvpSubmissionRequest,
} from "@brimax/contracts";
import {
  RsvpApiError,
  fetchInvitation,
  normalizeInvitationCode,
  submitRsvp,
} from "@/lib/rsvp-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error"; message: string }
  | { kind: "found"; invitation: HouseholdInvitation };

type SubmittedState = {
  invitation: HouseholdInvitation;
  confirmations: { guestId: string; guestName: string; attending: boolean }[];
};

function initialSelections(invitation: HouseholdInvitation): Record<string, boolean> {
  return Object.fromEntries(
    invitation.guests.map((g) => [g.guestId, g.rsvpStatus !== "declined"])
  );
}

export function RSVP() {
  const [codeInput, setCodeInput] = useState("");
  const [lookup, setLookup] = useState<LookupState>({ kind: "idle" });
  const [selections, setSelections] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState<SubmittedState | null>(null);

  const submitMutation = useMutation({
    mutationFn: (input: RsvpSubmissionRequest) => submitRsvp(input),
    onSuccess: (_response, variables) => {
      if (lookup.kind !== "found") return;
      const confirmations = lookup.invitation.guests.map((g) => ({
        guestId: g.guestId,
        guestName: g.guestName,
        attending:
          variables.guestResponses.find((r) => r.guestId === g.guestId)?.status ===
          "attending",
      }));
      setSubmitted({ invitation: lookup.invitation, confirmations });
    },
    onError: (error) => {
      const message =
        error instanceof RsvpApiError
          ? error.message
          : "Não conseguimos enviar sua confirmação agora.";
      toast.error(message);
    },
  });

  const reset = () => {
    setCodeInput("");
    setLookup({ kind: "idle" });
    setSelections({});
    setNote("");
    setSubmitted(null);
    submitMutation.reset();
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeInvitationCode(codeInput);
    if (!normalized) return;

    setLookup({ kind: "loading" });
    setSubmitted(null);

    try {
      const invitation = await fetchInvitation(normalized);
      setLookup({ kind: "found", invitation });
      setSelections(initialSelections(invitation));
      setNote("");
    } catch (error) {
      if (error instanceof RsvpApiError && error.status === 404) {
        setLookup({ kind: "not-found" });
        return;
      }
      const message =
        error instanceof RsvpApiError
          ? error.message
          : "Não conseguimos consultar o convite agora.";
      toast.error(message);
      setLookup({ kind: "error", message });
    }
  };

  const submitConfirmation = () => {
    if (lookup.kind !== "found") return;
    const invitation = lookup.invitation;

    const guestResponses = invitation.guests.map((g) => ({
      guestId: g.guestId,
      status: (selections[g.guestId] ? "attending" : "declined") as
        | "attending"
        | "declined",
    }));
    const attendingGuestCount = guestResponses.filter(
      (r) => r.status === "attending"
    ).length;

    // submittedBy is required by the contract but we don't capture a separate
    // identity here — use the first guest's id as a stable, non-secret marker.
    const submittedBy = invitation.guests[0]?.guestId ?? invitation.invitationCode;

    const payload: RsvpSubmissionRequest = {
      invitationCode: invitation.invitationCode,
      householdId: invitation.householdId,
      submittedBy,
      guestResponses,
      attendingGuestCount,
      ...(note.trim() ? { note: note.trim() } : {}),
    };

    submitMutation.mutate(payload);
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
                invitation={submitted.invitation}
                confirmations={submitted.confirmations}
                onReset={reset}
              />
            ) : (
              <>
                <form onSubmit={handleLookup} className="space-y-4">
                  <label
                    htmlFor="rsvp-code"
                    className="text-sm font-medium text-foreground block"
                  >
                    Digite seu código de convite
                  </label>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      id="rsvp-code"
                      placeholder="Ex.: AB2345"
                      value={codeInput}
                      onChange={(e) =>
                        setCodeInput(e.target.value.toUpperCase())
                      }
                      className="bg-background rounded-xl h-12 flex-1 tracking-widest uppercase"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={6}
                    />
                    <Button
                      type="submit"
                      className="rounded-full h-12 px-6 sm:px-8"
                      disabled={
                        lookup.kind === "loading" ||
                        normalizeInvitationCode(codeInput).length === 0
                      }
                    >
                      {lookup.kind === "loading" ? (
                        <Loader2
                          className="h-4 w-4 mr-2 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Search className="h-4 w-4 mr-2" aria-hidden="true" />
                      )}
                      Localizar convite
                    </Button>
                  </div>
                </form>

                {lookup.kind === "not-found" && (
                  <div className="mt-6 rounded-2xl border border-border/60 bg-background p-5 flex gap-3 items-start">
                    <AlertCircle
                      className="h-5 w-5 text-foreground/60 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="text-sm text-muted-foreground leading-relaxed">
                      Código não encontrado. Confira a grafia ou fale com a gente
                      pelo e-mail{" "}
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

                {lookup.kind === "found" && (
                  <div className="mt-8 space-y-6">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium tracking-widest uppercase text-muted-foreground">
                          Convite localizado
                        </div>
                        <div className="font-serif text-2xl text-foreground mt-1">
                          {lookup.invitation.householdName}
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
                      {lookup.invitation.guests.map((guest) => {
                        const id = `guest-${guest.guestId}`;
                        const checked = !!selections[guest.guestId];
                        return (
                          <li key={guest.guestId}>
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
                                    [guest.guestId]: v === true,
                                  }))
                                }
                              />
                              <span className="font-serif text-lg text-foreground">
                                {guest.guestName}
                              </span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {checked ? "Vai comparecer" : "Não vai"}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="space-y-2">
                      <label
                        htmlFor="rsvp-note"
                        className="text-sm font-medium text-foreground block"
                      >
                        Recado para os noivos (opcional)
                      </label>
                      <Textarea
                        id="rsvp-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                        rows={3}
                        placeholder="Algo que a gente precisa saber? Restrições, transporte, etc."
                        className="bg-background rounded-xl"
                      />
                    </div>

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
                        disabled={submitMutation.isPending}
                        className="rounded-full h-12 px-8 w-full sm:w-auto"
                      >
                        {submitMutation.isPending ? (
                          <>
                            <Loader2
                              className="h-4 w-4 mr-2 animate-spin"
                              aria-hidden="true"
                            />
                            Enviando…
                          </>
                        ) : (
                          "Enviar confirmação"
                        )}
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
  invitation,
  confirmations,
  onReset,
}: {
  invitation: HouseholdInvitation;
  confirmations: { guestId: string; guestName: string; attending: boolean }[];
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
          Convite de{" "}
          <span className="text-foreground">{invitation.householdName}</span>
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
                <li
                  key={c.guestId}
                  className="font-serif text-base text-foreground"
                >
                  {c.guestName}
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
                <li
                  key={c.guestId}
                  className="font-serif text-base text-foreground"
                >
                  {c.guestName}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button variant="outline" onClick={onReset} className="rounded-full">
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
