// Lazy loaders: the visualizer modules (and their heavy deps such as
// butterchurn-presets, ~17MB) are only imported/evaluated when a visualizer of
// that type is actually created, instead of at renderer bundle load.
export const visualizerLoaders = {
  butterchurn: () => import('./butterchurn').then((m) => m.default),
  vudio: () => import('./vudio').then((m) => m.default),
  wave: () => import('./wave').then((m) => m.default),
};

export type { default as ButterchurnVisualizer } from './butterchurn';
export type { default as VudioVisualizer } from './vudio';
export type { default as WaveVisualizer } from './wave';
