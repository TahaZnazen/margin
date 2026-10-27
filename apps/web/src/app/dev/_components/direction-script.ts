// TEMPORARY (P03 step 1): see direction.tsx.

export const DIRECTIONS = ["paper", "graphite"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_KEY = "margin:direction";

/** Sets data-direction on <html> before paint. ?direction= wins over localStorage. */
export const directionScript = `(function(){try{var q=new URLSearchParams(location.search).get("direction");var d=q==="paper"||q==="graphite"?q:localStorage.getItem("${DIRECTION_KEY}");if(d!=="graphite")d="paper";document.documentElement.setAttribute("data-direction",d)}catch(e){}})()`;
