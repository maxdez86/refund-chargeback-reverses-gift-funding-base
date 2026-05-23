import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { mediaFileUrl } from "@/lib/media";

const event = {
  venue: "Buffet Tulipas Villa Valentim",
  address: "Rua Valentim Magalhães, 293 - São Paulo - SP",
  dateLabel: "06/12/2026",
  timeLabel: "15:00",
} as const;

const mapsQuery = encodeURIComponent(`${event.venue}, ${event.address}`);
const mapsDirectionsUrl = `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`;
const tourVideoUrl = mediaFileUrl("local", "tour-360-villa-valentim.mp4");

export function Local() {
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.pause();
    }
  }, []);

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
      className="local-v4 relative min-h-[100svh] overflow-hidden bg-[#111111] text-[#fbf7f0]"
    >
      <div className="absolute inset-0">
        <video
          ref={videoRef}
          src={tourVideoUrl}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
        <div className="local-v4-gradient absolute inset-0" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-[100svh] max-w-[1180px] flex-col justify-between gap-12 px-6 py-24 md:px-10 md:py-28">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, ease: [0.22, 0.8, 0.32, 1] }}
          className="max-w-[36rem]"
        >
          <p className="local-v4-eyebrow mb-4 text-sm uppercase text-[#d6ae64]">
            Local da Cerimônia e Festa
          </p>
          <h2
            id="local-heading"
            className="local-v4-heading max-w-[14ch]"
          >
            {event.venue}
          </h2>

          <dl className="mt-10 grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="local-v4-eyebrow mb-1 text-sm uppercase text-[#fbf7f0]/70">Data</dt>
              <dd className="local-v4-display text-2xl">{event.dateLabel}</dd>
            </div>
            <div>
              <dt className="local-v4-eyebrow mb-1 text-sm uppercase text-[#fbf7f0]/70">Horário</dt>
              <dd className="local-v4-display text-2xl">Cerimônia às {event.timeLabel}h</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="local-v4-eyebrow mb-1 text-sm uppercase text-[#fbf7f0]/70">Endereço</dt>
              <dd className="select-all leading-snug text-[#fbf7f0]/90">{event.address}</dd>
            </div>
          </dl>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.56, delay: 0.15, ease: [0.22, 0.8, 0.32, 1] }}
          className="flex flex-wrap gap-4"
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
            className="local-v4-button-ghost inline-flex items-center justify-center rounded-full px-6 py-3.5 text-base font-medium"
          >
            {copied ? "Endereço copiado" : "Copiar endereço"}
          </button>
          <button
            type="button"
            onClick={downloadCalendarInvite}
            className="local-v4-button-ghost inline-flex items-center justify-center rounded-full px-6 py-3.5 text-base font-medium"
          >
            Adicionar ao calendário
          </button>
        </motion.div>
      </div>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </section>
  );
}
