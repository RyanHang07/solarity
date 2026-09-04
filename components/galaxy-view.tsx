"use client";

import { useEffect, useRef } from "react";
import { mountGalaxy } from "@/lib/galaxy";
import type { GalaxyHandle, GalaxySnapshot } from "@/lib/galaxy/data";
import "@/lib/galaxy/galaxy-camera.css";

/**
 * The WebGL host. **Client only, and the only file in the app that may import
 * `@/lib/galaxy`** — everything else imports `@/lib/galaxy/data`, which is
 * proven pixi-free by `lib/galaxy/data.boundary.test.ts`.
 *
 * ## Why this is a component and not a `dynamic(ssr: false)` call at the page
 *
 * **Next 16's App Router forbids `ssr: false` inside a Server Component**, and
 * the failure is a build error rather than a bad render. So the page stays a
 * server component, builds the snapshot, and passes it here as a prop; the
 * `"use client"` boundary is what keeps PixiJS out of the server graph.
 */
type GalaxyViewProps = {
  snapshot: GalaxySnapshot;
  onPlanetSelect?: (planetId: string) => void;
  /** A Circle: tapping a member's sun. Defaults to flying the camera to them. */
  onSystemSelect?: (systemId: string) => void;
  cameraControls?: boolean;
  compact?: boolean;
  ambientEffects?: boolean;
  /**
   * The data behind this sky stopped changing. Orbits, backdrop and starfield
   * stop; the camera does not, because panning and focusing are things the
   * viewer is doing now.
   */
  frozen?: boolean;
  className?: string;
  /**
   * The canvas is up and has drawn its first snapshot.
   *
   * **The host needs this because a skeleton has to end.** `mountGalaxy` is
   * async and there is no other signal — a canvas that has not painted looks
   * exactly like one that never will.
   *
   * **It hands over the handle**, which is how a host drives the camera without
   * this component growing an imperative API of its own. The handle belongs to
   * the mount and dies with it, so a caller that keeps it must not use it after
   * unmount — every caller so far uses it inside the same effect that received
   * it.
   */
  onReady?: (handle: GalaxyHandle) => void;
  /**
   * The canvas will not exist: no WebGL, a refused context, a throw during
   * mount.
   *
   * **Not an error to show, and it still has to say what happened.** Every
   * galaxy surface is additive and every route is fully usable without it, so
   * the honest response for a *person* is the block removing itself. The
   * honest response for whoever is debugging is the reason, which the first
   * version threw away — a rejected mount reported as absence and nothing
   * else, which is `patterns.md`'s "a protection that fails as absence rather
   * than as refusal" wearing a component's clothes.
   *
   * The reason is passed on so a caller that *is* a diagnostic — the galaxy lab
   * — can show it, and logged here so every other caller need not.
   */
  onUnavailable?: (reason: string) => void;
  /**
   * The pointer entered a member's system, or left it.
   *
   * Coordinates are canvas pixels, and the canvas fills this component's host,
   * so they are also host-relative — which is what a caller positioning a label
   * needs. `null` on leave.
   */
  onSystemHover?: (systemId: string | null, x: number, y: number) => void;
};

/**
 * The sky's colour, read from `--galaxy-sky` rather than hardcoded.
 *
 * **The module's default is a near-black, and Solarity has a real light mode.**
 * A black rectangle in a white app is a design decision, not a default to
 * inherit — so the value lives in `globals.css` beside the other tokens and
 * this reads it.
 *
 * **It deliberately does not flip with the theme.** A galaxy is a night sky in
 * both modes; a white sky with white stars would show nothing. What the token
 * buys is that the decision is visible and changeable in one place instead of
 * being a number inside a renderer.
 */
const DEFAULT_SKY = 0x07070e;

const skyColorFrom = (element: HTMLElement): number => {
  const raw = getComputedStyle(element).getPropertyValue("--galaxy-sky").trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return DEFAULT_SKY;
  }
  return Number.parseInt(hex, 16);
};

export const GalaxyView = ({
  snapshot,
  onPlanetSelect,
  onSystemSelect,
  cameraControls = true,
  compact,
  ambientEffects = true,
  frozen = false,
  className,
  onReady,
  onUnavailable,
  onSystemHover,
}: GalaxyViewProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<GalaxyHandle | null>(null);
  const selectRef = useRef(onPlanetSelect);
  const systemRef = useRef(onSystemSelect);
  const readyRef = useRef(onReady);
  const failedRef = useRef(onUnavailable);
  const hoverRef = useRef(onSystemHover);

  /**
   * The latest snapshot, whether or not the renderer exists yet.
   *
   * **`mountGalaxy` is async, and a snapshot that arrived while it was still
   * awaiting used to be dropped** — the mount effect captured the snapshot it
   * started with, and the update effect called `setSnapshot` on a handle that
   * was still `null`.
   *
   * Unlikely on a slow-changing screen and **exactly what a check-in does**: it
   * changes the snapshot immediately after a navigation, which is the window
   * where the mount is still in flight.
   */
  const pendingRef = useRef(snapshot);

  /**
   * **The three refs above are written here rather than during render**, which
   * `react-hooks/refs` is right to insist on: a render may be thrown away or
   * run twice, and a ref written in one is a side effect either way.
   *
   * **Declared before the mount effect on purpose.** Effects on a commit run in
   * declaration order, so by the time `mountGalaxy` is called these already
   * hold the values from the render that scheduled it — which is the whole
   * point of `pendingRef`.
   */
  useEffect(() => {
    selectRef.current = onPlanetSelect;
    systemRef.current = onSystemSelect;
    readyRef.current = onReady;
    failedRef.current = onUnavailable;
    hoverRef.current = onSystemHover;
    pendingRef.current = snapshot;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let cancelled = false;

    const start = async () => {
      const handle = await mountGalaxy(host, pendingRef.current, {
        cameraControls,
        compact,
        ambientEffects,
        frozen,
        background: skyColorFrom(host),
        onSystemHover: (systemId, x, y) => {
          hoverRef.current?.(systemId, x, y);
        },
        onPlanetSelect: (planetId) => {
          selectRef.current?.(planetId);
        },
        onSystemSelect: (systemId) => {
          if (systemRef.current) {
            systemRef.current(systemId);
            return;
          }
          // Default behaviour: a Circle of ten draws each member at about a
          // seventh of a solo galaxy, so tapping a sun flies to it and tapping
          // the focused one again pulls back out.
          const current = handleRef.current;
          if (!current) {
            return;
          }
          current.focusSystem(
            current.getFocusedSystem() === systemId ? null : systemId,
          );
        },
        /**
         * **iOS reclaims WebGL contexts from backgrounded tabs**, and Solarity
         * is a PWA people are asked to install. Without this the canvas goes
         * permanently blank with no error — the scene graph intact, nothing
         * drawn — which reads as the galaxy being broken rather than as the GPU
         * having taken it back.
         */
        onContextLost: () => {
          window.setTimeout(() => {
            if (!cancelled) {
              handleRef.current?.setSnapshot(pendingRef.current);
            }
          }, 0);
        },
      });

      if (cancelled) {
        handle.destroy();
        return;
      }
      handleRef.current = handle;
      // Anything that arrived while the mount was awaiting.
      handle.setSnapshot(pendingRef.current);
      readyRef.current?.(handle);
    };

    /**
     * **A rejected mount is a real state, not an exception to log.**
     *
     * `mountGalaxy` calls `Application.init`, which rejects when WebGL is
     * unavailable or the context is refused — a browser with it disabled, a
     * device out of GPU memory, a virtualised environment. Without this the
     * promise rejects unhandled and the host sits on its skeleton forever,
     * which reads as the app being broken rather than as the galaxy being
     * absent.
     */
    void start().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      const reason =
        error instanceof Error ? error.message : String(error ?? "unknown");
      // Logged rather than only handed on, because most callers hide the block
      // and would otherwise leave a silent gap on the page.
      console.error("mountGalaxy failed", { reason, error });
      failedRef.current?.(reason);
    });

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [ambientEffects, cameraControls, compact, frozen]);

  useEffect(() => {
    handleRef.current?.setSnapshot(snapshot);
  }, [snapshot]);

  /**
   * **`aria-hidden`, and that is the considered answer rather than a shortcut.**
   *
   * Everything in the canvas is already on the page in text — the goals list,
   * the roster, the streak header — so narrating it would repeat what a screen
   * reader has just read, in worse words. Every e2e locator in this project
   * names a heading, role, label or landmark, and a decorative canvas that
   * announced itself would add a name beside those without adding a fact.
   *
   * The rule the whole plan rests on: **the galaxy is a reward for using the
   * app, never a way to use it.** If it ever carries something the page does
   * not, that is the moment to give it a real name, not before.
   */
  return (
    <div
      ref={hostRef}
      className={className ?? "relative h-full w-full overflow-hidden"}
      aria-hidden
    />
  );
};
