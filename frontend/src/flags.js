// The map view defaults on. Hide it with ?map=off or VITE_MAP=off at build.
export const MAP_ENABLED =
  import.meta.env.VITE_MAP !== "off" &&
  new URLSearchParams(window.location.search).get("map") !== "off";

// The landing hero shows on load. Skip it with ?hero=off.
export const HERO_ENABLED = new URLSearchParams(window.location.search).get("hero") !== "off";
