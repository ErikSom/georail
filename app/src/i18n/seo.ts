import type { Locale } from "./index";

interface PageSeo {
    title: string;
    description: string;
    keywords: string;
}

const DEFAULT_KEYWORDS_EN =
    "train simulator, 3D train game, photorealistic train sim, Dutch trains, NS trains, Netherlands railway, train simulator browser, real trains, 3D map, railway simulator";
const DEFAULT_KEYWORDS_NL =
    "treinsimulator, 3D treinspel, fotorealistische treinsimulator, Nederlandse treinen, NS treinen, Nederlands spoor, treinsimulator browser, echte treinen, 3D kaart, spoorwegsimulator";

export const seo: Record<Locale, Record<"home" | "account" | "credits" | "userRoutes", PageSeo>> = {
    en: {
        home: {
            title: "GeoRail — Drive real trains on photorealistic 3D maps",
            description:
                "A Model Railroad Simulator on Google's photorealistic 3D tiles. Drive real Dutch trains on real tracks — with more countries coming.",
            keywords: DEFAULT_KEYWORDS_EN,
        },
        account: {
            title: "Account — GeoRail",
            description: "Manage your GeoRail account, progress, and unlocked stations.",
            keywords: DEFAULT_KEYWORDS_EN,
        },
        credits: {
            title: "Credits — GeoRail",
            description: "Credits and acknowledgements for GeoRail.",
            keywords: DEFAULT_KEYWORDS_EN,
        },
        userRoutes: {
            title: "My Routes — GeoRail",
            description: "Build, edit, and share your own train routes for GeoRail.",
            keywords: DEFAULT_KEYWORDS_EN,
        },
    },
    nl: {
        home: {
            title: "GeoRail — Bestuur echte treinen op fotorealistische 3D-kaarten",
            description:
                "Een Modelspoor-simulator op Google's fotorealistische 3D-tegels. Bestuur echte Nederlandse treinen op echte sporen — meer landen volgen.",
            keywords: DEFAULT_KEYWORDS_NL,
        },
        account: {
            title: "Account — GeoRail",
            description: "Beheer je GeoRail-account, voortgang en ontgrendelde stations.",
            keywords: DEFAULT_KEYWORDS_NL,
        },
        credits: {
            title: "Credits — GeoRail",
            description: "Credits en dankbetuigingen voor GeoRail.",
            keywords: DEFAULT_KEYWORDS_NL,
        },
        userRoutes: {
            title: "Mijn routes — GeoRail",
            description: "Maak, bewerk en deel je eigen treinroutes voor GeoRail.",
            keywords: DEFAULT_KEYWORDS_NL,
        },
    },
};
