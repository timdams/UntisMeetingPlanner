import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isActief, Lesblok, OLODSelectie, StudentTraject } from './types';
import {
    detectConflicts,
    effectieveBlokken as berekenEffectieveBlokken,
    ghostBlokkenVoor,
    overlapt,
    scenarioBlokken as berekenScenarioBlokken,
    wegBlokkenVoor,
} from './conflicts';
import {
    addDays,
    bereikOverlapt,
    DAG_HEADERS,
    datumInBereik,
    DAY_START_HOUR,
    formatDateBE,
    formatDateTime,
    formatTime,
    fridayEndOf,
    gridEndHour,
    isoWeekNumber,
    mondayOf,
    parseIsoDate,
    periodeBereik,
    sameDay,
    toIsoDate,
    weeksBetween,
} from './dateUtils';
import {
    academiejaarBereik,
    actievePeriode,
    allePeriodes,
    periodeMarkeringen,
    type PeriodeGrenzen,
    type PeriodeType,
} from './academicYear';
import { useWeekRoosters, type KlasgroepPreview } from './useTrajectBlokken';
import styles from './Traject.module.css';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye, Loader2, ZoomIn } from 'lucide-react';
import { LesblokIcon } from './LesblokIcon';
import { layoutDay } from './layout';
import { WeekZoom } from './WeekZoom';
import { OlodKlasgroepDialoog, type KiezerKandidaat } from './OlodKlasgroepDialoog';

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
    // De klasgroep-shortlist: de kandidaten in de kiezer die vanuit een blokje
    // opengaat. De klasgroep van het blokje zelf komt er altijd bij.
    shortlist: string[];
    colorOf: (olodNaam: string) => string;
    // Verhuist de keuzes achter een blokje naar een andere klasgroep. Krijgt
    // altijd de selecties van één vak mee (meestal precies één).
    onVerhuis: (sels: OLODSelectie[], klasgroep: string) => void;
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
    shortlist,
    colorOf,
    onVerhuis,
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

    // De statusregel bovenaan klapt het conflictpaneel onderaan open en brengt
    // het in beeld.
    const conflictPaneelRef = useRef<HTMLDivElement | null>(null);
    const toonConflicten = () => {
        setConflictsOpen(true);
        window.requestAnimationFrame(() =>
            conflictPaneelRef.current?.scrollIntoView({ block: 'nearest' })
        );
    };

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
    // Gedeactiveerde selecties staan wel in de lijst links, maar niet in dit
    // rooster: de teller en de lege staat rekenen dus met de actieve.
    const actieveSelecties = useMemo(() => traject.filter(isActief).length, [traject]);
    const gedeactiveerd = traject.length - actieveSelecties;
    const heeftRijen = !error && actieveSelecties > 0;
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

    // ===== Verhuizen vanuit een blokje in dit overzicht =====
    // Een klik op een lesblokje opent dezelfde klasgroep-kiezer als het knopje
    // op een lesblok in paneel B, maar met verhuis-semantiek: de keuze áchter
    // dat blokje gaat naar de aangeklikte klasgroep, er komt er geen bij.
    const [verhuisBlok, setVerhuisBlok] = useState<Lesblok | null>(null);
    const verhuisWeek = useMemo(
        () => (verhuisBlok ? mondayOf(verhuisBlok.start) : null),
        [verhuisBlok]
    );

    // De selecties die dit blokje in het rooster zetten. Normaal precies één;
    // twee kan (een semesterkeuze naast een modulekeuze bij dezelfde klasgroep)
    // en dan verhuizen ze samen — anders bleef het blokje gewoon staan.
    const verhuisSels = useMemo<OLODSelectie[]>(() => {
        if (!verhuisBlok) return [];
        return traject.filter(
            s =>
                isActief(s) &&
                s.klasgroep === verhuisBlok.klasgroep &&
                s.olodNaam === verhuisBlok.olodNaam &&
                datumInBereik(verhuisBlok.start, s.van, s.tot)
        );
    }, [verhuisBlok, traject]);

    // De kandidaten die we bevragen: de shortlist plus de klasgroep waar het
    // vak nu bij zit — die kan intussen uit de shortlist verdwenen zijn.
    const verhuisKandidaatKlassen = useMemo(() => {
        if (!verhuisBlok) return [];
        const set = new Set(shortlist);
        set.add(verhuisBlok.klasgroep);
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [shortlist.join('|'), verhuisBlok]);

    const { perKlas: verhuisRoosters, loading: verhuisLaadt } = useWeekRoosters(
        verhuisKandidaatKlassen,
        verhuisWeek
    );

    // De lessen die bij de verhuis uit het rooster verdwijnen; de rest van het
    // traject blijft staan en bepaalt dus waar een kandidaat deze week botst.
    const verhuisWeg = useMemo(
        () =>
            verhuisSels.length > 0
                ? wegBlokkenVoor(verhuisSels, traject, effectieve)
                : new Set<Lesblok>(),
        [verhuisSels, traject, effectieve]
    );

    const verhuisKandidaten = useMemo<KiezerKandidaat[]>(() => {
        if (!verhuisBlok || !verhuisWeek) return [];
        const olodNaam = verhuisBlok.olodNaam;
        const weekEind = fridayEndOf(verhuisWeek);
        const restWeek = effectieve.filter(
            b =>
                !verhuisWeg.has(b) &&
                b.start.getTime() >= verhuisWeek.getTime() &&
                b.start.getTime() <= weekEind.getTime()
        );
        const maak = (kg: string): KiezerKandidaat | null => {
            const all = verhuisRoosters[kg] ?? [];
            const match = all
                .filter(b => b.olodNaam === olodNaam)
                .sort((a, b) => a.start.getTime() - b.start.getTime());
            if (match.length === 0) return null;
            const huidig = kg === verhuisBlok.klasgroep;
            const gekozen = traject.some(
                s =>
                    isActief(s) &&
                    s.klasgroep === kg &&
                    s.olodNaam === olodNaam &&
                    datumInBereik(match[0].start, s.van, s.tot)
            );
            // Lessen van hetzelfde vak bij deze klasgroep tellen niet als
            // tegenpartij: dat zijn de lessen die de verhuis hier zou brengen.
            const anderen = restWeek.filter(b => !(b.klasgroep === kg && b.olodNaam === olodNaam));
            const botsend = match.filter(mb => anderen.some(ab => overlapt(mb, ab)));
            return {
                klasgroep: kg,
                huidig,
                allBlokken: all,
                matchBlokken: match,
                gekozen,
                botsend,
                actie: huidig
                    ? 'De student volgt dit vak hier — klik om te sluiten'
                    : gekozen
                      ? 'Klik om te verhuizen — valt samen met de keuze die hier al staat'
                      : 'Klik om dit vak hierheen te verhuizen',
            };
        };
        const eigen = maak(verhuisBlok.klasgroep);
        const rest = verhuisKandidaatKlassen
            .filter(k => k !== verhuisBlok.klasgroep)
            .map(maak)
            .filter((k): k is KiezerKandidaat => k !== null);
        return eigen ? [eigen, ...rest] : rest;
    }, [
        verhuisBlok,
        verhuisWeek,
        verhuisRoosters,
        verhuisKandidaatKlassen,
        verhuisWeg,
        effectieve,
        traject,
    ]);

    // De periode die mee verhuist. De keuze geldt voor haar hele bereik, niet
    // enkel voor de week waarin geklikt is — dat moet in de kopbalk staan.
    const verhuisPeriode = useMemo(() => {
        if (verhuisSels.length !== 1) return null;
        const sel = verhuisSels[0];
        const datums = `${formatDateBE(parseIsoDate(sel.van))} – ${formatDateBE(parseIsoDate(sel.tot))}`;
        const p = actievePeriode(allePeriodes(periodeGrenzen), sel.van, sel.tot);
        return p ? `${p.kort} · ${datums}` : datums;
    }, [verhuisSels, periodeGrenzen]);

    const kiesVerhuis = (kandidaat: KiezerKandidaat) => {
        if (!kandidaat.huidig && verhuisSels.length > 0) {
            onVerhuis(verhuisSels, kandidaat.klasgroep);
        }
        setVerhuisBlok(null);
    };

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
                <span className={styles.panelStap}>3</span>
                Traject van de student
                {busy && <Loader2 size={14} className="animate-spin" />}
                <span
                    style={{ marginLeft: 'auto', fontWeight: 400, fontSize: '0.8rem', color: '#64748b' }}
                    title={
                        gedeactiveerd > 0
                            ? `${actieveSelecties} in dit rooster, ${gedeactiveerd} gedeactiveerd (staan wel nog in de lijst links)`
                            : undefined
                    }
                >
                    {actieveSelecties} OLOD{actieveSelecties === 1 ? '' : 's'}
                    {gedeactiveerd > 0 && ` (+${gedeactiveerd} uit)`}
                </span>
            </div>

            <div className={styles.panelBodyFlex}>
                {error && <div className={styles.emptyState}>{error}</div>}

                {/* Vaste statusregel: bevestigt ook actief dát het klopt. Het
                    conflictpaneel onderaan verschijnt enkel bij conflicten, dus
                    zonder deze regel blijft "alles in orde" onuitgesproken — terwijl
                    de bulk-kiezer in paneel A wél naar dit getal verwijst ("nu N
                    conflicten"). Tijdens een wat-als-preview neemt de strip hieronder
                    het over, met haar eigen referentiepunt. */}
                {!error && !preview && actieveSelecties > 0 && (
                    busy ? (
                        <div className={styles.statusRij}>
                            <Loader2 size={13} className="animate-spin" />
                            <span>Rooster laden…</span>
                        </div>
                    ) : conflicts.length === 0 ? (
                        <div className={`${styles.statusRij} ${styles.statusRijOk}`} role="status">
                            <CheckCircle2 size={13} />
                            <span>Geen conflicten in dit traject</span>
                        </div>
                    ) : (
                        <button
                            type="button"
                            className={`${styles.statusRij} ${styles.statusRijConflict}`}
                            onClick={toonConflicten}
                            title="Toon de overlappende lessen onderaan dit paneel"
                        >
                            <AlertTriangle size={13} />
                            <span>
                                {conflicts.length} {conflicts.length === 1 ? 'conflict' : 'conflicten'} in dit
                                traject
                            </span>
                            <span className={styles.statusRijActie}>toon</span>
                        </button>
                    )
                )}

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

                {!error && actieveSelecties === 0 ? (
                    <div className={styles.emptyState}>
                        {traject.length === 0
                            ? 'Klik op lesblokken in het klasgroeprooster om OLODs aan het traject toe te voegen.'
                            : 'Alle gekozen OLODs staan uit. Zet er een terug aan in de lijst links om ze hier te zien.'}
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
                                                            // Een ghost-blokje hoort bij nog niets in
                                                            // het traject: daar valt niets te verhuizen.
                                                            const verhuisbaar = !ghost;
                                                            const blokTip =
                                                                baseTip +
                                                                conflictTip +
                                                                (verhuisbaar
                                                                    ? '\n\n→ Klik om dit vak in een andere klasgroep te volgen'
                                                                    : '');
                                                            return (
                                                                <button
                                                                    key={bi}
                                                                    type="button"
                                                                    className={`${styles.miniBlok} ${verhuisbaar ? styles.miniBlokKlikbaar : ''} ${conflict ? styles.miniBlokConflict : ''} ${ghost ? styles.miniBlokGhost : ''} ${weg ? styles.miniBlokWeg : ''}`}
                                                                    aria-label={
                                                                        verhuisbaar
                                                                            ? `${b.olodNaam} bij ${b.klasgroep} — kies een andere klasgroep`
                                                                            : `${b.olodNaam} bij ${b.klasgroep}`
                                                                    }
                                                                    onMouseEnter={e => showTip(e, blokTip)}
                                                                    onMouseLeave={hideTip}
                                                                    onClick={() => {
                                                                        if (!verhuisbaar) return;
                                                                        hideTip();
                                                                        setVerhuisBlok(b);
                                                                    }}
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
                                                                </button>
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
                <div className={styles.conflicts} ref={conflictPaneelRef}>
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

            {verhuisBlok && verhuisWeek && (
                <OlodKlasgroepDialoog
                    olodNaam={verhuisBlok.olodNaam}
                    weekMonday={verhuisWeek}
                    kandidaten={verhuisKandidaten}
                    loading={verhuisLaadt}
                    aantalShortlist={verhuisKandidaatKlassen.length}
                    hint={
                        <>
                            Klik op de klasgroep waar de student dit vak voortaan volgt — de keuze
                            verhuist, ze wordt niet gekopieerd.
                            {verhuisPeriode && (
                                <>
                                    {' '}
                                    De hele periode <strong>{verhuisPeriode}</strong> gaat mee, niet
                                    alleen deze week.
                                </>
                            )}
                        </>
                    }
                    colorOf={colorOf}
                    onKies={kiesVerhuis}
                    onClose={() => setVerhuisBlok(null)}
                />
            )}

            {zoomWeek && actieveSelecties > 0 && (
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
