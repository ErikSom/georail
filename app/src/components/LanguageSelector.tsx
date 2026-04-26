import { useState } from "preact/hooks";
import { LOCALES, locale, withLocale, stripLocale, t, type Locale } from "../i18n";
import { configs, setUnitSystem, type UnitSystem } from "../store/globals";
import styles from "./LanguageSelector.module.css";

const LABELS: Record<Locale, string> = {
    en: "EN",
    nl: "NL",
};

interface Props {
    floating?: boolean;
}

export default function LanguageSelector({ floating = false }: Props) {
    const [open, setOpen] = useState(false);
    const path = typeof window !== "undefined" ? stripLocale(window.location.pathname) : "/";
    const current = locale.value;
    const others = LOCALES.filter((l) => l !== current);
    const currentUnits = configs.value.unitSystem;

    const inner = (
        <div className={styles.root}>
            <button
                type="button"
                className={styles.trigger}
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={t('settings.language')}
            >
                {LABELS[current]}
                <svg
                    className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`}
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                >
                    <path d="M2 3.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
            </button>
            {open && (
                <div className={styles.menu} role="menu">
                    {others.length > 0 && (
                        <div className={styles.section}>
                            <span className={styles.sectionLabel}>{t('settings.language')}</span>
                            {others.map((l) => (
                                <a
                                    key={l}
                                    className={styles.option}
                                    href={withLocale(path, l)}
                                    role="menuitem"
                                    onClick={() => { try { localStorage.setItem('locale', l); } catch (e) { /* ignore */ } }}
                                >
                                    {LABELS[l]}
                                </a>
                            ))}
                        </div>
                    )}
                    {others.length > 0 && <div className={styles.divider} />}
                    <div className={styles.section}>
                        <span className={styles.sectionLabel}>{t('settings.units')}</span>
                        {(['metric', 'imperial'] as UnitSystem[]).map((u) => (
                            <button
                                key={u}
                                type="button"
                                className={`${styles.option} ${u === currentUnits ? styles.optionActive : ''}`}
                                onClick={() => { setUnitSystem(u); setOpen(false); }}
                                role="menuitemradio"
                                aria-checked={u === currentUnits}
                            >
                                {t(`settings.${u}`)}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );

    if (!floating) return inner;

    return (
        <>
            {open && <div className={styles.backdrop} onClick={() => setOpen(false)} />}
            <div className={styles.floating}>{inner}</div>
        </>
    );
}
