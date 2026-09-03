import { useId, type Ref } from 'react';
import { layoutDay } from '../Traject/layout';
import type { Lesblok } from '../Traject/types';
import {
    addDays,
    DAG_HEADERS,
    formatDateBE,
    formatDateTime,
    formatTime,
    isoWeekNumber,
    sameDay,
} from '../Traject/dateUtils';
import {
    gedeeldeDocenten,
    isVolledigGeannuleerd,
    lokaalDelen,
    lokaalGroepen,
    lokaalRegel,
    statusOmschrijving,
} from './merge';
import type { Examen, JaargroepOverzicht } from './types';

/**
 * Het weekraster van één jaargroep als inline SVG. Eén tekening dient scherm,
 * print én PNG: de titelband en de tijdstempel zitten in de SVG zelf, zodat
 * een geplakte afbeelding altijd zegt van welke opleiding, week en
 * ophaalmoment ze is.
 *
 * Enkel systeemfonts: een webfont rendert niet mee in een geserialiseerde SVG.
 */

export const RASTER_BREEDTE = 1120;
const TIJD_W = 48;
const KOP_H = 48;
const DAG_KOP_H = 26;
const UUR_H = 64;
const VOET_H = 24;
const FONT = 'Arial, Helvetica, sans-serif';
const KLEUR_TEKST = '#0F172A';
const KLEUR_GRIJS = '#64748B';
const KLEUR_LIJN = '#CBD5E1';
const KLEUR_LIJN_LICHT = '#E2E8F0';

// Neutrale blokken; kleur enkel om afwijkingen te markeren.
const STIJL = {
    gewoon: { fill: '#FFFFFF', stroke: '#475569', tekst: KLEUR_TEKST },
    subset: { fill: '#FEF3C7', stroke: '#B45309', tekst: KLEUR_TEKST },
    afwijkend: { fill: '#FEE2E2', stroke: '#B91C1C', tekst: KLEUR_TEKST },
    geannuleerd: { fill: '#F1F5F9', stroke: '#94A3B8', tekst: KLEUR_GRIJS },
} as const;

/**
 * Het tijdvenster wordt bijgesneden op het eerste en laatste blok van de
 * week, afgerond op het uur — een examenweek is spaarzaam gevuld en een vast
 * raster van 8u tot 22u leest slecht. Minstens vier uur, zodat een enkel
 * examen niet een raster van één rij oplevert.
 */
export function tijdvenster(examens: Examen[]): { startUur: number; eindUur: number } {
    if (examens.length === 0) return { startUur: 8, eindUur: 18 };
    let minM = Infinity;
    let maxM = -Infinity;
    for (const e of examens) {
        minM = Math.min(minM, e.start.getHours() * 60 + e.start.getMinutes());
        const eindM = e.eind.getHours() * 60 + e.eind.getMinutes();
        maxM = Math.max(maxM, eindM === 0 ? 24 * 60 : eindM);
    }
    const startUur = Math.max(0, Math.floor(minM / 60));
    let eindUur = Math.min(24, Math.ceil(maxM / 60));
    if (eindUur - startUur < 4) eindUur = Math.min(24, startUur + 4);
    return { startUur, eindUur };
}

function afkappen(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

// Woordwrapping op een geschatte tekenbreedte; SVG kent geen tekstomloop.
function wrapTekst(text: string, maxChars: number, maxLines: number): string[] {
    if (maxLines <= 0 || maxChars <= 0) return [];
    const woorden = text.split(/\s+/).filter(Boolean);
    const lijnen: string[] = [];
    let cur = '';
    for (const w of woorden) {
        const kand = cur ? `${cur} ${w}` : w;
        if (kand.length <= maxChars || cur === '') cur = kand;
        else {
            lijnen.push(cur);
            cur = w;
        }
    }
    if (cur) lijnen.push(cur);
    if (lijnen.length > maxLines) {
        const kort = lijnen.slice(0, maxLines);
        kort[maxLines - 1] = afkappen(`${kort[maxLines - 1]}…`, maxChars);
        return kort.map(l => afkappen(l, maxChars));
    }
    return lijnen.map(l => afkappen(l, maxChars));
}

/**
 * Wikkelt een reeks ondeelbare stukken over regels, met " · " ertussen. Breekt
 * bij voorkeur tussen de stukken; enkel een stuk dat op zichzelf te lang is
 * wordt op woorden afgebroken.
 */
function wrapDelen(delen: string[], maxChars: number, maxLines: number): string[] {
    const uit: string[] = [];
    let cur = '';
    for (const d of delen) {
        const kandidaat = cur ? `${cur} · ${d}` : d;
        if (kandidaat.length <= maxChars) {
            cur = kandidaat;
            continue;
        }
        if (cur) uit.push(cur);
        if (d.length <= maxChars) {
            cur = d;
            continue;
        }
        const stukken = wrapTekst(d, maxChars, maxLines);
        uit.push(...stukken.slice(0, -1));
        cur = stukken[stukken.length - 1] ?? '';
    }
    if (cur) uit.push(cur);
    return uit.slice(0, maxLines);
}

interface Lijn {
    t: string;
    size: number;
    bold?: boolean;
    fill?: string;
    strike?: boolean;
}

/**
 * De regels in één examenblok. De vaknaam staat bovenaan (binnen één examen is
 * die overal dezelfde); daaronder één regel per lokaal met de docenten en de
 * klasgroepen die er zitten.
 */
function blokLijnen(ex: Examen, maxChars: number, toonKlasgroepen: boolean): Lijn[] {
    const geannuleerd = isVolledigGeannuleerd(ex);
    const lijnen: Lijn[] = [];
    lijnen.push({ t: `${formatTime(ex.start)}–${formatTime(ex.eind)}`, size: 10.5, bold: true });
    // De status op een eigen regel, mét de klasgroepen waarvoor hij geldt:
    // "GEANNULEERD: 2TIB" mag voor 2TIA en 2TIC niet als annulering lezen.
    const status = statusOmschrijving(ex);
    if (status) {
        for (const l of wrapTekst(status.toUpperCase(), maxChars, 2)) {
            lijnen.push({ t: l, size: 10, bold: true, fill: geannuleerd ? KLEUR_GRIJS : '#B91C1C' });
        }
    }
    for (const l of wrapTekst(ex.olodNaam, maxChars, 2)) {
        lijnen.push({ t: l, size: 11, bold: true, strike: geannuleerd });
    }
    // Wie het examen níét heeft is de informatie die de klasgroeplijst per
    // lokaal niet geeft — die noemt enkel wie er wél zit.
    if (!ex.volledig) {
        for (const l of wrapTekst(`niet voor ${ex.ontbrekend.join(', ')}`, maxChars, 2)) {
            lijnen.push({ t: l, size: 10, fill: '#92400E' });
        }
    }
    const groepen = lokaalGroepen(ex);
    // Houdt elk lokaal dezelfde toezichthouder, dan staat die één keer boven de
    // lokalenlijst in plaats van op elke regel opnieuw.
    const gedeeld = gedeeldeDocenten(groepen);
    if (gedeeld) {
        for (const l of wrapDelen(gedeeld, maxChars, 2)) lijnen.push({ t: l, size: 10 });
    }
    for (const g of groepen) {
        const delen = lokaalDelen(g, { klasgroepen: toonKlasgroepen, docenten: !gedeeld });
        if (delen.length === 0) continue;
        for (const l of wrapDelen(delen, maxChars, 3)) lijnen.push({ t: l, size: 10 });
    }
    if (ex.type) lijnen.push({ t: ex.type, size: 9.5, fill: KLEUR_GRIJS });
    return lijnen;
}

function tooltip(ex: Examen): string {
    const regels = [
        `${ex.olodNaam}`,
        `${formatTime(ex.start)}–${formatTime(ex.eind)}`,
        ...lokaalGroepen(ex).map(g => `• ${lokaalRegel(g)}`),
    ];
    if (!ex.volledig) regels.push(`Niet voor: ${ex.ontbrekend.join(', ')}`);
    if (ex.type) regels.push(ex.type);
    if (ex.status) regels.push(`Status in Untis: ${statusOmschrijving(ex)} (${ex.status})`);
    return regels.join('\n');
}

interface BlokProps {
    id: string;
    ex: Examen;
    x: number;
    y: number;
    w: number;
    h: number;
    toonKlasgroepen: boolean;
}

function Blok({ id, ex, x, y, w, h, toonKlasgroepen }: BlokProps) {
    const geannuleerd = isVolledigGeannuleerd(ex);
    const afwijkend = !!ex.status && !geannuleerd;
    const stijl = geannuleerd
        ? STIJL.geannuleerd
        : afwijkend
          ? STIJL.afwijkend
          : ex.volledig
            ? STIJL.gewoon
            : STIJL.subset;
    const pad = 4;
    const lijnH = 12.5;
    const maxLijnen = Math.max(1, Math.floor((h - pad) / lijnH));
    const maxChars = Math.max(4, Math.floor((w - pad * 2) / 5.6));
    const alle = blokLijnen(ex, maxChars, toonKlasgroepen);
    // Past niet alles, dan zegt de laatste regel hoeveel er wegvalt: een blok
    // dat stilzwijgend afkapt zou een lokaal of een klas kunnen verbergen.
    const lijnen =
        alle.length > maxLijnen
            ? [
                  ...alle.slice(0, maxLijnen - 1),
                  { t: `+${alle.length - maxLijnen + 1} meer`, size: 9.5, fill: KLEUR_GRIJS },
              ]
            : alle;
    return (
        <g>
            <title>{tooltip(ex)}</title>
            <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={4}
                fill={stijl.fill}
                stroke={stijl.stroke}
                strokeWidth={ex.volledig && !ex.status ? 1.1 : 1.6}
                strokeDasharray={geannuleerd ? '4 3' : undefined}
            />
            <clipPath id={id}>
                <rect x={x} y={y} width={w} height={h} rx={4} />
            </clipPath>
            <g clipPath={`url(#${id})`}>
                {lijnen.map((l, i) => (
                    <text
                        key={i}
                        x={x + pad}
                        y={y + pad + (i + 1) * lijnH - 3}
                        fontSize={l.size}
                        fontWeight={l.bold ? 700 : 400}
                        fill={l.fill ?? stijl.tekst}
                        textDecoration={l.strike ? 'line-through' : undefined}
                    >
                        {l.t}
                    </text>
                ))}
            </g>
        </g>
    );
}

interface LegendeItem {
    label: string;
    fill: string;
    stroke: string;
    dashed?: boolean;
}

interface Props {
    overzicht: JaargroepOverzicht;
    weekMaandag: Date;
    opleidingNaam: string;
    opgehaaldOp: Date | null;
    ref?: Ref<SVGSVGElement>;
}

export function ExamenRaster({ overzicht, weekMaandag, opleidingNaam, opgehaaldOp, ref }: Props) {
    const uid = useId().replace(/[^A-Za-z0-9]/g, '');
    const { examens, jaargroep } = overzicht;
    const { startUur, eindUur } = tijdvenster(examens);
    const uren = eindUur - startUur;
    const gridTop = KOP_H + DAG_KOP_H;
    const gridH = uren * UUR_H;
    const H = gridTop + gridH + VOET_H;
    const dagW = (RASTER_BREEDTE - TIJD_W) / 5;
    const dagen = Array.from({ length: 5 }, (_, i) => addDays(weekMaandag, i));
    const vrijdag = dagen[4];

    const yVoor = (d: Date) => {
        const min = d.getHours() * 60 + d.getMinutes() - startUur * 60;
        return gridTop + Math.max(0, Math.min(gridH, (min / 60) * UUR_H));
    };

    const klasgroepenTekst = jaargroep.klasgroepen.join(', ');
    const toonKlasgroepen = jaargroep.klasgroepen.length > 1 || klasgroepenTekst !== jaargroep.naam;
    const n = examens.length;

    const legende: LegendeItem[] = [];
    if (examens.some(e => !e.volledig)) {
        legende.push({ label: 'geldt niet voor alle klassen', ...STIJL.subset });
    }
    if (examens.some(e => e.status && !isVolledigGeannuleerd(e))) {
        legende.push({ label: 'gewijzigd of deels geannuleerd in Untis', ...STIJL.afwijkend });
    }
    if (examens.some(e => isVolledigGeannuleerd(e))) {
        legende.push({ label: 'geannuleerd', ...STIJL.geannuleerd, dashed: true });
    }

    const leegTekst =
        n > 0
            ? null
            : overzicht.onbekend.length > 0
              ? 'Rooster wordt geladen…'
              : overzicht.mislukt.length === jaargroep.klasgroepen.length
                ? 'Rooster kon niet opgehaald worden'
                : 'Geen blokken in Untis voor deze week';

    const stempel =
        `Weergave van Untis op ${opgehaaldOp ? formatDateTime(opgehaaldOp) : '…'}` +
        ' · examens die niet in Untis staan (digitaal, mondeling op afspraak) ontbreken hier';

    // Legende van rechts naar links uitlijnen op een geschatte tekstbreedte.
    let legendeX = RASTER_BREEDTE - 10;
    const legendeItems = legende
        .slice()
        .reverse()
        .map(item => {
            const breedte = 16 + item.label.length * 5.4;
            legendeX -= breedte;
            const x = legendeX;
            legendeX -= 14;
            return { ...item, x };
        });

    return (
        <svg
            ref={ref}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${RASTER_BREEDTE} ${H}`}
            width="100%"
            role="img"
            aria-label={`Examenrooster ${jaargroep.naam}, week ${isoWeekNumber(weekMaandag)}`}
            fontFamily={FONT}
            data-examen-raster={jaargroep.id}
            style={{ display: 'block', height: 'auto' }}
        >
            <rect x={0} y={0} width={RASTER_BREEDTE} height={H} fill="#FFFFFF" />

            {/* Titelband */}
            <text x={10} y={21} fontSize={15} fontWeight={700} fill={KLEUR_TEKST}>
                {jaargroep.naam}
                {toonKlasgroepen && (
                    <tspan fontSize={12} fontWeight={400} fill={KLEUR_GRIJS}>
                        {`  ·  ${klasgroepenTekst}`}
                    </tspan>
                )}
            </text>
            <text x={10} y={38} fontSize={11.5} fill={KLEUR_GRIJS}>
                {`${opleidingNaam} · Week ${isoWeekNumber(weekMaandag)} · ${formatDateBE(weekMaandag)} – ${formatDateBE(vrijdag)} · ${n} ${n === 1 ? 'examen' : 'examens'}`}
            </text>

            {/* Dagkoppen */}
            <rect x={0} y={KOP_H} width={RASTER_BREEDTE} height={DAG_KOP_H} fill="#F1F5F9" />
            {dagen.map((d, i) => (
                <text
                    key={i}
                    x={TIJD_W + i * dagW + dagW / 2}
                    y={KOP_H + 17}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill={KLEUR_TEKST}
                >
                    {`${DAG_HEADERS[i]} ${formatDateBE(d)}`}
                </text>
            ))}

            {/* Uurlijnen en -labels */}
            {Array.from({ length: uren + 1 }, (_, i) => {
                const y = gridTop + i * UUR_H;
                return (
                    <g key={i}>
                        <line x1={0} x2={RASTER_BREEDTE} y1={y} y2={y} stroke={KLEUR_LIJN} strokeWidth={1} />
                        <text x={TIJD_W - 6} y={y + 4} textAnchor="end" fontSize={10.5} fill={KLEUR_GRIJS}>
                            {`${startUur + i}:00`}
                        </text>
                        {i < uren && (
                            <line
                                x1={TIJD_W}
                                x2={RASTER_BREEDTE}
                                y1={y + UUR_H / 2}
                                y2={y + UUR_H / 2}
                                stroke={KLEUR_LIJN_LICHT}
                                strokeWidth={1}
                                strokeDasharray="3 3"
                            />
                        )}
                    </g>
                );
            })}

            {/* Dagscheidingen */}
            {Array.from({ length: 6 }, (_, i) => (
                <line
                    key={i}
                    x1={TIJD_W + i * dagW}
                    x2={TIJD_W + i * dagW}
                    y1={KOP_H}
                    y2={gridTop + gridH}
                    stroke={KLEUR_LIJN}
                    strokeWidth={1}
                />
            ))}

            {/* Blokken: overlappende examens naast elkaar per dag */}
            {dagen.map((d, di) => {
                const dagEx = examens.filter(e => sameDay(e.start, d));
                if (dagEx.length === 0) return null;
                return layoutDay(dagEx as Lesblok[]).map(({ blok, col, cols }, bi) => {
                    const ex = blok as Examen;
                    const kolW = dagW / cols;
                    const x = TIJD_W + di * dagW + col * kolW + 3;
                    const w = kolW - 6;
                    const yStart = yVoor(ex.start);
                    const yEind = yVoor(ex.eind);
                    const h = Math.max(16, yEind - yStart - 2);
                    return (
                        <Blok
                            key={`${di}-${bi}`}
                            id={`${uid}-${di}-${bi}`}
                            ex={ex}
                            x={x}
                            y={yStart + 1}
                            w={w}
                            h={h}
                            toonKlasgroepen={jaargroep.klasgroepen.length > 1}
                        />
                    );
                });
            })}

            {leegTekst && (
                <text
                    x={TIJD_W + (RASTER_BREEDTE - TIJD_W) / 2}
                    y={gridTop + gridH / 2}
                    textAnchor="middle"
                    fontSize={13}
                    fill={KLEUR_GRIJS}
                >
                    {leegTekst}
                </text>
            )}

            {/* Voet: tijdstempel en legende */}
            <line x1={0} x2={RASTER_BREEDTE} y1={gridTop + gridH} y2={gridTop + gridH} stroke={KLEUR_LIJN} />
            <text x={10} y={H - 8} fontSize={10} fill={KLEUR_GRIJS}>
                {stempel}
            </text>
            {legendeItems.map(item => (
                <g key={item.label}>
                    <rect
                        x={item.x}
                        y={H - 17}
                        width={11}
                        height={11}
                        rx={2}
                        fill={item.fill}
                        stroke={item.stroke}
                        strokeWidth={1.2}
                        strokeDasharray={item.dashed ? '3 2' : undefined}
                    />
                    <text x={item.x + 15} y={H - 8} fontSize={10} fill={KLEUR_GRIJS}>
                        {item.label}
                    </text>
                </g>
            ))}

            <rect
                x={0.5}
                y={0.5}
                width={RASTER_BREEDTE - 1}
                height={H - 1}
                fill="none"
                stroke="#94A3B8"
                strokeWidth={1}
            />
        </svg>
    );
}
