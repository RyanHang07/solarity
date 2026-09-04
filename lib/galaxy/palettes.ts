import type { ColorHex } from "./types";

export type ColorPreset = {
  id: string;
  name: string;
  color: ColorHex;
};

export const DEFAULT_SUN_COLOR = 0xf4a261;

/** Six onboarding Sun tones — wide hue steps including a cool option. */
export const SUN_COLOR_PRESETS: readonly ColorPreset[] = [
  { id: "gold", name: "Gold", color: 0xffc107 },
  { id: "amber", name: "Amber", color: 0xf4a261 },
  { id: "ember", name: "Ember", color: 0xff4520 },
  { id: "rose", name: "Rose", color: 0xff2d6a },
  { id: "azure", name: "Azure", color: 0x4da6ff },
  { id: "white-hot", name: "White hot", color: 0xfff8f0 },
] as const;

export type SunPresetId = (typeof SUN_COLOR_PRESETS)[number]["id"];

export const sunPresetById = (id: string): ColorPreset | undefined =>
  SUN_COLOR_PRESETS.find((preset) => preset.id === id);

export const isSunPresetId = (id: string): id is SunPresetId =>
  SUN_COLOR_PRESETS.some((preset) => preset.id === id);
