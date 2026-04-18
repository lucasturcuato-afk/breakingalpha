"use client";

import { createContext, useContext } from "react";

export const PreviewContext = createContext(false);

export function usePreview(): boolean {
  return useContext(PreviewContext);
}
