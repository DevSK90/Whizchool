"use client";

import { useState } from "react";

/**
 * Local editable state that resets whenever `source` changes (e.g. fresh server data).
 * Uses React's "adjust state while rendering" pattern instead of a syncing effect.
 */
export function useResettableState<S, T>(source: S, init: (source: S) => T) {
  const [state, setState] = useState(() => init(source));
  const [prev, setPrev] = useState(source);
  if (source !== prev) {
    setPrev(source);
    setState(init(source));
  }
  return [state, setState] as const;
}
