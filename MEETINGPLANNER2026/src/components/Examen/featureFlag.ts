// Het examenoverzicht is nog in ontwikkeling. In een productiebuild blijft de
// module verborgen (grijze tegel); tijdens lokaal ontwikkelen/testen
// (`npm run dev`) is ze wel bruikbaar. Zet dit op `true` zodra de module af is.
export const EXAMEN_ENABLED = import.meta.env.DEV;
