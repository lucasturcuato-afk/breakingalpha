'use client';

import { useTour } from '@/lib/tour/use-tour';
import { HelpCircle } from 'lucide-react';

export function HelpButton() {
  const { startTour } = useTour();

  return (
    <button
      onClick={startTour}
      aria-label="Open product tour"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-gold px-4 py-3 font-serif text-sm text-stone-900 shadow-lg transition-all hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-cream"
    >
      <HelpCircle className="h-4 w-4" strokeWidth={2} />
      <span>Tour</span>
    </button>
  );
}
