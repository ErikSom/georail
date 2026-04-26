import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import styles from './Tiles3DAttribution.module.css';

export type Tiles3DAttributionCredits = {
    latLonStr: string;
    source: string;
} | null;

type Tiles3DAttributionProps = {
    attribution: Tiles3DAttributionCredits;
    showMap2DAttribution?: boolean;
};

const Map2DAttribution = () => (
    <div className={styles.map2dAttribution}>
        <a href="https://openfreemap.org/" rel="nofollow">OpenFreeMap</a>
        {' © '}
        <a href="https://www.openmaptiles.org/" rel="nofollow">OpenMapTiles</a>
        {' · Data from '}
        <a href="https://www.openstreetmap.org/copyright" rel="nofollow">OpenStreetMap</a>
    </div>
);

function Tiles3DAttribution({ attribution, showMap2DAttribution }: Tiles3DAttributionProps) {
    const [showSources, setShowSources] = useState(false);

    return (
        <>
            {/* big screen attribution */}
            <div className={styles.attribution}>
                <div className={styles.logoContainer}>
                    <img src="/icons/googlemaps.svg" alt="Google Maps" className={styles.googlemaps} />
                    {attribution?.latLonStr || t('hud.attribution.loading')}
                </div>
                {attribution?.source}
                {showMap2DAttribution && <Map2DAttribution />}
            </div>

            {/* small screen attribution with toggle */}
            <button className={`${styles.attribution} ${styles.attribution_mobile}`}
                onClick={() => setShowSources(!showSources)}
                role="button"
                aria-label={t('hud.attribution.toggle')}
            >
                <img src="/icons/googlemaps.svg" alt="Google Maps" className={styles.googlemaps} />
                {t('hud.attribution.dataSources')}
            </button>

            {showSources && (
                <div className={styles.attribution__overlay} onClick={() => setShowSources(false)} role="button" aria-label={t('hud.attribution.close')}>
                    <h3>{t('hud.attribution.mapDataSources')}</h3>
                    {attribution?.source ?
                        (<>{attribution?.latLonStr}{'\n'}{attribution?.source}{showMap2DAttribution && <Map2DAttribution />}</>) :
                        (<>{t('hud.attribution.loadingFull')}</>)
                    }
                </div>
            )
            }
        </>
    );
}

export default Tiles3DAttribution;