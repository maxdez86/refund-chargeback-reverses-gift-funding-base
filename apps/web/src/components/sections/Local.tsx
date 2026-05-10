import React, { useState } from "react";
import { motion } from "framer-motion";

const event = {
  venue: "Buffet Tulipas - Unidade Villa Valentim",
  address: "Rua Valentim Magalhães, 293 - São Paulo - SP",
  dateLabel: "06/12/2026",
  timeLabel: "15:00",
} as const;

const mapsQuery = encodeURIComponent(`${event.venue}, ${event.address}`);
const mapsDirectionsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
const venueTourVideoId = "Lek3CSN5kGQ";
const venueTourEmbedUrl = `https://www.youtube-nocookie.com/embed/${venueTourVideoId}?autoplay=1&rel=0`;
const venueTourPosterUrl = `https://i.ytimg.com/vi/${venueTourVideoId}/maxresdefault.jpg`;

export function Local() {
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [tourPlaying, setTourPlaying] = useState(false);

  const downloadCalendarInvite = () => {
    const dtStamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Brimax//Casamento//PT-BR",
      "BEGIN:VEVENT",
      "UID:casamento-brida-max-2026@brimax.life",
      `DTSTAMP:${dtStamp}`,
      "DTSTART:20261206T180000Z",
      "DTEND:20261207T020000Z",
      "SUMMARY:Casamento Brida & Max",
      `LOCATION:${event.venue}, ${event.address}`,
      "DESCRIPTION:Cerimônia às 15:00 (BRT), seguida de recepção.",
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    const blob = new Blob([lines.join("\r\n")], {
      type: "text/calendar;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "casamento-brida-max.ics";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const copyAddress = async () => {
    const text = `${event.venue}, ${event.address}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setAnnouncement("");
      window.setTimeout(() => setAnnouncement("Endereço copiado."), 30);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setAnnouncement("");
      window.setTimeout(
        () => setAnnouncement("Não foi possível copiar. Selecione o endereço manualmente."),
        30,
      );
    }
  };

  return (
    <section
      id="local"
      aria-labelledby="local-heading"
      className="local-v4 bg-[#f4eee5] py-24 text-foreground md:py-32"
    >
      <div className="local-v4-shell mx-auto max-w-[1180px] px-6 md:px-10">
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, ease: [0.22, 0.8, 0.32, 1] }}
          className="local-v4-eyebrow mb-4 text-sm uppercase text-foreground/55"
        >
          Local da Cerimônia e Festa
        </motion.p>

        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <motion.h2
              id="local-heading"
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.56, delay: 0.05, ease: [0.22, 0.8, 0.32, 1] }}
              className="local-v4-heading max-w-[14ch]"
            >
              Buffet Tulipas Villa Valentim
            </motion.h2>

            <motion.dl
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.56, delay: 0.18, ease: [0.22, 0.8, 0.32, 1] }}
              className="mt-10 grid gap-6 sm:grid-cols-2"
            >
              <div>
                <dt className="local-v4-eyebrow mb-1 text-sm uppercase text-foreground/55">Data</dt>
                <dd className="local-v4-display text-2xl">{event.dateLabel}</dd>
              </div>
              <div>
                <dt className="local-v4-eyebrow mb-1 text-sm uppercase text-foreground/55">Horário</dt>
                <dd className="local-v4-display text-2xl">Cerimônia às {event.timeLabel}h</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="local-v4-eyebrow mb-1 text-sm uppercase text-foreground/55">Endereço</dt>
                <dd>
                  <p className="font-medium leading-snug">{event.venue}</p>
                  <p className="select-all leading-snug text-foreground/70">{event.address}</p>
                </dd>
              </div>
            </motion.dl>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.56, delay: 0.26, ease: [0.22, 0.8, 0.32, 1] }}
              className="mt-8 flex flex-wrap gap-4"
            >
              <a
                href={mapsDirectionsUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`Ver no mapa: ${event.venue}, ${event.address}`}
                className="local-v4-button-primary inline-flex items-center justify-center rounded-full px-6 py-3.5 text-base font-medium"
              >
                Ver no mapa
              </a>
              <button
                type="button"
                onClick={copyAddress}
                aria-live="polite"
                className="local-v4-button-secondary inline-flex items-center justify-center rounded-full px-6 py-3.5 text-base font-medium"
              >
                {copied ? "Endereço copiado" : "Copiar endereço"}
              </button>
              <button
                type="button"
                onClick={downloadCalendarInvite}
                className="local-v4-button-secondary inline-flex items-center justify-center rounded-full px-6 py-3.5 text-base font-medium"
              >
                Adicionar ao calendário
              </button>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: 0.56, delay: 0.2, ease: [0.22, 0.8, 0.32, 1] }}
          >
            <div className="mb-5">
              <h3 className="local-v4-display text-3xl leading-tight text-foreground md:text-4xl">
                Um lugar feito para celebrar o amor.
              </h3>
            </div>

            <div className="local-v4-map-card relative aspect-[4/3] overflow-hidden rounded-[1.5rem] border border-black/10 bg-[#f5efe6] lg:h-[32rem] lg:aspect-auto">
              {tourPlaying ? (
                <iframe
                  src={venueTourEmbedUrl}
                  title="Tour 360 do Villa Valentim"
                  className="absolute inset-0 h-full w-full border-0"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setTourPlaying(true)}
                  aria-label="Reproduzir Tour 360 do Villa Valentim"
                  className="group absolute inset-0 h-full w-full cursor-pointer overflow-hidden border-0 bg-transparent p-0"
                >
                  <img
                    src={venueTourPosterUrl}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                  />
                  <span aria-hidden="true" className="absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/25" />
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 grid h-20 w-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[#d6ae64] shadow-xl transition-transform duration-300 group-hover:scale-105 md:h-24 md:w-24"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9 translate-x-[2px] text-white md:h-10 md:w-10">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
              )}
            </div>
          </motion.div>
        </div>

        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </div>
    </section>
  );
}
