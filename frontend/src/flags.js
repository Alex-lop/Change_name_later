// The map view defaults on. Hide it with ?map=off or VITE_MAP=off at build.
export const MAP_ENABLED =
  import.meta.env.VITE_MAP !== "off" &&
  new URLSearchParams(window.location.search).get("map") !== "off";

// The workbench opens directly. The landing hero is ?hero=on.
export const HERO_ENABLED = new URLSearchParams(window.location.search).get("hero") === "on";
