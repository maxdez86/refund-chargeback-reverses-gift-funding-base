import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";

const countdownTargetISO = "2026-12-06T15:00:00-03:00";

function getTimeLeft(target: number) {
  const now = new Date();

  if (target <= now.getTime()) {
    return { months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  const targetDate = new Date(target);
  let months =
    (targetDate.getFullYear() - now.getFullYear()) * 12 +
    (targetDate.getMonth() - now.getMonth());

  const anchor = new Date(now);
  anchor.setMonth(anchor.getMonth() + months);

  if (anchor.getTime() > target) {
    months -= 1;
    anchor.setMonth(anchor.getMonth() - 1);
  }

  months = Math.max(0, months);

  let rest = target - anchor.getTime();
  const days = Math.floor(rest / 86_400_000);
  rest -= days * 86_400_000;
  const hours = Math.floor(rest / 3_600_000);
  rest -= hours * 3_600_000;
  const minutes = Math.floor(rest / 60_000);
  rest -= minutes * 60_000;
  const seconds = Math.floor(rest / 1000);

  return { months, days, hours, minutes, seconds };
}

export function Countdown() {
  const target = useMemo(() => new Date(countdownTargetISO).getTime(), []);
  const [timeLeft, setTimeLeft] = useState(() => getTimeLeft(target));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTimeLeft(getTimeLeft(target));
    }, 1000);

    return () => clearInterval(interval);
  }, [target]);

  const showMonths = timeLeft.months > 0;

  // Always four cards: Meses leads until the final month, then Segundos takes its slot.
  const items = [
    ...(showMonths ? [{ label: "Meses", value: timeLeft.months }] : []),
    { label: "Dias", value: timeLeft.days },
    { label: "Horas", value: timeLeft.hours },
    { label: "Minutos", value: timeLeft.minutes },
    ...(showMonths ? [] : [{ label: "Segundos", value: timeLeft.seconds }]),
  ];

  return (
    <section id="contagem" className="countdown-v2 bg-[#fbf7f0] py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="countdown-v2-eyebrow text-xs uppercase tracking-[0.4em] text-[#9f7a34]">
            A contagem começou
          </p>
          <h2 className="countdown-v2-balance font-serif mt-4 text-3xl text-[#30251f] md:text-5xl">
            Contando os dias para dizermos sim.
          </h2>
          <div
            className="mx-auto mt-12 grid max-w-3xl grid-cols-2 gap-4 md:gap-6 md:grid-cols-4"
            role="timer"
            aria-live="off"
            aria-label="Contagem regressiva para 06 de dezembro de 2026"
          >
            {items.map((item) => (
              <div
                key={item.label}
                className="countdown-v2-card rounded-2xl border border-[#e4d9c8] bg-[#fbf7f0]/60 p-6 md:p-8"
              >
                <div className="font-serif text-5xl tabular-nums text-[#30251f] md:text-6xl">
                  {String(item.value).padStart(2, "0")}
                </div>
                <div className="mt-2 text-xs uppercase tracking-[0.25em] text-[#6e5b4f]">
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
