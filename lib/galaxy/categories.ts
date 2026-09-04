import type { ColorHex } from "./types";

export type CategorySlug =
  | "fitness"
  | "hobbies"
  | "career"
  | "health"
  | "finances"
  | "productivity"
  | "mindfulness"
  | "social"
  | "other";

export type GoalCategory = {
  slug: CategorySlug;
  name: string;
  color: ColorHex;
};

/** Seeded Solarity `goal_categories` palette. Host still passes `color` on snapshot bodies. */
export const GOAL_CATEGORIES: readonly GoalCategory[] = [
  { slug: "fitness", name: "Fitness", color: 0xff3131 },
  { slug: "hobbies", name: "Hobbies", color: 0xff8a00 },
  { slug: "career", name: "Career & Professional", color: 0xffd500 },
  { slug: "health", name: "Health & Wellness", color: 0x6ee62e },
  { slug: "finances", name: "Finances", color: 0x00d9a3 },
  { slug: "productivity", name: "Productivity & Habits", color: 0x1ec8ff },
  { slug: "mindfulness", name: "Mindfulness & Mental Health", color: 0x8a4fff },
  { slug: "social", name: "Social & Relationships", color: 0xf730a8 },
  { slug: "other", name: "Other", color: 0x3355ff },
];

export const categoryBySlug = (slug: CategorySlug): GoalCategory => {
  const found = GOAL_CATEGORIES.find((category) => category.slug === slug);
  if (!found) {
    throw new Error(`Unknown category slug: ${slug}`);
  }
  return found;
};
