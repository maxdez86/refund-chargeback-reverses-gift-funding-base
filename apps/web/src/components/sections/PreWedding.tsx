import { motion } from "framer-motion";
import { Film } from "lucide-react";

export function PreWedding() {
  return (
    <section id="pre-wedding" className="py-24 md:py-32 bg-secondary/50 overflow-hidden">
      <div className="container mx-auto px-6 mb-12 flex flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-2xl"
        >
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl text-foreground mb-6">
            Pré-Wedding
          </h2>
        </motion.div>
      </div>

      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl"
        >
          <div className="aspect-video rounded-xl overflow-hidden bg-muted shadow-lg flex flex-col items-center justify-center gap-4 border border-border/40">
            <Film className="h-10 w-10 text-foreground/40" aria-hidden="true" />
            <div className="text-center px-6">
              <p className="font-serif text-3xl md:text-4xl text-foreground">
                Em breve
              </p>
              <p className="mt-2 text-sm md:text-base text-muted-foreground font-light">
                Nosso vídeo pré-wedding está chegando.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
