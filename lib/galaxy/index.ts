/**
 * The galaxy's renderer half. **Client only.**
 *
 * Importing anything from here pulls `pixi.js` into the graph, so this must be
 * reached from a `"use client"` component and never from a server component or
 * a route handler. When all you need is the data — a category colour, a
 * cosmetics roll, a snapshot to pass down as a prop — import `./data`, which is
 * everything below except `mountGalaxy` and is proven pixi-free.
 */
export { mountGalaxy } from "./mount";
export * from "./data";
