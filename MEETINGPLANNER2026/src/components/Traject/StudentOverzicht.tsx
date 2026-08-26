import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Lesblok, StudentTraject } from './types';
import {
    detectConflicts,
    effectieveBlokken as berekenEffectieveBlokken,
    ghostBlokkenVoor,
    scenarioBlokken as berekenScenarioBlokken,
    wegBlokkenVoor,
} from './conflicts';
import {
    addDays,
    bereikOverlapt,
    DAG_HEADERS,
    DAY_START_HOUR,
    formatDateBE,
    formatDateTime,
    formatTime,
    fridayEndOf,
    gridEndHour,
    isoWeekNumber,
    parseIsoDate,
    periodeBereik,
    sameDay,
    toIsoDate,
    weeksBetween,
} from './dateUtils';
import { academiejaarBereik, periodeMarkeringen, type PeriodeGrenzen, type PeriodeType } from './academicYear';
import type { KlasgroepPreview } from './useTrajectBlokken';
import styles from './Traject.module.css';
import { AlertTriangle, ChevronDown, ChevronRight, Eye, Loader2, ZoomIn } from 'lucide-react';
import { LesblokIcon } from './LesblokIcon';
import { layoutDay } from './layout';
import { WeekZoom } from './WeekZoom';

interface Props {
    traject: StudentTraject;
    // Lesblokken van het volledige academiejaar per klasgroep in het traject
    // (zie useTrajectBlokken), plus laad-/foutstatus van die fetch.
    blokkenPerKlas: Record<string, Lesblok[]>;
    busy: boolean;
    error: string | null;
    // De actieve periode van het werkblad (inclusieve ISO-datums): haar weken
    // worden gemarkeerd en in beeld gescrold. Het overzicht zelf toont altijd
    // het volledige academiejaar.
    actiefBereik: { van: string; tot: string };
    periodeType: PeriodeType;
    // Alle grensdatums: bepalen zowel het bestreken academiejaar als de
    // markeringen bij elke semester-/modulestart.
    periodeGrenzen: PeriodeGrenzen;
    colorOf: (olodNaam: string) => string;
    // Wat-als-preview vanuit de klasgroep-kiezer: de lessen van het vak bij de
    // huidige klasgroep vervagen, die bij de kandidaat-klasgroep verschijnen
    // als gestippelde blokjes; conflicten worden voor dat scenario berekend.
    preview?: KlasgroepPreview | null;
}

interface TipState {
    text: string;
    // Viewport-rect van het blokje waar de tooltip bij hoort.
    anchor: DOMRect;
}

const TIP_GAP = 8;
const TIP_MARGIN = 8;

// Tooltip bij een blokje in het weekoverzicht. Wordt in document.body gerenderd
// (portal) zodat overflow/transform van voorouders de positie niet beïnvloedt,
// en na meting binnen de viewport gehouden: standaard rechts van het blokje,
// anders links; verticaal uitgelijnd op de bovenkant van het blokje en waar
// nodig omhoog geschoven.
function MiniTooltip({ tip }: { tip: TipState }) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const { width, height } = el.getBoundingClientRect();
        const { anchor } = tip;
        let left = anchor.right + TIP_GAP;
        if (left + width > window.innerWidth - TIP_MARGIN) {
            left = Math.max(TIP_MARGIN, anchor.left - TIP_GAP - width);
        }
        let top = anchor.top;
        if (top + height > window.innerHeight - TIP_MARGIN) {
            top = Math.max(TIP_MARGIN, window.innerHeight - TIP_MARGIN - height);
        }
        setPos({ left, top });
    }, [tip]);

    return createPortal(
        <div
            ref={ref}
            className={styles.miniTip}
            style={pos ? { left: pos.left, top: pos.top, visibility: 'visible' } : { left: 0, top: 0, visibility: 'hidden' }}
        >
            {tip.text}
        </div>,
        document.body
    );
}

function topPct(d: Date, totalMin: number): number {
    const m = (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
    return Math.max(0, Math.min(100, (m / totalMin) * 100));
}

function heightPct(start: Date, eind: Date, totalMin: number): number {
    const m =
        (eind.getHours() - DAY_START_HOUR) * 60 +
        eind.getMinutes() -
        ((start.getHours() - DAY_START_HOUR) * 60 + start.getMinutes());
    return Math.max(2, Math.min(100, (m / totalMin) * 100));
}

export function StudentOverzicht({
    traject,
    blokkenPerKlas,
    busy,
    error,
    actiefBereik,
    periodeType,
    periodeGrenzen,
    colorOf,
    preview = null,
}: Props) {
    const [conflictsOpen, setConflictsOpen] = useState(true);
    // De week die via het vergrootglas alleen-lezen wordt uitvergroot (maandag
    // van die week), of null wanneer er geen zoomvenster open staat.
    const [zoomWeek, setZoomWeek] = useState<Date | null>(null);
    const [tip, setTip] = useState<TipState | null>(null);
    const showTip = (e: React.MouseEvent<HTMLElement>, text: string) =>
        setTip({ text, anchor: e.currentTarget.getBoundingClientRect() });
    const hideTip = () => setTip(null);

    // Het overzicht beslaat altijd het volledige academiejaar; elke selectie
    // draagt enkel binnen haar eigen periode bij.
    const jaar = useMemo(() => academiejaarBereik(periodeGrenzen), [periodeGrenzen]);
    const { van: start, tot: eind } = useMemo(() => periodeBereik(jaar.van, jaar.tot), [jaar]);

    // Een blok telt zodra een selectie van dat vak bij die klasgroep het blok in
    // haar periode heeft (zie effectieveBlokken in conflicts.ts).
    const effectieve = useMemo<Lesblok[]>(
        () => berekenEffectieveBlokken(traject, blokkenPerKlas, start, eind),
        [blokkenPerKlas, traject, start, eind]
    );

    // Wat-als-preview. `wegBlokken`: de lessen die bij de wissel zouden
    // verdwijnen — die van de verhuizende selecties, tenzij een andere selectie
    // van hetzelfde vak bij dezelfde klasgroep ze ook dekt. `ghostBlokken`: de
    // lessen die erbij zouden komen, zonder de blokken die er al in zitten
    // (bv. een bestaande M2-keuze bij de kandidaat-klasgroep). Bij een
    // bulkwissel bevat `preview.sels` meerdere selecties tegelijk.
    const wegBlokken = useMemo(
        () => (preview ? wegBlokkenVoor(preview.sels, traject, effectieve) : new Set<Lesblok>()),
        [preview, traject, effectieve]
    );

    const ghostBlokken = useMemo<Lesblok[]>(
        () =>
            preview
                ? ghostBlokkenVoor(preview.sels, preview.klasgroep, preview.blokken, effectieve, start, eind)
                : [],
        [preview, effectieve, start, eind]
    );
    const ghostSet = useMemo(() => new Set(ghostBlokken), [ghostBlokken]);

    // Wat er getekend wordt (bestaand + ghost) en waarop de conflictdetectie
    // loopt (bestaand zonder de wegvallende lessen, plus ghost).
    const getoondeBlokken = useMemo<Lesblok[]>(
        () => (ghostBlokken.length ? [...effectieve, ...ghostBlokken] : effectieve),
        [effectieve, ghostBlokken]
    );
    const scenarioBlokken = useMemo<Lesblok[]>(
        () => (preview ? berekenScenarioBlokken(effectieve, wegBlokken, ghostBlokken) : effectieve),
        [preview, effectieve, wegBlokken, ghostBlokken]
    );

    // De blokken van de uitvergrote week (zie WeekZoom).
    const zoomBlokken = useMemo<Lesblok[]>(() => {
        if (!zoomWeek) return [];
        const weekEind = fridayEndOf(zoomWeek);
        return getoondeBlokken.filter(
            b => b.start.getTime() >= zoomWeek.getTime() && b.start.getTime() <= weekEind.getTime()
        );
    }, [zoomWeek, getoondeBlokken]);

    // Alle weekstroken delen dezelfde hoogte: standaard tot 18u, uitgerekt tot
    // max 22u zodra het traject een avondschoolblok bevat dat later eindigt.
    const totalMin = useMemo(
        () => (gridEndHour(getoondeBlokken) - DAY_START_HOUR) * 60,
        [getoondeBlokken]
    );

    const conflicts = useMemo(() => detectConflicts(scenarioBlokken), [scenarioBlokken]);
    const conflictMap = useMemo(() => {
        const map = new Map<Lesblok, Lesblok[]>();
        const push = (key: Lesblok, val: Lesblok) => {
            const arr = map.get(key);
            if (arr) arr.push(val);
            else map.set(key, [val]);
        };
        conflicts.forEach(c => {
            push(c.a, c.b);
            push(c.b, c.a);
        });
        return map;
    }, [conflicts]);

    const weken = useMemo(() => weeksBetween(start, eind), [start, eind]);

    // Grensmarkeringen (semester-/modulestart) per week: de week waarin de
    // grensdatum valt krijgt er een boven zich.
    const grenzen = useMemo(
        () => periodeMarkeringen(periodeType, periodeGrenzen),
        [periodeType, periodeGrenzen]
    );
    const grenzenVoorWeek = (wkMonday: Date) => {
        const ma = toIsoDate(wkMonday);
        const zo = toIsoDate(addDays(wkMonday, 6));
        return grenzen.filter(g => g.datum >= ma && g.datum <= zo);
    };
    const weekInActievePeriode = (wkMonday: Date) =>
        bereikOverlapt(toIsoDate(wkMonday), toIsoDate(addDays(wkMonday, 4)), actiefBereik.van, actiefBereik.tot);

    // Bij een periodewissel scrollen we de eerste week van die periode in beeld.
    const eersteActieveRij = useRef<HTMLDivElement | null>(null);
    const heeftRijen = !error && traject.length > 0;
    useEffect(() => {
        eersteActieveRij.current?.scrollIntoView({ block: 'start' });
    }, [actiefBereik.van, actiefBereik.tot, heeftRijen]);

    // Bij een preview scrollen we de eerste week met een ghost-blok in beeld
    // (enkel als nodig), zodat een vak buiten de actieve periode niet
    // onzichtbaar blijft.
    const eersteGhostRij = useRef<HTMLDivElement | null>(null);
    const previewKey = preview
        ? `${preview.sels.map(s => s.olodNaam).join('+')}|${preview.klasgroep}`
        : null;
    useEffect(() => {
        if (previewKey) eersteGhostRij.current?.scrollIntoView({ block: 'nearest' });
    }, [previewKey]);
    const eersteGhostWeek = useMemo(() => {
        if (ghostBlokken.length === 0) return null;
        const eerste = ghostBlokken.reduce((a, b) => (b.start.getTime() < a.start.getTime() ? b : a));
        return weken.findIndex(wk => eerste.start.getTime() >= wk.getTime() && eerste.start.getTime() <= fridayEndOf(wk).getTime());
    }, [ghostBlokken, weken]);

    // Conflicten waar een ghost-blok bij betrokken is: nieuw door de wissel.
    const previewConflicten = useMemo(
        () => (preview ? conflicts.filter(c => ghostSet.has(c.a) || ghostSet.has(c.b)).length : 0),
        [preview, conflicts, ghostSet]
    );
    // Het aantal conflicten zonder de wissel — referentiepunt in de strip bij
    // een bulkwissel, waar het totaal na de wissel zegt of het rooster beter wordt.
    const huidigeConflicten = useMemo(
        () => (preview ? detectConflicts(effectieve).length : 0),
        [preview, effectieve]
    );
    // De klasgroep waar de verhuizende vakken nu zitten, of null zodra ze uit
    // meerdere klasgroepen komen (kan enkel bij een bulkwissel).
    const previewHerkomst = useMemo(() => {
        if (!preview) return null;
        const bronnen = new Set(preview.sels.map(s => s.klasgroep));
        return bronnen.size === 1 ? preview.sels[0].klasgroep : null;
    }, [preview]);
    const previewVakken = useMemo(
        () => (preview ? Array.from(new Set(preview.sels.map(s => s.olodNaam))) : []),
        [preview]
    );

    const olodLegend = useMemo(() => {
        const seen = new Set<string>();
        const out: string[] = [];
        for (const b of effectieve) {
            if (!seen.has(b.olodNaam)) {
                seen.add(b.olodNaam);
                out.push(b.olodNaam);
            }
        }
        return out.sort((a, b) => a.localeCompare(b));
    }, [effectieve]);

    return (
        <div className={styles.panel}>
            <div className={styles.panelHeader}>
                Studenttraject
                {busy && <Loader2 size={14} className="animate-spin" />}
                <span style={{ marginLeft: 'auto', fontWeight: 400, fontSize: '0.8rem', color: '#64748b' }}>
                    {traject.length} OLOD{traject.length === 1 ? '' : 's'}
                </span>
            </div>

            <div className={styles.panelBodyFlex}>
                {error && <div className={styles.emptyState}>{error}</div>}

                {preview && !error && (
                    <div
                        className={`${styles.previewStrip} ${
                            (previewVakken.length === 1 ? previewConflicten > 0 : conflicts.length > huidigeConflicten)
                                ? styles.previewStripConflict
                                : ''
                        }`}
                        role="status"
                    >
                        <Eye size={13} />
                        {previewVakken.slice(0, 4).map(naam => (
                            <span
                                key={naam}
                                className={styles.legendSwatch}
                                style={{ backgroundColor: colorOf(naam) }}
                                title={naam}
                            />
                        ))}
                        <span className={styles.previewStripText}>
                            {previewVakken.length === 1 ? (
                                <>
                                    <strong>{previewVakken[0]}</strong> bij <strong>{preview.klasgroep}</strong>
                                    {previewHerkomst ? ` i.p.v. ${previewHerkomst}` : ''}:{' '}
                                    {ghostBlokken.length === 0
                                        ? 'geen lessen in deze periode'
                                        : `${ghostBlokken.length} ${ghostBlokken.length === 1 ? 'les' : 'lessen'}, ${
                                              previewConflicten === 0
                                                  ? 'geen nieuwe conflicten'
                                                  : `${previewConflicten} ${previewConflicten === 1 ? 'conflict' : 'conflicten'}`
                                          }`}
                                </>
                            ) : (
                                <>
                                    <strong>{previewVakken.length} vakken</strong> bij{' '}
                                    <strong>{preview.klasgroep}</strong>
                                    {previewHerkomst ? ` i.p.v. ${previewHerkomst}` : ''}:{' '}
                                    {`${ghostBlokken.length} ${ghostBlokken.length === 1 ? 'les' : 'lessen'} · `}
                                    {conflicts.length === 0
                                        ? 'geen conflicten'
                                        : `${conflicts.length} ${conflicts.length === 1 ? 'conflict' : 'conflicten'}`}
                                    {` (nu ${huidigeConflicten})`}
                                </>
                            )}
                        </span>
                    </div>
                )}

                {!error && traject.length === 0 ? (
                    <div className={styles.emptyState}>
                        Klik op lesblokken in het klasgroeprooster om OLODs aan het traject toe te voegen.
                    </div>
                ) : (
                    <div className={styles.overzichtScroll} onScroll={hideTip}>
                        {weken.map((wkMonday, wi) => {
                            const wkVrijdagEnd = fridayEndOf(wkMonday);
                            const dagen = Array.from({ length: 5 }, (_, i) => addDays(wkMonday, i));
                            const wkBlokken = getoondeBlokken.filter(
                                b =>
                                    b.start.getTime() >= wkMonday.getTime() &&
                                    b.start.getTime() <= wkVrijdagEnd.getTime()
                            );
                            const actief = weekInActievePeriode(wkMonday);
                            const eersteActief = actief && (wi === 0 || !weekInActievePeriode(weken[wi - 1]));
                            const wkGrenzen = grenzenVoorWeek(wkMonday);
                            const rijRef = eersteActief ? eersteActieveRij : wi === eersteGhostWeek ? eersteGhostRij : undefined;
                            return (
                                <div key={wi} ref={rijRef}>
                                    {wkGrenzen.map(g => (
                                        <div key={g.datum} className={styles.periodeGrens}>
                                            <span>{g.label}</span>
                                            <small>{formatDateBE(parseIsoDate(g.datum))}</small>
                                        </div>
                                    ))}
                                <div className={`${styles.weekRow} ${actief ? styles.weekRowActief : ''}`}>
                                    <div className={styles.weekLabel}>
                                        Week {isoWeekNumber(wkMonday)}
                                        <small>{formatDateBE(wkMonday)}</small>
                                        <button
                                            type="button"
                                            className={styles.weekZoomBtn}
                                            onClick={() => {
                                                hideTip();
                                                setZoomWeek(wkMonday);
                                            }}
                                            title={`Week ${isoWeekNumber(wkMonday)} groot tonen`}
                                            aria-label={`Week ${isoWeekNumber(wkMonday)} groot tonen`}
                                        >
                                            <ZoomIn size={13} />
                                        </button>
                                    </div>
                                    <div className={styles.miniWeek}>
                                        {dagen.map((dag, di) => {
                                            const dayBlokken = wkBlokken.filter(b => sameDay(b.start, dag));
                                            const laidOut = layoutDay(dayBlokken);
                                            return (
                                                <div key={di} className={styles.miniDay}>
                                                    <div className={styles.miniDayHeader}>
                                                        {DAG_HEADERS[di]}
                                                    </div>
                                                    <div className={styles.miniDayBody}>
                                                        {laidOut.map(({ blok: b, col, cols }, bi) => {
                                                            const conflictsFor = conflictMap.get(b);
                                                            const conflict = !!conflictsFor;
                                                            const ghost = ghostSet.has(b);
                                                            const weg = wegBlokken.has(b);
                                                            const widthPct = 100 / cols;
                                                            const leftPct = col * widthPct;
                                                            const baseTip =
                                                                (ghost ? '👁 Preview — komt erbij bij wissel\n' : weg ? '👁 Preview — vervalt bij wissel\n' : '') +
                                                                `${b.olodNaam}\n${b.klasgroep}${b.type ? ` · ${b.type}` : ''}` +
                                                                `\n${formatTime(b.start)}–${formatTime(b.eind)}` +
                                                                (b.lokaal ? `\n${b.lokaal}` : '');
                                                            const conflictTip = conflictsFor
                                                                ? '\n\n⚠ Conflict met:\n' +
                                                                  conflictsFor
                                                                      .map(
                                                                          o =>
                                                                              `• ${o.olodNaam} (${o.klasgroep}${o.type ? `, ${o.type}` : ''})` +
                                                                              ` · ${formatTime(o.start)}–${formatTime(o.eind)}`
                                                                      )
                                                                      .join('\n')
                                                                : '';
                                                            const blokTip = baseTip + conflictTip;
                                                            return (
                                                                <div
                                                                    key={bi}
                                                                    className={`${styles.miniBlok} ${conflict ? styles.miniBlokConflict : ''} ${ghost ? styles.miniBlokGhost : ''} ${weg ? styles.miniBlokWeg : ''}`}
                                                                    onMouseEnter={e => showTip(e, blokTip)}
                                                                    onMouseLeave={hideTip}
                                                                    style={{
                                                                        top: `${topPct(b.start, totalMin)}%`,
                                                                        height: `${heightPct(b.start, b.eind, totalMin)}%`,
                                                                        left: `calc(${leftPct}% + 1px)`,
                                                                        width: `calc(${widthPct}% - 2px)`,
                                                                        backgroundColor: colorOf(b.olodNaam),
                                                                    }}
                                                                >
                                                                    <LesblokIcon
                                                                        type={b.type}
                                                                        size={10}
                                                                        strokeWidth={2.5}
                                                                        className={styles.miniBlokIcon}
                                                                    />
                                                                    {conflict && (
                                                                        <AlertTriangle
                                                                            size={10}
                                                                            strokeWidth={2.5}
                                                                            className={styles.miniBlokConflictIcon}
                                                                        />
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Color legend */}
            {olodLegend.length > 0 && (
                <div className={styles.legendRow}>
                    {olodLegend.map(name => (
                        <span key={name} className={styles.legendChip}>
                            <span className={styles.legendSwatch} style={{ backgroundColor: colorOf(name) }} />
                            {name}
                        </span>
                    ))}
                </div>
            )}

            {/* Conflicts */}
            {conflicts.length > 0 && (
                <div className={styles.conflicts}>
                    <div
                        className={`${styles.conflictsHeader} ${styles.conflictsHeaderError}`}
                        onClick={() => setConflictsOpen(o => !o)}
                    >
                        {conflictsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <AlertTriangle size={14} />
                        {conflicts.length} conflict{conflicts.length === 1 ? '' : 'en'}
                        {preview && <span className={styles.conflictsPreviewHint}>bij wissel naar {preview.klasgroep}</span>}
                    </div>
                    {conflictsOpen && (
                        <div className={styles.conflictsList}>
                            {conflicts.map((c, i) => (
                                <div key={i} className={styles.conflictItem}>
                                    <div>
                                        <strong>{c.a.olodNaam}</strong> ({c.a.klasgroep}) ·{' '}
                                        {formatDateTime(c.a.start)} – {formatTime(c.a.eind)}
                                    </div>
                                    <div>
                                        <strong>{c.b.olodNaam}</strong> ({c.b.klasgroep}) ·{' '}
                                        {formatDateTime(c.b.start)} – {formatTime(c.b.eind)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {tip && <MiniTooltip tip={tip} />}

            {zoomWeek && traject.length > 0 && (
                <WeekZoom
                    weekMonday={zoomWeek}
                    blokken={zoomBlokken}
                    conflictMap={conflictMap}
                    ghostSet={ghostSet}
                    wegSet={wegBlokken}
                    colorOf={colorOf}
                    onClose={() => setZoomWeek(null)}
                />
            )}
        </div>
    );
}
