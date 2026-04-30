import React from "react";

export function Footer() {
  return (
    <footer className="footer-v2 bg-[#181410] py-16 text-[#fbf7f0] md:py-20">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <div className="footer-v2-brand text-2xl text-[#d6ae64]">Brimax</div>
        <p className="font-serif mx-auto mt-6 max-w-md text-2xl italic text-[#fbf7f0] md:text-3xl">
          Com amor, Brida &amp; Max.
        </p>
        <p className="mt-3 text-sm text-[#fbf7f0]/70">06.12.2026 · São Paulo</p>

        <div className="faq-v2-divider mx-auto my-10 w-24" />

        <div className="flex flex-col items-center justify-center gap-3 text-sm text-[#fbf7f0]/70 md:flex-row md:gap-8">
          <a
            href="mailto:casamento@brimax.life"
            className="hover:text-[#d6ae64] transition-colors"
          >
            casamento@brimax.life
          </a>
          <span className="hidden md:inline">·</span>
          <a
            href="https://www.instagram.com/brimax.life/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#d6ae64] transition-colors"
          >
            Instagram @brimax.life
          </a>
          <span className="hidden md:inline">·</span>
          <a
            href="https://www.youtube.com/@brimaxLife"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#d6ae64] transition-colors"
          >
            YouTube @brimaxLife
          </a>
          <span className="hidden md:inline">·</span>
          <span>brimax.life</span>
        </div>
      </div>
    </footer>
  );
}
