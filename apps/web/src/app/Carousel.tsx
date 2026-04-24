import { type ReactNode, useEffect, useRef, useState } from "react";

type CarouselProps = {
  controlsLabel: string;
  trackAriaLabel: string;
  itemCount: number;
  className?: string;
  children: ReactNode;
  reducedMotion: boolean;
};

export function Carousel({
  controlsLabel,
  trackAriaLabel,
  itemCount,
  className,
  children,
  reducedMotion
}: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progressWidth, setProgressWidth] = useState(12);

  useEffect(() => {
    const track = trackRef.current;

    if (!track) {
      return undefined;
    }

    let isDragging = false;
    let startX = 0;
    let startScroll = 0;

    const cardStep = () => {
      const firstCard = track.children[0] as HTMLElement | undefined;
      const styles = window.getComputedStyle(track);
      const gap = Number.parseFloat(styles.columnGap || styles.gap || "0");
      const width = firstCard?.getBoundingClientRect().width || track.clientWidth || 320;

      return width + gap;
    };

    const updateProgress = () => {
      const step = cardStep();
      const maxScroll = Math.max(track.scrollWidth - track.clientWidth, 0);
      const ratio = maxScroll <= 0 ? 1 : track.scrollLeft / maxScroll;
      const index = Math.min(itemCount - 1, Math.max(0, Math.round(track.scrollLeft / step)));

      setCurrentIndex(index);
      setProgressWidth(Math.max(12, Math.min(100, 12 + ratio * 88)));
    };

    const setTrackPosition = (nextScroll: number, smooth = false) => {
      if (typeof track.scrollTo === "function") {
        track.scrollTo({
          left: nextScroll,
          behavior: smooth && !reducedMotion ? "smooth" : "auto"
        });
      } else {
        track.scrollLeft = nextScroll;
      }

      updateProgress();
    };

    const move = (direction: number) => {
      setTrackPosition(track.scrollLeft + direction * cardStep(), true);
    };

    const handleScroll = () => updateProgress();
    const handleResize = () => updateProgress();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        move(1);
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }

      isDragging = true;
      startX = event.clientX;
      startScroll = track.scrollLeft;
      track.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isDragging) {
        return;
      }

      event.preventDefault();
      track.scrollLeft = startScroll - (event.clientX - startX);
      updateProgress();
    };

    const handlePointerUp = () => {
      isDragging = false;
    };

    track.addEventListener("scroll", handleScroll, { passive: true });
    track.addEventListener("keydown", handleKeyDown);
    track.addEventListener("pointerdown", handlePointerDown);
    track.addEventListener("pointermove", handlePointerMove);
    track.addEventListener("pointerup", handlePointerUp);
    track.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("resize", handleResize);

    (track as HTMLElement & { __carouselMove?: (direction: number) => void }).__carouselMove = move;
    updateProgress();

    return () => {
      delete (track as HTMLElement & { __carouselMove?: (direction: number) => void }).__carouselMove;
      track.removeEventListener("scroll", handleScroll);
      track.removeEventListener("keydown", handleKeyDown);
      track.removeEventListener("pointerdown", handlePointerDown);
      track.removeEventListener("pointermove", handlePointerMove);
      track.removeEventListener("pointerup", handlePointerUp);
      track.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("resize", handleResize);
    };
  }, [itemCount, reducedMotion]);

  const move = (direction: number) => {
    const track = trackRef.current as (HTMLElement & { __carouselMove?: (direction: number) => void }) | null;
    track?.__carouselMove?.(direction);
  };

  return (
    <div className="carousel-shell" data-carousel>
      <div className="carousel-toolbar" role="group" aria-label={controlsLabel}>
        <button className="icon-button" type="button" onClick={() => move(-1)} aria-label={`Voltar ${trackAriaLabel}`}>
          ‹
        </button>
        <div className="progress-rail" aria-hidden="true">
          <span style={{ width: `${progressWidth}%` }} />
        </div>
        <span className="carousel-count" aria-live="polite">
          {Math.min(currentIndex + 1, itemCount)} / {itemCount}
        </span>
        <button className="icon-button" type="button" onClick={() => move(1)} aria-label={`Avançar ${trackAriaLabel}`}>
          ›
        </button>
      </div>
      <div ref={trackRef} className={className} tabIndex={0} aria-label={trackAriaLabel}>
        {children}
      </div>
    </div>
  );
}
