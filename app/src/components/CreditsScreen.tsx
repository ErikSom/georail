import styles from './GateScreen.module.css';
import creditsStyles from './CreditsScreen.module.css';
import { t } from '../i18n';

interface Props {
    onBack: () => void;
}

export default function CreditsScreen({ onBack }: Props) {
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>{t('credits.title')}</h1>
            <div className={styles.content}>
                <section className={creditsStyles.section}>
                    <h2>GeoRail</h2>
                    <p>{t('credits.intro')}</p>
                    <p className={creditsStyles.muted}>{t('credits.copyright')}</p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>{t('credits.sections.team')}</h3>
                    <p>{t('credits.team.programmingLabel')}: Erik Sombroek</p>
                    <p>
                        {t('credits.team.trainModelsLabel')}:{' '}
                        <a href="https://www.christrains.com" target="_blank" rel="noreferrer nofollow">Chris Longhurst</a>
                    </p>
                    <p>{t('credits.team.playtestingLabel')}: Milo Sombroek</p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>{t('credits.sections.tiles3d')}</h3>
                    <p>
                        <a href="https://developers.google.com/maps/documentation/tile" target="_blank" rel="noreferrer nofollow">Google Photorealistic 3D Tiles</a>
                    </p>
                    <p>
                        <a href="https://github.com/NASA-AMMOS/3DTilesRendererJS" target="_blank" rel="noreferrer nofollow">3DTilesRendererJS</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>{t('credits.sections.map2d')}</h3>
                    <p>
                        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer nofollow">OpenFreeMap</a>
                        {' © '}
                        <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer nofollow">OpenMapTiles</a>
                    </p>
                    <p>
                        {t('credits.map2d.renderingBy')} <a href="https://maplibre.org/" target="_blank" rel="noreferrer nofollow">MapLibre GL</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>{t('credits.sections.railData')}</h3>
                    <p>
                        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer nofollow">OpenStreetMap</a> {t('credits.railData.osmSuffix')}
                    </p>
                    <p>
                        {t('credits.railData.routingPoweredBy')} <a href="https://pgrouting.org/" target="_blank" rel="noreferrer nofollow">pgRouting</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>{t('credits.sections.departures')}</h3>
                    <p>
                        {t('credits.departures.liveFromPrefix')} <a href="https://www.ns.nl/" target="_blank" rel="noreferrer nofollow">NS</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>{t('credits.sections.builtWith')}</h3>
                    <p>
                        <a href="https://threejs.org/" target="_blank" rel="noreferrer nofollow">Three.js</a>
                        {' · '}
                        <a href="https://preactjs.com/" target="_blank" rel="noreferrer nofollow">Preact</a>
                        {' · '}
                        <a href="https://astro.build/" target="_blank" rel="noreferrer nofollow">Astro</a>
                        {' · '}
                        <a href="https://supabase.com/" target="_blank" rel="noreferrer nofollow">Supabase</a>
                    </p>
                </section>

                <button className={creditsStyles.backButton} onClick={onBack} aria-label={t('credits.back')}>
                    ← {t('credits.back')}
                </button>
            </div>
        </div>
    );
}
