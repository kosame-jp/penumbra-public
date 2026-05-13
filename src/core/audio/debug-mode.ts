export type AudioDebugMode =
  | "off"
  | "earth-texture-solo"
  | "earth-formant-solo"
  | "earth-water-solo"
  | "earth-wind-solo"
  | "rain-granular-boost"
  | "rain-granular-solo"
  | "surface-texture-boost"
  | "surface-texture-solo"
  | "quake-solo"
  | "human-reverb-solo";

export function parseAudioDebugMode(value: string | null): AudioDebugMode {
  if (value === "surface" || value === "surface-texture" || value === "surface-texture-boost") {
    return "surface-texture-boost";
  }

  if (value === "surface-solo" || value === "surface-texture-solo") {
    return "surface-texture-solo";
  }

  if (value === "earth-texture" || value === "earth-texture-solo" || value === "water-wind-solo") {
    return "earth-texture-solo";
  }

  if (value === "earth-formant" || value === "earth-formant-solo" || value === "formant-solo") {
    return "earth-formant-solo";
  }

  if (value === "water" || value === "water-solo" || value === "earth-water-solo") {
    return "earth-water-solo";
  }

  if (value === "wind" || value === "wind-solo" || value === "earth-wind-solo") {
    return "earth-wind-solo";
  }

  if (value === "rain-boost" || value === "rain-granular-boost" || value === "rain-granular-mix") {
    return "rain-granular-boost";
  }

  if (value === "rain" || value === "rain-granular" || value === "rain-granular-solo") {
    return "rain-granular-solo";
  }

  if (value === "human-reverb" || value === "human-reverb-solo") {
    return "human-reverb-solo";
  }

  if (value === "quake" || value === "quake-solo") {
    return "quake-solo";
  }

  return "off";
}
