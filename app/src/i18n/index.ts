import { signal, computed } from "@preact/signals";
import en from "./en.json";
import nl from "./nl.json";

export const LOCALES = ["en", "nl"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

const dictionaries: Record<Locale, unknown> = { en, nl };

export function detectLocaleFromPath(pathname?: string): Locale {
    const p = pathname ?? (typeof window !== "undefined" ? window.location.pathname : "/");
    const seg = p.split("/")[1];
    return (LOCALES as readonly string[]).includes(seg) && seg !== DEFAULT_LOCALE ? (seg as Locale) : DEFAULT_LOCALE;
}

export function stripLocale(pathname: string): string {
    const m = pathname.match(/^\/(nl)(\/|$)(.*)$/);
    if (!m) return pathname;
    const rest = m[3] ?? "";
    return "/" + rest;
}

export function withLocale(pathname: string, locale: Locale): string {
    const base = stripLocale(pathname);
    if (locale === DEFAULT_LOCALE) return base || "/";
    if (base === "/" || base === "") return `/${locale}/`;
    return `/${locale}${base}`;
}

export const locale = signal<Locale>(detectLocaleFromPath());

const dict = computed(() => dictionaries[locale.value]);

function lookup(obj: unknown, path: string): string | undefined {
    let cur: unknown = obj;
    for (const k of path.split(".")) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[k];
    }
    return typeof cur === "string" ? cur : undefined;
}

export function t(key: string, vars?: Record<string, string | number>): string {
    let s = lookup(dict.value, key) ?? lookup(dictionaries.en, key) ?? key;
    if (vars) {
        for (const k of Object.keys(vars)) {
            s = s.replaceAll(`{${k}}`, String(vars[k]));
        }
    }
    return s;
}
