import { useCallback } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { ResponsivePhoto } from "@/components/ResponsivePhoto";
import { Button } from "@/components/ui/button";
import {
  buildSharedWidthImageFallbackSrc,
  buildSharedWidthImageSources,
} from "@/lib/media";

const REVIEW_IMAGE_SIZES = "(max-width: 767px) 90vw, (max-width: 1279px) 70vw, 720px";

export function StoryReview() {
  const scrollToNext = useCallback(() => {
    const el = document.querySelector("#pre-wedding");
    if (!el) return;
    const offset = 80;
    const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
    window.scrollTo({ top, behavior: "smooth" });
  }, []);

  return (
    <section id="review" className="bg-[#f4eee5] py-12 md:py-16 overflow-hidden">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-3xl"
        >
          <ResponsivePhoto
            section="story"
            sources={buildSharedWidthImageSources("story", "book-review", REVIEW_IMAGE_SIZES)}
            fallbackSrc={buildSharedWidthImageFallbackSrc("story", "book-review")}
            alt="Review da nossa história — 5 estrelas: slow burn, age gap, proximidade forçada e um amor proibido por diferença de idade."
            className="w-full h-auto object-contain"
            loading="lazy"
          />
        </motion.div>
      </div>

      <div className="container mx-auto px-6 mt-6 flex justify-center">
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 animate-bounce rounded-full border-border/50 text-foreground"
          onClick={scrollToNext}
          aria-label="Rolar para a próxima seção"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
