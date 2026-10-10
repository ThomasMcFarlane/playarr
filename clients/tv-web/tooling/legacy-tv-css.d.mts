import type { Plugin } from "vite";

export function replaceUnsupportedColorMix(value: string): string;
export function colorMixToChannels(value: string): string | undefined;
export function addLegacyTvCssFallbacks(css: string, from?: string): string;
export function legacyTvCssPlugin(): Plugin;
