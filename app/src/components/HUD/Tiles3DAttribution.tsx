import { useState } from 'preact/hooks';
import styles from './Tiles3DAttribution.module.css';

export type Tiles3DAttributionCredits = {
    latLonStr: string;
    source: string;
} | null;

type Tiles3DAttributionProps = {
    attribution: Tiles3DAttributionCredits;
};

function Tiles3DAttribution({ attribution }: Tiles3DAttributionProps) {
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
                        (<>{attribution?.latLonStr}{'\n'}{attribution?.source}</>) :
                        (<>Loading location and data sources...</>)
                    }
                </div>
            )
            }
        </>
    );
}

export default Tiles3DAttribution;