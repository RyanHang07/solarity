/**
 * **PixiJS generates shader plumbing with `new Function`, and a real CSP
 * forbids that.**
 *
 * Without this import the renderer throws on init:
 *
 *   current environment does not allow unsafe-eval, please use
 *   pixi.js/unsafe-eval module to enable support
 *
 * The polyfill replaces every generated function — shader sync, uniform
 * uploads, UBO packing, particle updates — with an interpreted equivalent. It
 * self-installs on import, which is why there is no call here and why this line
 * must not be tidied away as an unused import.
 *
 * **The alternative is `'unsafe-eval'` in `script-src`, and it is not on the
 * table.** That directive exists to stop a string becoming code; turning it off
 * across the whole application so a decorative canvas can compile shaders
 * faster is a security decision made for a picture. The polyfill is slower at
 * uploading uniforms and that cost is bounded, measurable, and paid only where
 * the galaxy draws.
 *
 * **It has to be imported before `Application.init`**, which is why it sits at
 * the top of the only module that constructs one.
 */
import "pixi.js/unsafe-eval";

import { Application, FederatedPointerEvent, FederatedWheelEvent } from "pixi.js";
import { attachCameraControls } from "./cameraControls";
import {
  DEFAULT_BACKGROUND,
  DEFAULT_STAR_CAP,
  isCompactLayout,
} from "./constants";
import { Galaxy } from "./scene/Galaxy";
import type { GalaxyHandle, GalaxySnapshot, MountOptions } from "./types";

/**
 * Hit targets that belong to the scene rather than to the camera.
 *
 * A pointer down on one of these selects a goal or a member; it must not also
 * begin a pan, or every tap would nudge the sky a pixel or two on the way.
 */
const isSelectableLabel = (label: unknown): boolean =>
  typeof label === "string" &&
  (label.startsWith("planet-body-") || label.startsWith("sun-body-"));

export const mountGalaxy = async (
  host: HTMLElement,
  snapshot: GalaxySnapshot,
  opts: MountOptions = {},
): Promise<GalaxyHandle> => {
  const reducedMotion =
    opts.reducedMotion ??
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const starCap = opts.starCap ?? DEFAULT_STAR_CAP;
  const background = opts.background ?? DEFAULT_BACKGROUND;
  const compactHost =
    opts.compact ??
    isCompactLayout(host.clientWidth || 0, host.clientHeight || 0);

  /**
   * **Whether this surface is driven by a finger**, decided once at mount.
   *
   * `(pointer: coarse)` **or** a compact host, whichever is more restrictive.
   * Two conditions rather than one, because either can be wrong on its own: a
   * phone-sized desktop window is not a touch device, and a large tablet is —
   * and a device that lies about one of them should get the more forgiving
   * control set, not the less.
   *
   * It decides the *buttons*. Whether a given gesture pans is decided per
   * event from `pointerType`, which is the more honest question when a device
   * has both.
   */
  const touchHost =
    compactHost ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches);

  const app = new Application();
  await app.init({
    resizeTo: host,
    background,
    backgroundAlpha: 1,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
    autoStart: !document.hidden,
  });

  host.appendChild(app.canvas);

  /**
   * **Let the page scroll through the canvas on a compact host.**
   *
   * Pixi sets `touch-action: none` on its canvas so it can own gestures, which
   * is right for a full-screen scene and wrong for a panel embedded in a
   * scrolling page: a thumb starting anywhere on the galaxy pans it instead of
   * scrolling, and the page appears stuck. On a phone that is most of the
   * canvas, most of the time.
   *
   * `pan-y` gives vertical drags back to the page and keeps horizontal ones —
   * so the galaxy still turns, taps still select a planet, and pinch-zoom
   * still works because `touch-action` does not govern multi-touch here.
   *
   * A full-size host keeps Pixi's default: there is nothing behind it to
   * scroll, and taking the gesture is the point.
   */
  if (compactHost) {
    app.canvas.style.touchAction = "pan-y";
  }

  /**
   * **WebGL contexts are not permanent, and iOS is where you find out.**
   *
   * Safari discards the context of a backgrounded tab under memory pressure —
   * routine for an installed PWA left behind a few apps. Without a listener
   * the canvas goes permanently blank with no error: the scene graph is
   * intact, the ticker still runs, and nothing is drawn. It reads as the
   * galaxy being broken rather than as the GPU having reclaimed it.
   *
   * `preventDefault` on the loss event is what makes the browser willing to
   * restore, and it must be called synchronously. `onContextLost` gives the
   * host a chance to remount, which is the only reliable recovery: Pixi v8
   * rebuilds its own GPU resources, but textures generated from canvases here
   * are not guaranteed to survive.
   */
  const handleContextLost = (event: Event): void => {
    event.preventDefault();
    app.stop();
    opts.onContextLost?.();
  };
  const handleContextRestored = (): void => {
    if (!document.hidden) {
      app.start();
    }
    opts.onContextRestored?.();
  };
  app.canvas.addEventListener("webglcontextlost", handleContextLost);
  app.canvas.addEventListener("webglcontextrestored", handleContextRestored);

  const galaxy = new Galaxy({
    snapshot,
    width: app.screen.width,
    height: app.screen.height,
    starCap,
    reducedMotion,
    view: opts.view,
    onPlanetSelect: opts.onPlanetSelect,
    onSystemSelect: opts.onSystemSelect,
    onSystemHover: opts.onSystemHover,
    frozen: opts.frozen,
    previewNebula: opts.previewNebula,
    compact: opts.compact,
    starScale: opts.starScale,
    ambientEffects: opts.ambientEffects,
  });
  app.stage.addChild(galaxy.root);

  const handleResize = (): void => {
    galaxy.layout(app.screen.width, app.screen.height);
  };
  app.renderer.on("resize", handleResize);

  /**
   * **The host can change size without the window doing anything.**
   *
   * `resizeTo: host` sounds like it watches the host. It does not — Pixi
   * listens for `window`'s `resize` event and then *measures* the host, so a
   * panel that grows on its own is invisible to it: the canvas keeps its old
   * dimensions and the host's new area is simply empty, with whatever is
   * behind it showing through.
   *
   * Found by expanding the dashboard panel to full screen. The overlay filled
   * the viewport, the canvas stayed at the panel's height, and the page below
   * scrolled through the gap — which reads as the overlay being broken rather
   * than as the canvas not having been told.
   *
   * A `ResizeObserver` is the element-level version of the event Pixi is
   * missing. **Coalesced to one frame**: an observer can fire several times per
   * frame during a transition, and `app.resize()` reallocates the renderer's
   * buffers, so resizing per callback would make an animated size change the
   * most expensive thing on the screen.
   */
  let resizeFrame = 0;
  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (resizeFrame) {
            return;
          }
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            // Guard against a frame that lands after `destroy`.
            if (app.renderer) {
              app.resize();
            }
          });
        })
      : null;
  observer?.observe(host);

  app.ticker.add((ticker) => {
    galaxy.tick(ticker.deltaMS);
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinchStartDistance = 0;
  let pinchStartZoom = 1;
  /** The midpoint of the two fingers on the previous move, for two-finger pan. */
  let lastCentreX = 0;
  let lastCentreY = 0;
  const activePointers = new Map<number, { x: number; y: number }>();

  const pointerDistance = (): number => {
    const points = [...activePointers.values()];
    if (points.length < 2) {
      return 0;
    }
    const [a, b] = points;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  /**
   * Where the gesture is, taken as the midpoint of the first two pointers.
   *
   * Panning from the midpoint rather than from one finger is what makes a
   * pinch that also drifts feel like one gesture: pinching with two fingers
   * moves the midpoint hardly at all, so the two do not fight.
   */
  const pointerCentre = (): { x: number; y: number } => {
    const points = [...activePointers.values()];
    const [a, b] = points;
    if (!a || !b) {
      return { x: 0, y: 0 };
    }
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const handlePointerDown = (event: FederatedPointerEvent): void => {
    if (isSelectableLabel(event.target?.label)) {
      return;
    }
    activePointers.set(event.pointerId, {
      x: event.global.x,
      y: event.global.y,
    });
    if (activePointers.size === 2) {
      pinchStartDistance = pointerDistance();
      pinchStartZoom = galaxy.getCamera().zoom;
      const centre = pointerCentre();
      lastCentreX = centre.x;
      lastCentreY = centre.y;
      dragging = false;
      galaxy.setCameraInteracting(true);
      return;
    }

    /**
     * **One finger does not pan a touch surface. Two do.**
     *
     * The panel lives in a scrolling page, which is the situation every
     * embedded map gets wrong. `touch-action: pan-y` already hands vertical
     * drags to the page; without this, a horizontal one still panned, so the
     * gesture that scrolls and the gesture that pans differed only by angle
     * and a diagonal thumb did both.
     *
     * Decided from `pointerType` rather than from the host, because a laptop
     * with a touchscreen has both and the right answer depends on which one
     * is being used at that moment. A mouse or a stylus still drags with one.
     */
    if (touchHost && event.pointerType === "touch") {
      return;
    }

    dragging = true;
    galaxy.setCameraInteracting(true);
    lastX = event.global.x;
    lastY = event.global.y;
    galaxy.root.cursor = compactHost ? "move" : "grabbing";
  };

  const handlePointerMove = (event: FederatedPointerEvent): void => {
    if (!activePointers.has(event.pointerId)) {
      return;
    }
    activePointers.set(event.pointerId, {
      x: event.global.x,
      y: event.global.y,
    });

    if (activePointers.size >= 2 && pinchStartDistance > 0) {
      const distance = pointerDistance();
      if (distance > 0) {
        const targetZoom = pinchStartZoom * (distance / pinchStartDistance);
        const current = galaxy.getCamera().zoom;
        if (current > 0) {
          galaxy.zoomBy(targetZoom / current);
        }
      }
      // …and the pair moving together pans. This is the only way to move the
      // view vertically with a finger, since one finger belongs to the page.
      const centre = pointerCentre();
      galaxy.panBy(centre.x - lastCentreX, centre.y - lastCentreY);
      lastCentreX = centre.x;
      lastCentreY = centre.y;
      return;
    }

    if (!dragging) {
      return;
    }
    const dx = event.global.x - lastX;
    const dy = event.global.y - lastY;
    lastX = event.global.x;
    lastY = event.global.y;

    if (compactHost) {
      galaxy.panBy(dx, dy);
      return;
    }

    const view = galaxy.getView();
    const rotating = event.shiftKey || event.buttons === 2;
    if (rotating) {
      galaxy.setView({
        yaw: view.yaw + dx * 0.008,
        tilt: view.tilt - dy * 0.008,
      });
      return;
    }
    galaxy.panBy(dx, dy);
  };

  const handlePointerUp = (event: FederatedPointerEvent): void => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) {
      pinchStartDistance = 0;
    }
    if (activePointers.size === 0) {
      dragging = false;
      galaxy.setCameraInteracting(false);
      galaxy.root.cursor = compactHost ? "grab" : "grab";
    }
  };

  const handleWheel = (event: FederatedWheelEvent): void => {
    event.preventDefault();
    if (compactHost) {
      galaxy.zoomBy(event.deltaY < 0 ? 1.08 : 0.92);
      return;
    }
    if (event.shiftKey) {
      const view = galaxy.getView();
      galaxy.setView({ roll: view.roll + event.deltaY * 0.0015 });
      return;
    }
    galaxy.zoomBy(event.deltaY < 0 ? 1.08 : 0.92);
  };

  galaxy.root.on("pointerdown", handlePointerDown);
  galaxy.root.on("globalpointermove", handlePointerMove);
  galaxy.root.on("pointerup", handlePointerUp);
  galaxy.root.on("pointerupoutside", handlePointerUp);
  galaxy.root.on("wheel", handleWheel);

  const handleVisibility = (): void => {
    if (document.hidden) {
      app.stop();
      return;
    }
    app.start();
  };
  const handlePageHide = (): void => {
    app.stop();
  };
  const handlePageShow = (): void => {
    if (!document.hidden) {
      app.start();
    }
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);

  let destroyed = false;
  let detachControls: (() => void) | null = null;

  const handle: GalaxyHandle = {
    canvas: app.canvas,
    resize: () => {
      if (destroyed) {
        return;
      }
      // Cancel the queued frame: the observer will fire for this same change,
      // and resizing twice reallocates the renderer's buffers twice.
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
      }
      app.resize();
    },
    setSnapshot: (next) => {
      if (destroyed) {
        return;
      }
      galaxy.setSnapshot(next);
    },
    setView: (view) => {
      if (destroyed) {
        return;
      }
      galaxy.setView(view);
    },
    getView: () => galaxy.getView(),
    panBy: (dx, dy) => {
      if (destroyed) {
        return;
      }
      galaxy.panBy(dx, dy);
    },
    zoomBy: (factor) => {
      if (destroyed) {
        return;
      }
      galaxy.zoomBy(factor);
    },
    resetCamera: () => {
      if (destroyed) {
        return;
      }
      galaxy.resetCamera();
    },
    focusSystem: (systemId) => {
      if (destroyed) {
        return;
      }
      galaxy.focusSystem(systemId);
    },
    getFocusedSystem: () => galaxy.getFocusedSystem(),
    replayCircleComplete: () => {
      if (destroyed) {
        return;
      }
      galaxy.replaySkyClosed();
    },
    getCamera: () => galaxy.getCamera(),
    setBeltVisible: (planetId, visible) => {
      if (destroyed) {
        return;
      }
      galaxy.setBeltVisible(planetId, visible);
    },
    setPreviewNebula: (enabled) => {
      if (destroyed) {
        return;
      }
      galaxy.setPreviewNebula(enabled);
    },
    setAmbientEffects: (enabled) => {
      if (destroyed) {
        return;
      }
      galaxy.setAmbientEffects(enabled);
    },
    setSunGrowth: (growth) => {
      if (destroyed) {
        return;
      }
      galaxy.setSunGrowth(growth);
    },
    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      detachControls?.();
      detachControls = null;
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      app.canvas.removeEventListener("webglcontextlost", handleContextLost);
      app.canvas.removeEventListener(
        "webglcontextrestored",
        handleContextRestored,
      );
      app.renderer.off("resize", handleResize);
      observer?.disconnect();
      if (resizeFrame) {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
      }
      galaxy.destroy();
      app.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true },
      );
    },
  };

  if (opts.cameraControls ?? compactHost) {
    detachControls = attachCameraControls(host, handle, { touch: touchHost });
  }

  return handle;
};
