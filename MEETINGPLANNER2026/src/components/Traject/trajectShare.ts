import { TrajectSettings } from './types';

/** Hash-parameter waaronder de preset in een gedeelde URL verstopt zit. */
const PRESET_PARAM = 'traject';
const PRESET_VERSION = 1;

/**
 * De subset van de instellingen die een trajectbegeleider met een student deelt:
 * de klasgroep-shortlist en de semesterperiode. Het studenttraject (OLOD-keuzes)
 * en de kleurmap horen hier bewust NIET bij — die bouwt de student zelf op.
 */
export interface TrajectPreset {
    mijnOpleidingKlasgroepen: string[];
    semesterStart: string;
    semesterEind: string;
}

// UTF-8-veilige base64url. Klasgroepnamen kunnen accenten bevatten, dus btoa()
// rechtstreeks op de string zou breken; we encoderen eerst naar bytes.
function toBase64Url(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

/**
 * Bouwt een deelbare URL die de klasgroep-shortlist en semesterperiode bevat.
 * De huidige locatie (origin + pad) is de basis, met de preset in de hash zodat
 * statische hosting (GitHub Pages) niets hoeft te herschrijven.
 */
export function buildShareUrl(settings: TrajectSettings): string {
    const payload = JSON.stringify({
        v: PRESET_VERSION,
        k: settings.mijnOpleidingKlasgroepen,
        s: settings.semesterStart,
        e: settings.semesterEind,
    });
    const root = window.location.origin + window.location.pathname;
    return `${root}#${PRESET_PARAM}=${toBase64Url(payload)}`;
}

/** Leest een geldige preset uit de huidige URL-hash, of null als die er niet is. */
export function readTrajectPresetFromUrl(): TrajectPreset | null {
    try {
        const hash = window.location.hash.replace(/^#/, '');
        if (!hash) return null;
        const raw = new URLSearchParams(hash).get(PRESET_PARAM);
        if (!raw) return null;
        const data = JSON.parse(fromBase64Url(raw)) as Record<string, unknown>;
        if (data.v !== PRESET_VERSION) return null;
        const { k, s, e } = data;
        if (!Array.isArray(k) || !k.every(x => typeof x === 'string')) return null;
        if (typeof s !== 'string' || typeof e !== 'string') return null;
        return {
            mijnOpleidingKlasgroepen: k as string[],
            semesterStart: s,
            semesterEind: e,
        };
    } catch {
        return null;
    }
}

/** Verwijdert de preset-hash uit de URL zodat een refresh hem niet opnieuw toepast. */
export function clearTrajectPresetFromUrl(): void {
    try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
        /* ignore */
    }
}

/** Kopieert tekst naar het klembord; valt terug op execCommand als de async API faalt. */
export async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    }
}
