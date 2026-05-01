'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTour } from '@/lib/tour/use-tour';
import './tour-styles.css';

interface ProductTourProps {
  shouldAutoStart: boolean;
}

function ProductTourInner({ shouldAutoStart }: ProductTourProps) {
  const { startTour } = useTour();
  const searchParams = useSearchParams();
  const forceTour = searchParams.get('tour') === 'force';

  useEffect(() => {
    if (shouldAutoStart || forceTour) {
      // Small delay so DOM elements with data-tour attrs are mounted
      const timer = setTimeout(() => {
        startTour();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [shouldAutoStart, forceTour, startTour]);

  return null;
}

export function ProductTour(props: ProductTourProps) {
  return (
    <Suspense fallback={null}>
      <ProductTourInner {...props} />
    </Suspense>
  );
}
