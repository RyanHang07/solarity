import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity"

/**
 * Screening for user-chosen public text: usernames and Circle names.
 *
 * The recommended transformers handle leetspeak and separator obfuscation, at
 * the cost of false positives on innocent substrings — the right trade for
 * names that appear in other people's notifications.
 */
const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

export function containsProfanity(text: string): boolean {
  return matcher.hasMatch(text)
}
