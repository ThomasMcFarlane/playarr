import type { ResolvedLanguage } from "../languages";
import { en, type Translations } from "./en";
import { ja } from "./ja";
import { th } from "./th";

export const translations: Record<ResolvedLanguage, Translations> = { en, th, ja };
export type { Translations, TranslationKey } from "./en";
