"use client";

import React, { useState, useEffect } from "react";

interface OnboardingVideoProps {
  src: string;
  poster?: string;
  title?: string;
}

/**
 * OnboardingVideo safely plays media by checking the user's data and motion preferences.
 * Addresses #450: Prevents autoplay on data-saver connections or when reduced motion is preferred.
 */
export function OnboardingVideo({ src, poster, title }: OnboardingVideoProps) {
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Check for data saver mode using the Network Information API
    const nav = navigator as any;
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    const isDataSaver = connection?.saveData === true;

    // Only enable autoplay if both preferences allow it
    if (!prefersReducedMotion && !isDataSaver) {
      setShouldAutoplay(true);
    }
  }, []);

  if (!mounted) {
    // Render a safe fallback placeholder on the server
    return (
      <div className="relative w-full aspect-video overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center">
        {poster && <img 
          src={poster} 
          alt={title || "Video poster"} 
          fetchPriority="high" 
          className="object-cover w-full h-full opacity-50"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 50vw"
          srcSet={`${poster}&w=400 400w, ${poster}&w=800 800w, ${poster}&w=1200 1200w, ${poster}&w=1920 1920w`}
        />}
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-muted/10">
      <video
        src={src}
        poster={poster}
        autoPlay={shouldAutoplay}
        loop
        muted
        playsInline
        controls={!shouldAutoplay}
        className="w-full aspect-video object-cover"
        title={title ?? "Onboarding video"}
      />
      {!shouldAutoplay && (
        <div className="px-3 py-2 text-xs text-muted-foreground bg-background/80 text-center border-t border-border">
          Autoplay is disabled to save data or reduce motion. Click play to watch.
        </div>
      )}
    </div>
  );
}
