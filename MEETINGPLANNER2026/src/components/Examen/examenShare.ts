import { isIsoDate, mondayOf, parseIsoDate, toIsoDate } from '../Traject/dateUtils';
import { normalizeOpleiding } from './examenStore';
import type { Opleiding } from './types';

/**
 * Deel-link voor het examenoverzicht. Zelfde mechaniek als de student-link
 * van de Traject Planner: een base64url-JSON-payload in de URL-hash, zodat
 * statische hosting niets hoeft te herschrijven. Eén payload, twee ingangen:
 * - configuratie (opleiding + klasgroepen + jaargroepen), zonder week;
 * - overzicht: dezelfde payload plus de bekeken week.
 */

const PARAM = 'examen';
const VERSIE = 1;

export interface ExamenShare {
    opleiding: Opleiding;
    /** ISO-datum van de maandag, enkel bij een link naar een concreet overzicht. */
    weekMaandag?: string;
}

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

export function buildExamenShareUrl(opleiding: Opleiding, weekMaandag?: string): string {
    const o: Record<string, unknown> = {
        n: opleiding.naam,
        k: opleiding.klasgroepen,
        j: opleiding.jaargroepen.map(j => ({ n: j.naam, k: j.klasgroepen })),
    };
    // Wijkt de examenperiode van deze opleiding af van de algemene, dan hoort
    // ze mee in de link: anders landt de collega met dezelfde jaargroepen op
    // een andere S1/S2-week.
    if (opleiding.eigenPeriode) o.p = opleiding.eigenPeriode;
    const payload: Record<string, unknown> = { v: VERSIE, o };
    if (weekMaandag) payload.w = weekMaandag;
    const root = window.location.origin + window.location.pathname;
    return `${root}#${PARAM}=${toBase64Url(JSON.stringify(payload))}`;
}

/** Leest een geldige deel-link uit de URL-hash, of null. De opleiding krijgt een vers id. */
export function readExamenShareFromUrl(): ExamenShare | null {
    try {
        const hash = window.location.hash.replace(/^#/, '');
        if (!hash) return null;
        const raw = new URLSearchParams(hash).get(PARAM);
        if (!raw) return null;
        const data = JSON.parse(fromBase64Url(raw)) as Record<string, unknown>;
        if (data.v !== VERSIE) return null;
        const o = (data.o && typeof data.o === 'object' ? data.o : null) as Record<string, unknown> | null;
        if (!o || typeof o.n !== 'string' || !o.n.trim()) return null;
        const jaargroepen = Array.isArray(o.j)
            ? o.j.map(j => {
                  const it = (j && typeof j === 'object' ? j : {}) as Record<string, unknown>;
                  return { naam: typeof it.n === 'string' ? it.n : '', klasgroepen: it.k };
              })
            : [];
        const opleiding = normalizeOpleiding({
            naam: o.n.trim(),
            klasgroepen: o.k,
            jaargroepen,
            eigenPeriode: o.p,
        });
        if (!opleiding) return null;
        const share: ExamenShare = { opleiding };
        if (isIsoDate(data.w)) share.weekMaandag = toIsoDate(mondayOf(parseIsoDate(data.w)));
        return share;
    } catch {
        return null;
    }
}

/** Verwijdert de deel-payload uit de URL zodat een refresh ze niet opnieuw aanbiedt. */
export function clearExamenShareFromUrl(): void {
    try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
        /* ignore */
    }
}
