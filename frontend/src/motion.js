import { createContext, useContext, useEffect, useState } from "react";

// true = show final states immediately (prefers-reduced-motion or the footer's
// "Pause motion"). JS animations read this; CSS transitions are cut by the
// .motion-off class on the shell.
export const MotionContext = createContext(false);
export const useMotionOff = () => useContext(MotionContext);

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches
  );
  useEffect(() => {
    const m = window.matchMedia?.(QUERY);
    if (!m) return;
    const on = () => setReduce(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduce;
}
