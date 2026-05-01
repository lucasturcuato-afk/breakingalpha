'use client';

import { useEffect, useRef, useCallback } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { TOUR_STEPS } from './steps';
import { markTourComplete } from '@/app/actions/tour';

interface UseTourOptions {
  onComplete?: () => void;
}

export function useTour({ onComplete }: UseTourOptions = {}) {
  const driverRef = useRef<Driver | null>(null);

  useEffect(() => {
    driverRef.current = driver({
      showProgress: true,
      progressText: 'Step {{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Got it',
      steps: TOUR_STEPS,
      onDestroyed: async () => {
        await markTourComplete();
        onComplete?.();
      },
    });

    return () => {
      driverRef.current?.destroy();
    };
  }, [onComplete]);

  const startTour = useCallback(() => {
    driverRef.current?.drive();
  }, []);

  return { startTour };
}
