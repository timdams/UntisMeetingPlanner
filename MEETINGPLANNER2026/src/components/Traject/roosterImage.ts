import type { Lesblok } from './types';
import {
    addDays,
    DAG_HEADERS,
    DAY_START_HOUR,
    formatDateBE,
    formatTime,
    isoWeekNumber,
    sameDay,
} from './dateUtils';
import { layoutDay } from './layout';

/**
 * Tekent de alleen-lezen weekzoom als afbeelding op een canvas, zodat de
 * gebruiker het rooster naar het klembord kan kopiëren (bv. om in een mail of
 * in Teams te plakken). Bewust met de Canvas 2D-API in plaats van een
 * DOM-naar-afbeelding bibliotheek: geen extra dependency, en het resultaat is
 * scherp en voorspelbaar. Maatvoering en kleuren volgen die van .zoomGrid in
 * Traject.module.css, zodat de afbeelding lijkt op wat op het scherm staat.
 */

export interface RoosterImageData {
    weekMonday: Date;
    blokken: Lesblok[];
    dayEndHour: number;
    /** Blokken die in deze week botsen (krijgen de rode streepjesrand). */
    conflictSet: Set<Lesblok>;
    /** Wat-als-preview: blokken die erbij komen. */
    ghostSet: Set<Lesblok>;
    /** Wat-als-preview: blokken die vervallen. */
    wegSet: Set<Lesblok>;
    colorOf: (olodNaam: string) => string;
    legende: { olodNaam: string; klasgroepen: string[] }[];
}

// Maatvoering in CSS-pixels; het canvas wordt SCALE keer zo groot gerenderd
// zodat de tekst scherp blijft bij inzoomen of op een hoge-resolutiescherm.
const SCALE = 2;
const BREEDTE = 1240;
const RAND = 14;
const TITEL_H = 42;
const DAGKOP_H = 30;
const TIJD_COL_W = 58;
const UUR_H = 62;
const LEGENDE_LIJN_H = 20;
const LEGENDE_RAND = 10;
const FONT = "'Inter', system-ui, 'Segoe UI', Helvetica, Arial, sans-serif";

function cssVar(naam: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(naam).trim();
    return v || fallback;
}

function minutenIn(d: Date): number {
    return d.getHours() * 60 + d.getMinutes();
}

/** Kort tekst af met een beletselteken zodat ze binnen maxW past. */
function kort(ctx: CanvasRenderingContext2D, tekst: string, maxW: number): string {
    if (ctx.measureText(tekst).width <= maxW) return tekst;
    let uit = tekst;
    while (uit.length > 1 && ctx.measureText(uit + '…').width > maxW) {
        uit = uit.slice(0, -1);
    }
    return uit + '…';
}

/** Breekt tekst over maximaal `maxRegels` regels; wat niet past wordt afgekort. */
function breek(
    ctx: CanvasRenderingContext2D,
    tekst: string,
    maxW: number,
    maxRegels: number
): string[] {
    const woorden = tekst.split(/\s+/).filter(Boolean);
    const regels: string[] = [];
    let huidig = '';
    for (let i = 0; i < woorden.length; i++) {
        const kandidaat = huidig ? `${huidig} ${woorden[i]}` : woorden[i];
        if (!huidig || ctx.measureText(kandidaat).width <= maxW) {
            huidig = kandidaat;
            continue;
        }
        if (regels.length === maxRegels - 1) break;
        regels.push(huidig);
        huidig = woorden.slice(i).join(' ');
        i = woorden.length; // rest komt op de laatste regel terecht
    }
    if (huidig) regels.push(huidig);
    return regels.slice(0, maxRegels).map(r => kort(ctx, r, maxW));
}

function afgerondeRechthoek(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
): void {
    if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        return;
    }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

/** Diagonale strepen zoals .zoomBlokGhost. */
function ghostStrepen(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 3;
    for (let i = -h; i < w + h; i += 7) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
        ctx.stroke();
    }
    ctx.restore();
}

interface LegendeChip {
    olodNaam: string;
    klassen: string;
    breedte: number;
}

const CHIP_GAP = 18;

function legendeIndeling(
    ctx: CanvasRenderingContext2D,
    legende: RoosterImageData['legende'],
    maxW: number
): LegendeChip[][] {
    const chips: LegendeChip[] = legende.map(({ olodNaam, klasgroepen }) => {
        const klassen = klasgroepen.join(', ');
        ctx.font = `600 12px ${FONT}`;
        const naamW = ctx.measureText(olodNaam).width;
        ctx.font = `400 12px ${FONT}`;
        const klasW = ctx.measureText(klassen).width;
        return { olodNaam, klassen, breedte: 18 + naamW + 6 + klasW };
    });

    const rijen: LegendeChip[][] = [];
    let rij: LegendeChip[] = [];
    let breedte = 0;
    for (const chip of chips) {
        const extra = rij.length === 0 ? chip.breedte : chip.breedte + CHIP_GAP;
        if (rij.length > 0 && breedte + extra > maxW) {
            rijen.push(rij);
            rij = [];
            breedte = 0;
        }
        rij.push(chip);
        breedte += rij.length === 1 ? chip.breedte : chip.breedte + CHIP_GAP;
    }
    if (rij.length > 0) rijen.push(rij);
    return rijen;
}

export function tekenWeekRooster(data: RoosterImageData): HTMLCanvasElement {
    const { weekMonday, blokken, dayEndHour, conflictSet, ghostSet, wegSet, colorOf, legende } =
        data;

    const tekstKleur = cssVar('--text-color', '#4D4D4D');
    const randKleur = cssVar('--border-color', '#e2e8f0');
    const paneelKleur = cssVar('--secondary', '#f1f5f9');
    const achtergrond = cssVar('--bg-color', '#ffffff');
    const grijs = '#64748b';

    const canvas = document.createElement('canvas');
    const meten = canvas.getContext('2d');
    if (!meten) throw new Error('Canvas wordt niet ondersteund door deze browser.');

    const legendeRijen = legendeIndeling(meten, legende, BREEDTE - 2 * RAND);
    const legendeH =
        legendeRijen.length > 0 ? legendeRijen.length * LEGENDE_LIJN_H + 2 * LEGENDE_RAND : 0;

    const uren = dayEndHour - DAY_START_HOUR;
    const gridH = uren * UUR_H;
    const hoogte = TITEL_H + DAGKOP_H + gridH + legendeH;

    canvas.width = BREEDTE * SCALE;
    canvas.height = hoogte * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas wordt niet ondersteund door deze browser.');
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = achtergrond;
    ctx.fillRect(0, 0, BREEDTE, hoogte);

    // --- Titelbalk ---
    ctx.fillStyle = paneelKleur;
    ctx.fillRect(0, 0, BREEDTE, TITEL_H);
    ctx.fillStyle = randKleur;
    ctx.fillRect(0, TITEL_H - 1, BREEDTE, 1);

    ctx.font = `700 16px ${FONT}`;
    ctx.fillStyle = tekstKleur;
    const titel = `Week ${isoWeekNumber(weekMonday)}`;
    ctx.fillText(titel, RAND, 27);
    const titelW = ctx.measureText(titel).width;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillStyle = grijs;
    ctx.fillText(
        `${formatDateBE(weekMonday)} – ${formatDateBE(addDays(weekMonday, 4))}`,
        RAND + titelW + 10,
        27
    );

    // --- Dagkoppen ---
    const dagW = (BREEDTE - TIJD_COL_W) / 5;
    const gridTop = TITEL_H + DAGKOP_H;
    ctx.fillStyle = paneelKleur;
    ctx.fillRect(0, TITEL_H, BREEDTE, DAGKOP_H);
    ctx.fillStyle = randKleur;
    ctx.fillRect(0, gridTop - 1, BREEDTE, 1);

    const dagen = Array.from({ length: 5 }, (_, i) => addDays(weekMonday, i));
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = tekstKleur;
    dagen.forEach((d, i) => {
        ctx.fillText(
            `${DAG_HEADERS[i]} ${d.getDate()}/${d.getMonth() + 1}`,
            TIJD_COL_W + i * dagW + dagW / 2,
            TITEL_H + 20
        );
    });
    ctx.textAlign = 'left';

    // --- Kolomlijnen en uurlijnen ---
    ctx.fillStyle = randKleur;
    for (let i = 0; i <= 5; i++) {
        const x = Math.round(TIJD_COL_W + i * dagW) - (i === 5 ? 1 : 0);
        ctx.fillRect(x, TITEL_H, 1, DAGKOP_H + gridH);
    }

    ctx.save();
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (let i = 1; i < uren; i++) {
        const y = Math.round(gridTop + i * UUR_H) + 0.5;
        ctx.beginPath();
        ctx.moveTo(TIJD_COL_W, y);
        ctx.lineTo(BREEDTE, y);
        ctx.stroke();
    }
    ctx.restore();

    // --- Uurlabels ---
    ctx.font = `400 12px ${FONT}`;
    ctx.fillStyle = grijs;
    for (let i = 0; i <= uren; i++) {
        // Labels staan op hun uurlijn; het laatste label schuift omhoog zodat
        // het niet half onder de roosterrand verdwijnt.
        const y = gridTop + i * UUR_H + (i === uren ? -3 : 4);
        ctx.fillText(`${DAY_START_HOUR + i}:00`, 6, y);
    }

    // --- Lesblokken ---
    const pxPerMin = UUR_H / 60;
    const gridBodem = gridTop + gridH;
    for (let di = 0; di < 5; di++) {
        const dagBlokken = blokken.filter(b => sameDay(b.start, dagen[di]));
        for (const { blok: b, col, cols } of layoutDay(dagBlokken)) {
            const kolomW = dagW / cols;
            const x = TIJD_COL_W + di * dagW + col * kolomW + 3;
            const w = kolomW - 6;
            const top = gridTop + (minutenIn(b.start) - DAY_START_HOUR * 60) * pxPerMin;
            const bodem = Math.min(
                gridBodem,
                top + (minutenIn(b.eind) - minutenIn(b.start)) * pxPerMin
            );
            const y = Math.max(gridTop, top);
            const h = Math.max(18, bodem - y);
            const weg = wegSet.has(b);
            const ghost = ghostSet.has(b);

            ctx.save();
            if (weg) ctx.globalAlpha = 0.35;

            afgerondeRechthoek(ctx, x, y, w, h, 6);
            ctx.fillStyle = colorOf(b.olodNaam);
            ctx.fill();

            ctx.save();
            ctx.clip();
            if (ghost) ghostStrepen(ctx, x, y, w, h);

            // Tekstregels in dezelfde volgorde als op het scherm.
            const tx = x + 6;
            const maxW = w - 12;
            let ty = y + 15;
            const past = (extra: number) => ty + extra <= y + h - 2;

            ctx.fillStyle = '#ffffff';
            ctx.font = `700 11.5px ${FONT}`;
            ctx.fillText(
                kort(ctx, `${formatTime(b.start)}–${formatTime(b.eind)}`, maxW),
                tx,
                ty
            );

            ctx.font = `600 12.5px ${FONT}`;
            for (const regel of breek(ctx, b.olodNaam, maxW, 2)) {
                if (!past(15)) break;
                ty += 15;
                ctx.fillText(regel, tx, ty);
            }

            ctx.font = `400 11px ${FONT}`;
            for (const meta of [b.klasgroep, b.type, b.lokaal]) {
                if (!meta) continue;
                if (!past(13)) break;
                ty += 13;
                ctx.fillText(kort(ctx, meta, maxW), tx, ty);
            }
            ctx.restore();

            if (ghost) {
                afgerondeRechthoek(ctx, x + 1, y + 1, w - 2, h - 2, 5);
                ctx.setLineDash([5, 4]);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#ffffff';
                ctx.stroke();
                ctx.setLineDash([]);
            }
            if (conflictSet.has(b)) {
                afgerondeRechthoek(ctx, x + 1.5, y + 1.5, w - 3, h - 3, 5);
                ctx.setLineDash([6, 4]);
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#DC2626';
                ctx.stroke();
                ctx.setLineDash([]);
            }
            ctx.restore();
        }
    }

    // --- Legende ---
    if (legendeRijen.length > 0) {
        const legendeTop = gridBodem;
        ctx.fillStyle = paneelKleur;
        ctx.fillRect(0, legendeTop, BREEDTE, legendeH);
        ctx.fillStyle = randKleur;
        ctx.fillRect(0, legendeTop, BREEDTE, 1);

        legendeRijen.forEach((rij, ri) => {
            let x = RAND;
            const y = legendeTop + LEGENDE_RAND + ri * LEGENDE_LIJN_H + 12;
            for (const chip of rij) {
                afgerondeRechthoek(ctx, x, y - 10, 12, 12, 3);
                ctx.fillStyle = colorOf(chip.olodNaam);
                ctx.fill();
                x += 18;
                ctx.font = `600 12px ${FONT}`;
                ctx.fillStyle = tekstKleur;
                ctx.fillText(chip.olodNaam, x, y);
                x += ctx.measureText(chip.olodNaam).width + 6;
                ctx.font = `400 12px ${FONT}`;
                ctx.fillStyle = grijs;
                ctx.fillText(chip.klassen, x, y);
                x += ctx.measureText(chip.klassen).width + CHIP_GAP;
            }
        });
    }

    return canvas;
}

function canvasNaarBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            b => (b ? resolve(b) : reject(new Error('Kon de afbeelding niet aanmaken.'))),
            'image/png'
        );
    });
}

/**
 * Zet het canvas als PNG op het klembord. De blob-promise gaat rechtstreeks in
 * het ClipboardItem, zodat de schrijfactie in dezelfde klikafhandeling valt:
 * Chrome/Edge weigeren een klembordactie die te ver van de gebruikersklik ligt.
 */
export function kopieerCanvasNaarKlembord(canvas: HTMLCanvasElement): Promise<void> {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        return Promise.reject(
            new Error('Deze browser ondersteunt geen afbeeldingen op het klembord.')
        );
    }
    const item = new ClipboardItem({ 'image/png': canvasNaarBlob(canvas) });
    return navigator.clipboard.write([item]);
}

/** Terugval wanneer het klembord geweigerd wordt: bewaar de PNG als bestand. */
export async function bewaarCanvasAlsBestand(
    canvas: HTMLCanvasElement,
    bestandsnaam: string
): Promise<void> {
    const blob = await canvasNaarBlob(canvas);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bestandsnaam;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}
