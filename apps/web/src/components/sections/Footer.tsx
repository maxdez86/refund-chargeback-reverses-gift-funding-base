import React from "react";
import { FaEnvelope, FaInstagram, FaYoutube } from "react-icons/fa";

const PHOTO_BASE = "https://raw.githubusercontent.com/maxdez86/brimax-life-lovable/main/brimax-pictures";

export function Footer() {
  return (
    <footer className="footer-v2 relative isolate overflow-hidden bg-[#181410] pt-16 pb-32 text-[#fbf7f0] md:py-20">
      <div className="absolute inset-0 -z-10">
        <img
          src={`${PHOTO_BASE}/foooter.jpeg`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#181410]/70" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#181410]/40 to-[#181410]/80" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <div className="footer-v2-brand text-2xl text-[#d6ae64]">Brimax</div>
        <p className="font-serif mx-auto mt-6 max-w-md text-2xl italic text-[#fbf7f0] md:text-3xl">
          Com amor, Brida &amp; Max.
        </p>
        <div className="faq-v2-divider mx-auto my-10 w-24" />

        <div className="flex flex-col items-center justify-center gap-3 text-sm text-[#fbf7f0]/70 md:flex-row md:gap-8">
          <a
            href="mailto:casamento@brimax.life"
            className="inline-flex items-center gap-2 transition-colors hover:text-[#d6ae64]"
          >
            <FaEnvelope aria-hidden="true" className="text-base" />
            <span>casamento@brimax.life</span>
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
      </div>
    </footer>
  );
}
