import type { Plugin } from "vite";

export function replaceUnsupportedColorMix(value: string): string;
export function addLegacyTvCssFallbacks(css: string, from?: string): string;
export function legacyTvCssPlugin(): Plugin;
