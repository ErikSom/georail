import { useState } from 'preact/hooks';
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
                    <img src="icons/googlemaps.svg" alt="Google Maps" className={styles.googlemaps} />
                    {attribution?.latLonStr || 'Loading ...'}
                </div>
                {attribution?.source}
                {showMap2DAttribution && <Map2DAttribution />}
            </div>

            {/* small screen attribution with toggle */}
            <button className={`${styles.attribution} ${styles.attribution_mobile}`}
                onClick={() => setShowSources(!showSources)}
                role="button"
                aria-label="Toggle map data sources"
            >
                <img src="icons/googlemaps.svg" alt="Google Maps" className={styles.googlemaps} />
                Data Sources
            </button>

            {showSources && (
                <div className={styles.attribution__overlay} onClick={() => setShowSources(false)} role="button" aria-label="Close map data sources">
                    <h3>Map Data Sources</h3>
                    {attribution?.source ?
                        (<>{attribution?.latLonStr}{'\n'}{attribution?.source}{showMap2DAttribution && <Map2DAttribution />}</>) :
                        (<>Loading location and data sources...</>)
                    }
                </div>
            )
            }
        </>
    );
}

export default Tiles3DAttribution;