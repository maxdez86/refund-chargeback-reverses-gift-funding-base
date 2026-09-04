import React from "react";
import { Link } from "wouter";
import { FaEnvelope, FaInstagram, FaYoutube } from "react-icons/fa";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import { CONTACT_EMAIL, CONTACT_EMAIL_MAILTO } from "@/lib/contact";
import {
  buildDeviceImageFallbackSrc,
  buildDeviceImageSources,
} from "@/lib/media";

export function Footer() {
  return (
    <footer className="footer-v2 relative isolate overflow-hidden bg-[#181410] pt-16 pb-32 text-[#fbf7f0] md:py-20">
      <div className="absolute inset-0 -z-10">
        <ResponsivePhoto
          section="footer"
          sources={buildDeviceImageSources("footer")}
          fallbackSrc={buildDeviceImageFallbackSrc("footer")}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#181410]/70" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#181410]/40 to-[#181410]/80" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="font-serif mx-auto mt-6 max-w-md text-2xl italic text-[#fbf7f0] md:text-3xl">
          Com amor, Brida &amp; Max.
        </p>
        <div className="faq-v2-divider mx-auto my-10 w-24" />

        <div className="flex flex-col items-center justify-center gap-3 text-sm text-[#fbf7f0]/70 md:flex-row md:gap-8">
          <a
            href={CONTACT_EMAIL_MAILTO}
            className="inline-flex items-center gap-2 transition-colors hover:text-[#d6ae64]"
          >
            <FaEnvelope aria-hidden="true" className="text-base" />
            <span>{CONTACT_EMAIL}</span>
          </a>
          <a
            href="https://www.instagram.com/brimax.life/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 transition-colors hover:text-[#d6ae64]"
          >
            <FaInstagram aria-hidden="true" className="text-base" />
            <span>@brimax.life</span>
          </a>
          <a
            href="https://www.youtube.com/@brimaxLife"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 transition-colors hover:text-[#d6ae64]"
          >
            <FaYoutube aria-hidden="true" className="text-base" />
            <span>@brimaxLife</span>
          </a>
        </div>

        <div className="mt-8 border-t border-[#fbf7f0]/10 pt-6 text-xs text-[#fbf7f0]/50 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <span>&copy; 2026 Brida &amp; Max</span>
          <span className="hidden sm:inline">&bull;</span>
          <Link
            href="/privacidade"
            className="transition-colors hover:text-[#d6ae64] underline underline-offset-4"
          >
            Política de Privacidade
          </Link>
        </div>
      </div>
    </footer>
  );
}
