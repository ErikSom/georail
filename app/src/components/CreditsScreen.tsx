import styles from './GateScreen.module.css';
import creditsStyles from './CreditsScreen.module.css';

interface Props {
    onBack: () => void;
}

export default function CreditsScreen({ onBack }: Props) {
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>Credits</h1>
            <div className={styles.content}>
                <section className={creditsStyles.section}>
                    <h2>GeoRail</h2>
                    <p>A tabletop-style train simulator built on Google's photorealistic 3D tiles, following real-world rail networks. Starting in the Netherlands and expanding from there.</p>
                    <p className={creditsStyles.muted}>© 2025 Terminarch Games</p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>Team</h3>
                    <p>Programming: Erik Sombroek</p>
                    <p>
                        Train Models:{' '}
                        <a href="https://www.christrains.com" target="_blank" rel="noreferrer nofollow">Chris Longhurst</a>
                    </p>
                    <p>Playtesting: Milo Sombroek</p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>3D Map Tiles</h3>
                    <p>
                        <a href="https://developers.google.com/maps/documentation/tile" target="_blank" rel="noreferrer nofollow">Google Photorealistic 3D Tiles</a>
                    </p>
                    <p>
                        <a href="https://github.com/NASA-AMMOS/3DTilesRendererJS" target="_blank" rel="noreferrer nofollow">3DTilesRendererJS</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>2D Map</h3>
                    <p>
                        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer nofollow">OpenFreeMap</a>
                        {' © '}
                        <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer nofollow">OpenMapTiles</a>
                    </p>
                    <p>
                        Rendering by <a href="https://maplibre.org/" target="_blank" rel="noreferrer nofollow">MapLibre GL</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>Rail & Station Data</h3>
                    <p>
                        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer nofollow">OpenStreetMap</a> contributors
                    </p>
                    <p>
                        Routing powered by <a href="https://pgrouting.org/" target="_blank" rel="noreferrer nofollow">pgRouting</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>Departures</h3>
                    <p>
                        Live departures and journey data from <a href="https://www.ns.nl/" target="_blank" rel="noreferrer nofollow">NS</a>
                    </p>
                </section>

                <section className={creditsStyles.section}>
                    <h3>Built with</h3>
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

                <button className={creditsStyles.backButton} onClick={onBack} aria-label="Back">
                    ← Back
                </button>
            </div>
        </div>
    );
}
