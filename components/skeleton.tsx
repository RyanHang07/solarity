/**
 * The shapes a loading screen is made of.
 *
 * **Deliberately not animated.** A pulse is a second thing to look at while
 * waiting, and on a phone it costs a repaint per frame for content that is
 * about to be replaced. A still block reads as "not yet" without competing with
 * the content that arrives.
 *
 * **`aria-hidden`, with the announcement made once by the container.** Ten
 * announced placeholders is ten interruptions for a screen reader, which is
 * worse than silence.
 */
export function SkeletonLine({ className = "" }: { className?: string }) {
  // `bg-current opacity-10`, not `bg-current/10`: the slash modifier on a
  // keyword colour is the kind of thing that silently renders nothing, and a
  // skeleton that renders nothing is indistinguishable from the bug it exists
  // to hide.
  return <div aria-hidden className={`rounded bg-current opacity-10 ${className}`} />
}

/**
 * Wraps a set of skeletons and says, once, that something is coming.
 *
 * `role="status"` rather than `aria-live="assertive"`: a page load is not an
 * emergency, and polite means it waits for a pause rather than cutting in.
 */
export function SkeletonRegion({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
