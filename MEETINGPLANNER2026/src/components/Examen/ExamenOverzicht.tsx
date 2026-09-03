import { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    CalendarDays,
    CalendarOff,
    CalendarRange,
    ChevronLeft,
    ChevronRight,
    Copy,
    Download,
    Eye,
    Info,
    LayoutGrid,
    Link2,
    Loader2,
    Printer,
    RefreshCw,
    Settings as SettingsIcon,
    Share2,
} from 'lucide-react';
import {
    addDays,
    formatDateBE,
    formatDateTime,
    formatTime,
    isoWeekNumber,
    mondayOf,
    parseIsoDate,
    toIsoDate,
} from '../Traject/dateUtils';
import { TopbarMenu, TopbarMenuItem } from '../Traject/TopbarMenu';
import { BevestigDialog } from '../Traject/TrajectDialogs';
import { copyToClipboard } from '../Traject/trajectShare';
import tstyles from '../Traject/Traject.module.css';
import s from './Examen.module.css';
import { beoordeelJaargroep, isBlended, overeenkomstPct, type Beoordeling } from './beoordeling';
import { ExamenRaster } from './ExamenRaster';
import { ExamenSettingsView, type ExamenKaart } from './ExamenSettings';
import { buildExamenShareUrl, type ExamenShare } from './examenShare';
import { useExamenActief, useExamenPeriode, useOpleidingen, zelfdeNaam } from './examenStore';
import { effectievePeriode, examenWeken, standaardWeek } from './periode';
import { bestandsnaam, downloadBlob, kanPngKopieren, kopieerPng, svgNaarPng } from './exportPng';
import {
    bouwJaargroepOverzicht,
    effectieveJaargroepen,
    isGeannuleerd,
    isLosseJaargroep,
    maakDiagnose,
    statusLabel,
} from './merge';
import type { Afwijking, Examen, JaargroepOverzicht, Opleiding } from './types';
import { useExamenWeek } from './useExamenWeek';

type Tab = 'overzicht' | 'instellingen';

interface Props {
    onBack: () => void;
    /** Een deel-link die bij het laden gevonden werd; wordt pas na bevestiging overgenomen. */
    pendingShare?: ExamenShare | null;
}

function meervoud(n: number, enkel: string, meer: string): string {
    return `${n} ${n === 1 ? enkel : meer}`;
}

function dagTijd(ex: Examen): string {
    const dag = ex.start.toLocaleDateString('nl-BE', { weekday: 'short' });
    return `${dag} ${formatTime(ex.start)}–${formatTime(ex.eind)}`;
}

function afwijkingTekst(a: Afwijking): { klasse: string; tekst: string } {
    switch (a.soort) {
        case 'subset':
            return {
                klasse: s.afwijkingSubset,
                tekst: `${a.examen.olodNaam} (${dagTijd(a.examen)}) geldt enkel voor ${a.examen.klasgroepen.join(', ')} — niet voor ${a.examen.ontbrekend.join(', ')}.`,
            };
        case 'status': {
            const ex = a.examen;
            const anderen = ex.klasgroepen.filter(k => !ex.statusKlasgroepen.includes(k));
            const wie = ex.statusVoorAlle
                ? ''
                : ` voor ${ex.statusKlasgroepen.join(', ')}${anderen.length > 0 ? ` (niet voor ${anderen.join(', ')})` : ''}`;
            return {
                klasse: s.afwijkingStatus,
                tekst: isGeannuleerd(ex.status)
                    ? `${ex.olodNaam} (${dagTijd(ex)}) is in Untis geannuleerd${wie}.`
                    : `${ex.olodNaam} (${dagTijd(ex)}) staat in Untis als "${statusLabel(ex.status ?? '')}"${wie} (${ex.status}).`,
            };
        }
        case 'mislukt':
            return {
                klasse: s.afwijkingMislukt,
                tekst: `Rooster van ${a.klasgroep} kon niet opgehaald worden (${a.fout}) — examens van deze klasgroep ontbreken mogelijk.`,
            };
        case 'leeg':
            return {
                klasse: s.afwijkingLeeg,
                tekst: `${a.klasgroep} heeft in deze week geen enkel blok in Untis — controleer of dat klopt.`,
            };
    }
}

function AfwijkingenLijst({ overzicht }: { overzicht: JaargroepOverzicht }) {
    if (overzicht.afwijkingen.length === 0) return null;
    return (
        <ul className={s.afwijkingen}>
            <li className={s.afwijkingenKop}>Afwijkingen</li>
            {overzicht.afwijkingen.map((a, i) => {
                const { klasse, tekst } = afwijkingTekst(a);
                return (
                    <li key={i} className={`${s.afwijking} ${klasse}`}>
                        <AlertTriangle size={14} />
                        <span>{tekst}</span>
                    </li>
                );
            })}
        </ul>
    );
}

interface MeldingProps {
    overzicht: JaargroepOverzicht;
    beoordeling: Beoordeling;
    /** Sommige andere jaargroepen hebben deze week wél examens. */
    blended: boolean;
    /** Ontbreekt in de afdrukweergave: daar valt niets meer te klikken. */
    onToonToch?: () => void;
}

/**
 * Wat er in plaats van een raster komt te staan. Elk geval krijgt een eigen
 * uitleg: een leeg raster mag nooit als "vergeten" gelezen worden, en een
 * gewone lesweek mag niet als examenoverzicht rondgestuurd worden.
 */
function GeenRasterMelding({ overzicht, beoordeling, blended, onToonToch }: MeldingProps) {
    const klassen = overzicht.jaargroep.klasgroepen.join(', ');

    if (beoordeling.soort === 'geen-examens') {
        return (
            <div className={`${s.melding2} ${s.meldingNeutraal}`}>
                <CalendarOff size={18} />
                <div>
                    <strong>Geen examens deze week.</strong> Het rooster van {klassen} is opgehaald en
                    bevat deze week geen enkel blok.
                    {blended && ' Andere jaargroepen van deze opleiding hebben wel examens — dit is een gedeeltelijke examenweek.'}
                </div>
            </div>
        );
    }

    if (beoordeling.soort === 'geen-rooster') {
        return (
            <div className={`${s.melding2} ${s.meldingFout}`}>
                <AlertTriangle size={18} />
                <div>
                    <strong>Geen rooster beschikbaar.</strong> Voor geen enkele klasgroep van deze
                    jaargroep kon het rooster opgehaald worden.
                    {overzicht.afwijkingen
                        .filter(a => a.soort === 'mislukt')
                        .slice(0, 1)
                        .map((a, i) => (
                            <span key={i}> {afwijkingTekst(a).tekst}</span>
                        ))}
                </div>
            </div>
        );
    }

    const pct = overeenkomstPct(beoordeling);
    return (
        <div className={`${s.melding2} ${s.meldingWaarschuwing}`}>
            <AlertTriangle size={18} />
            <div>
                <strong>Dit lijkt geen examenweek.</strong> De klasgroepen van deze jaargroep hebben
                deze week sterk verschillende roosters
                {pct !== null && ` (${pct}% overeenkomst)`}. In een examenweek zitten ze samen in
                dezelfde examens. Kies een andere week, of controleer of de jaargroep nog klopt.
                <div className={s.meldingDetail}>
                    Blokken per klasgroep:{' '}
                    {beoordeling.metBlokken
                        .map(k => `${k} (${overzicht.examens.filter(e => e.klasgroepen.includes(k)).length})`)
                        .join(' · ')}
                </div>
                {onToonToch && (
                    <div className={tstyles.backupRow}>
                        <button type="button" className={tstyles.toolbarBtn} onClick={onToonToch}>
                            <Eye size={14} /> Toch tonen
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

interface KaartProps {
    overzicht: JaargroepOverzicht;
    beoordeling: Beoordeling;
    maandag: Date;
    opleidingNaam: string;
    opgehaaldOp: Date | null;
    laden: boolean;
    toonRaster: boolean;
    overruled: boolean;
    blended: boolean;
    onToonToch: () => void;
    onMeld: (tekst: string) => void;
}

function JaargroepKaart({
    overzicht,
    beoordeling,
    maandag,
    opleidingNaam,
    opgehaaldOp,
    laden,
    toonRaster,
    overruled,
    blended,
    onToonToch,
    onMeld,
}: KaartProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [bezig, setBezig] = useState(false);
    const { jaargroep, examens } = overzicht;
    const subset = examens.filter(e => !e.volledig).length;
    const naam = bestandsnaam(opleidingNaam, jaargroep.naam, `week${isoWeekNumber(maandag)}`);

    const maakPng = async (): Promise<Blob | null> => {
        if (!svgRef.current) return null;
        setBezig(true);
        try {
            return await svgNaarPng(svgRef.current);
        } catch (e) {
            onMeld(e instanceof Error ? e.message : 'PNG aanmaken mislukt');
            return null;
        } finally {
            setBezig(false);
        }
    };

    const kopieer = async () => {
        const blob = await maakPng();
        if (!blob) return;
        onMeld((await kopieerPng(blob)) ? 'PNG gekopieerd naar het klembord' : 'Kopiëren mislukt — gebruik "PNG downloaden"');
    };

    const download = async () => {
        const blob = await maakPng();
        if (!blob) return;
        downloadBlob(blob, naam);
    };

    return (
        <section className={s.kaart} aria-label={`Raster ${jaargroep.naam}`}>
            <div className={s.kaartKop}>
                <div>
                    <span className={s.kaartTitel}>{jaargroep.naam}</span>
                    <span className={s.kaartMeta}>
                        {isLosseJaargroep(jaargroep)
                            ? 'niet ingedeeld'
                            : jaargroep.klasgroepen.join(', ')}
                        {!laden && toonRaster && ` · ${meervoud(examens.length, 'examen', 'examens')}`}
                        {!laden && toonRaster && subset > 0 && (
                            <span className={s.kaartMetaWaarschuwing}>
                                {' '}· {subset} niet voor alle klassen
                            </span>
                        )}
                        {!laden && overruled && (
                            <span className={s.kaartMetaWaarschuwing}> · getoond op eigen verzoek</span>
                        )}
                    </span>
                </div>
                {!laden && toonRaster && (
                    <div className={s.kaartActies}>
                        {kanPngKopieren() && (
                            <button
                                type="button"
                                className={tstyles.toolbarBtn}
                                onClick={kopieer}
                                disabled={bezig}
                                title="Kopieer dit raster als afbeelding naar het klembord (plakken in mail of Teams)"
                            >
                                {bezig ? <Loader2 className="animate-spin" size={14} /> : <Copy size={14} />} PNG
                                kopiëren
                            </button>
                        )}
                        <button
                            type="button"
                            className={tstyles.toolbarBtn}
                            onClick={download}
                            disabled={bezig}
                            title="Download dit raster als PNG-bestand"
                        >
                            <Download size={14} /> PNG downloaden
                        </button>
                    </div>
                )}
            </div>
            {laden ? (
                <div className={s.rasterLaden}>
                    <Loader2 className="animate-spin" size={18} /> Rooster ophalen…
                </div>
            ) : toonRaster ? (
                <>
                    <div className={s.rasterWrap}>
                        <ExamenRaster
                            ref={svgRef}
                            overzicht={overzicht}
                            weekMaandag={maandag}
                            opleidingNaam={opleidingNaam}
                            opgehaaldOp={opgehaaldOp}
                        />
                    </div>
                    <AfwijkingenLijst overzicht={overzicht} />
                </>
            ) : (
                <GeenRasterMelding
                    overzicht={overzicht}
                    beoordeling={beoordeling}
                    blended={blended}
                    onToonToch={beoordeling.soort === 'lesweek' ? onToonToch : undefined}
                />
            )}
        </section>
    );
}

export function ExamenOverzicht({ onBack, pendingShare = null }: Props) {
    const store = useOpleidingen();
    const { opleidingen } = store;
    const { actief, setOpleidingId, setWeek, volgStandaard } = useExamenActief();
    const { periode, zetGrens, herstel: herstelPeriode } = useExamenPeriode();
    const [share, setShare] = useState<ExamenShare | null>(pendingShare);
    const [tab, setTab] = useState<Tab>(opleidingen.length === 0 && !pendingShare ? 'instellingen' : 'overzicht');
    const [initieleKaart, setInitieleKaart] = useState<ExamenKaart>('opleidingen');
    const [melding, setMelding] = useState<string | null>(null);
    // Jaargroepen die de gebruiker ondanks de waarschuwing wil zien, per week
    // ("jaargroepId|weekMaandag"). Vluchtig: een andere week verdient een verse
    // beoordeling.
    const [toonToch, setToonToch] = useState<Set<string>>(() => new Set());
    const meldingTimer = useRef<number | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);

    const meld = (tekst: string) => {
        if (meldingTimer.current !== null) window.clearTimeout(meldingTimer.current);
        setMelding(tekst);
        meldingTimer.current = window.setTimeout(() => setMelding(null), 3000);
    };
    useEffect(
        () => () => {
            if (meldingTimer.current !== null) window.clearTimeout(meldingTimer.current);
        },
        []
    );

    // Liggend afdrukken past bij een weekraster. De regel geldt enkel zolang
    // deze module gemount is, zodat de andere modules er niets van merken.
    useEffect(() => {
        const el = document.createElement('style');
        el.textContent = '@page { size: landscape; margin: 10mm; }';
        document.head.appendChild(el);
        return () => {
            el.remove();
        };
    }, []);

    // De actieve opleiding: de bewaarde keuze zolang die bestaat, anders de eerste.
    const opleiding: Opleiding | null = useMemo(
        () => opleidingen.find(o => o.id === actief.opleidingId) ?? opleidingen[0] ?? null,
        [opleidingen, actief.opleidingId]
    );
    useEffect(() => {
        if (opleiding && opleiding.id !== actief.opleidingId) setOpleidingId(opleiding.id);
        if (!opleiding && actief.opleidingId) setOpleidingId(null);
    }, [opleiding, actief.opleidingId, setOpleidingId]);

    const weekMaandag = actief.weekMaandag;

    // De grenzen van deze opleiding: haar eigen als ze die heeft, anders de
    // algemene. Alles wat van de semestergrenzen afhangt (de S1/S2-knoppen,
    // de standaardweek) volgt hieruit — een opleiding met een afwijkende
    // examenperiode mag niet op de algemene examenweek terechtkomen.
    const opleidingPeriode = useMemo(
        () => effectievePeriode(periode, opleiding?.eigenPeriode),
        [periode, opleiding]
    );
    const eigenPeriode = Boolean(opleiding?.eigenPeriode);
    const weken = useMemo(() => examenWeken(opleidingPeriode), [opleidingPeriode]);

    // Zolang de gebruiker geen eigen week koos, volgt de week de eerstvolgende
    // examenweek — ook wanneer de semestergrenzen net gewijzigd zijn of er van
    // opleiding gewisseld wordt.
    useEffect(() => {
        if (!actief.weekGekozen) volgStandaard(standaardWeek(opleidingPeriode));
    }, [opleidingPeriode, actief.weekGekozen, volgStandaard]);

    const maandag = useMemo(() => parseIsoDate(weekMaandag), [weekMaandag]);
    const vrijdag = useMemo(() => addDays(maandag, 4), [maandag]);
    const weekNr = isoWeekNumber(maandag);

    // Enkel ophalen terwijl het overzicht zichtbaar is; bij terugkeer uit de
    // instellingen komt de week uit de cache.
    const klasgroepen = useMemo(
        () => (tab === 'overzicht' && opleiding ? opleiding.klasgroepen : []),
        [tab, opleiding]
    );
    const { perKlas, opgehaaldOp, busy, herlaad } = useExamenWeek(klasgroepen, weekMaandag);

    const jaargroepen = useMemo(
        () => (opleiding ? effectieveJaargroepen(opleiding.jaargroepen, opleiding.klasgroepen) : []),
        [opleiding]
    );
    const overzichten = useMemo(
        () => jaargroepen.map(j => bouwJaargroepOverzicht(j, perKlas)),
        [jaargroepen, perKlas]
    );
    const beoordelingen = useMemo(() => overzichten.map(beoordeelJaargroep), [overzichten]);
    const blended = useMemo(() => isBlended(beoordelingen), [beoordelingen]);

    const magTonen = (i: number) =>
        beoordelingen[i].soort === 'examenweek' ||
        toonToch.has(`${overzichten[i].jaargroep.id}|${weekMaandag}`);

    const zichtbareRasters = overzichten.filter((_, i) => magTonen(i)).length;
    const totaalExamens = overzichten.reduce((n, o, i) => (magTonen(i) ? n + o.examens.length : n), 0);
    const geannuleerd = overzichten.reduce(
        (n, o, i) => (magTonen(i) ? n + o.examens.filter(e => isGeannuleerd(e.status)).length : n),
        0
    );
    const zonderExamens = beoordelingen.filter(b => b.soort === 'geen-examens').length;
    const zonderRooster = (opleiding?.klasgroepen ?? []).filter(k => perKlas[k]?.fout);
    const diagnose = useMemo(() => maakDiagnose(perKlas, overzichten), [perKlas, overzichten]);

    const naarInstellingen = (kaart: ExamenKaart) => {
        setInitieleKaart(kaart);
        setTab('instellingen');
    };

    // ===== Deel-link overnemen =====
    const bestaandeMetNaam = share ? opleidingen.find(o => zelfdeNaam(o.naam, share.opleiding.naam)) : undefined;
    const neemShareOver = () => {
        if (!share) return;
        const id = store.importeer(share.opleiding, bestaandeMetNaam?.id);
        setOpleidingId(id);
        if (share.weekMaandag) setWeek(share.weekMaandag);
        setShare(null);
        setTab('overzicht');
    };

    // ===== Exporteren =====
    const handlePrint = () => window.print();

    const handleAllePng = async () => {
        if (!opleiding || !bodyRef.current) return;
        const svgs = Array.from(bodyRef.current.querySelectorAll<SVGSVGElement>('svg[data-examen-raster]'));
        if (svgs.length === 0) {
            meld('Geen rasters om te exporteren');
            return;
        }
        for (const svg of svgs) {
            const id = svg.getAttribute('data-examen-raster');
            const jg = jaargroepen.find(j => j.id === id);
            try {
                const blob = await svgNaarPng(svg);
                downloadBlob(blob, bestandsnaam(opleiding.naam, jg?.naam ?? 'raster', `week${weekNr}`));
            } catch (e) {
                meld(e instanceof Error ? e.message : 'PNG aanmaken mislukt');
                return;
            }
        }
        meld(`${meervoud(svgs.length, 'PNG', "PNG's")} gedownload`);
    };

    const handleLink = async () => {
        if (!opleiding) return;
        const url = buildExamenShareUrl(opleiding, weekMaandag);
        meld((await copyToClipboard(url)) ? 'Link naar dit overzicht gekopieerd' : 'Kopiëren mislukt');
    };

    const exportMogelijk = !!opleiding && opleiding.klasgroepen.length > 0 && tab === 'overzicht';

    return (
        <>
            <div className={tstyles.screenRoot}>
                <div className={tstyles.page}>
                    <div className={tstyles.topbar}>
                        <button
                            className={tstyles.toolbarBtn}
                            onClick={onBack}
                            title="Terug naar het hoofdmenu — kies een andere tool"
                        >
                            <ArrowLeft size={14} /> Menu
                        </button>
                        <div className={tstyles.topbarTitle}>Examenoverzicht</div>

                        <div className={tstyles.tabs}>
                            <button
                                className={`${tstyles.tab} ${tab === 'overzicht' ? tstyles.tabActive : ''}`}
                                onClick={() => setTab('overzicht')}
                            >
                                <LayoutGrid size={14} /> Overzicht
                            </button>
                            <button
                                className={`${tstyles.tab} ${tab === 'instellingen' ? tstyles.tabActive : ''}`}
                                onClick={() => naarInstellingen('opleidingen')}
                            >
                                <SettingsIcon size={14} /> Instellingen
                            </button>
                        </div>

                        {opleidingen.length > 1 ? (
                            <select
                                className={s.opleidingSelect}
                                value={opleiding?.id ?? ''}
                                onChange={e => setOpleidingId(e.target.value)}
                                title="Welke opleiding wordt getoond"
                                aria-label="Opleiding"
                            >
                                {opleidingen.map(o => (
                                    <option key={o.id} value={o.id}>
                                        {o.naam || 'naamloos'}
                                    </option>
                                ))}
                            </select>
                        ) : opleiding ? (
                            <span className={tstyles.trajectNaamChip} title="De getoonde opleiding">
                                {opleiding.naam || 'naamloos'}
                            </span>
                        ) : null}

                        {eigenPeriode && (
                            <button
                                type="button"
                                className={s.eigenPeriodeChip}
                                onClick={() => naarInstellingen('periode')}
                                title={
                                    `${opleiding?.naam || 'Deze opleiding'} heeft eigen semestergrenzen; ` +
                                    'de S1/S2-knoppen hiernaast volgen die in plaats van de algemene.'
                                }
                            >
                                <CalendarRange size={13} /> eigen periode
                            </button>
                        )}

                        <div className={s.weekPicker} role="group" aria-label="Week">
                            {weken.map(w => (
                                <button
                                    key={w.id}
                                    type="button"
                                    className={`${tstyles.toolbarBtn} ${tstyles.periodeBtnCompact} ${
                                        w.weekMaandag === weekMaandag ? tstyles.semesterBtnActief : ''
                                    }`}
                                    onClick={() => setWeek(w.weekMaandag)}
                                    title={w.omschrijving}
                                    aria-pressed={w.weekMaandag === weekMaandag}
                                >
                                    {w.kort}
                                </button>
                            ))}
                            <span className={s.weekKeuzeScheiding} aria-hidden="true" />
                            <button
                                type="button"
                                className={tstyles.toolbarBtn}
                                onClick={() => setWeek(addDays(maandag, -7))}
                                title="Vorige week"
                                aria-label="Vorige week"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span className={s.weekLabel} title="De getoonde week (maandag t/m vrijdag)">
                                Week {weekNr} · {formatDateBE(maandag)} – {formatDateBE(vrijdag)}
                            </span>
                            <button
                                type="button"
                                className={tstyles.toolbarBtn}
                                onClick={() => setWeek(addDays(maandag, 7))}
                                title="Volgende week"
                                aria-label="Volgende week"
                            >
                                <ChevronRight size={14} />
                            </button>
                            <input
                                className={s.weekDatum}
                                type="date"
                                value={weekMaandag}
                                onChange={e => {
                                    if (e.target.value) setWeek(e.target.value);
                                }}
                                title="Kies een datum — de week van die datum wordt getoond"
                                aria-label="Datum in de gewenste week"
                            />
                            <button
                                type="button"
                                className={tstyles.toolbarBtn}
                                onClick={() => setWeek(new Date())}
                                disabled={weekMaandag === toIsoDate(mondayOf(new Date()))}
                                title="Spring naar de huidige week"
                            >
                                <CalendarDays size={14} /> Deze week
                            </button>
                        </div>

                        <div className={tstyles.topbarSpacer} />

                        <button
                            className={tstyles.toolbarBtn}
                            onClick={herlaad}
                            disabled={!exportMogelijk || busy}
                            title="Haal de roosters van deze week opnieuw op bij Untis"
                        >
                            <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} /> Vernieuwen
                        </button>
                        <TopbarMenu
                            label={
                                <>
                                    <Share2 size={14} /> Exporteren
                                </>
                            }
                            title="Afdrukken, als PNG bewaren of een link naar dit overzicht delen"
                            disabled={!exportMogelijk}
                        >
                            {close => (
                                <>
                                    <TopbarMenuItem
                                        icon={<Printer size={14} />}
                                        disabled={busy}
                                        title="Print het overzicht — één jaargroep per pagina (kies 'Opslaan als PDF' voor een PDF)"
                                        onClick={() => {
                                            close();
                                            handlePrint();
                                        }}
                                    >
                                        Print / PDF
                                    </TopbarMenuItem>
                                    <TopbarMenuItem
                                        icon={<Download size={14} />}
                                        disabled={busy || zichtbareRasters === 0}
                                        title="Download elk getoond raster als apart PNG-bestand"
                                        onClick={() => {
                                            close();
                                            handleAllePng();
                                        }}
                                    >
                                        Alle rasters als PNG downloaden
                                    </TopbarMenuItem>
                                    <TopbarMenuItem
                                        icon={<Link2 size={14} />}
                                        title="Kopieer een link die de opleiding, jaargroepen én deze week bevat"
                                        onClick={() => {
                                            close();
                                            handleLink();
                                        }}
                                    >
                                        Link naar dit overzicht kopiëren
                                    </TopbarMenuItem>
                                </>
                            )}
                        </TopbarMenu>
                    </div>

                    {tab === 'instellingen' ? (
                        <ExamenSettingsView
                            store={store}
                            opleiding={opleiding}
                            periode={periode}
                            onZetGrens={zetGrens}
                            onHerstelPeriode={herstelPeriode}
                            weekMaandag={weekMaandag}
                            onSetWeek={setWeek}
                            onKiesOpleiding={setOpleidingId}
                            initieleKaart={initieleKaart}
                            onDone={() => setTab('overzicht')}
                        />
                    ) : (
                        <div className={s.body} ref={bodyRef}>
                            <div className={s.bodyInner}>
                                {!opleiding ? (
                                    <div className={s.leeg}>
                                        <h2>Nog geen opleiding ingesteld</h2>
                                        <p>
                                            Stel eenmalig in welke opleidingen je beheert en welke klasgroepen
                                            erbij horen. Daarna kies je hier een opleiding en een week.
                                        </p>
                                        <button
                                            className={tstyles.settingsDoneBtn}
                                            onClick={() => naarInstellingen('opleidingen')}
                                        >
                                            <SettingsIcon size={16} /> Naar de instellingen
                                        </button>
                                    </div>
                                ) : opleiding.klasgroepen.length === 0 ? (
                                    <div className={s.leeg}>
                                        <h2>{opleiding.naam || 'Deze opleiding'} heeft nog geen klasgroepen</h2>
                                        <p>Kies in de instellingen welke klasgroepen bij deze opleiding horen.</p>
                                        <button
                                            className={tstyles.settingsDoneBtn}
                                            onClick={() => naarInstellingen('opleidingen')}
                                        >
                                            <SettingsIcon size={16} /> Klasgroepen kiezen
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className={s.statusRij} role="status">
                                            {busy ? (
                                                <span className={s.statusItem}>
                                                    <Loader2 className="animate-spin" size={14} /> Roosters ophalen…
                                                </span>
                                            ) : (
                                                <span className={s.statusItem}>
                                                    Opgehaald op{' '}
                                                    {opgehaaldOp ? formatDateTime(opgehaaldOp) : '—'}
                                                </span>
                                            )}
                                            <span className={s.statusItem}>
                                                {meervoud(opleiding.klasgroepen.length, 'klasgroep', 'klasgroepen')}
                                            </span>
                                            {!busy && (
                                                <span className={s.statusItem}>
                                                    {meervoud(totaalExamens, 'examen', 'examens')}
                                                </span>
                                            )}
                                            {!busy && blended && (
                                                <span className={s.statusItem}>
                                                    <Info size={14} />
                                                    Gedeeltelijke examenweek: {zonderExamens} van{' '}
                                                    {overzichten.length} jaargroepen zonder examens
                                                </span>
                                            )}
                                            {!busy && zonderRooster.length > 0 && (
                                                <span className={`${s.statusItem} ${s.statusFout}`}>
                                                    <AlertTriangle size={14} />
                                                    {meervoud(zonderRooster.length, 'klasgroep', 'klasgroepen')} zonder
                                                    rooster: {zonderRooster.join(', ')}
                                                </span>
                                            )}
                                            {!busy && geannuleerd > 0 && (
                                                <span className={`${s.statusItem} ${s.statusWaarschuwing}`}>
                                                    <AlertTriangle size={14} />
                                                    {meervoud(geannuleerd, 'geannuleerd blok', 'geannuleerde blokken')}
                                                </span>
                                            )}
                                        </div>

                                        {opleiding.jaargroepen.length === 0 && (
                                            <div className={tstyles.presetBanner}>
                                                <Info size={18} />
                                                <div className={tstyles.presetBannerText}>
                                                    <strong>Nog geen jaargroepen ingesteld.</strong> Elke klasgroep
                                                    krijgt een eigen raster. Laat in de instellingen een voorstel maken
                                                    op basis van deze week — klasgroepen met hetzelfde rooster delen
                                                    dan één raster.
                                                </div>
                                                <button
                                                    className={tstyles.toolbarBtn}
                                                    onClick={() => naarInstellingen('jaargroepen')}
                                                >
                                                    Jaargroepen instellen
                                                </button>
                                            </div>
                                        )}

                                        {overzichten.map((o, i) => (
                                            <JaargroepKaart
                                                key={o.jaargroep.id}
                                                overzicht={o}
                                                beoordeling={beoordelingen[i]}
                                                maandag={maandag}
                                                opleidingNaam={opleiding.naam}
                                                opgehaaldOp={opgehaaldOp}
                                                laden={busy || o.onbekend.length > 0}
                                                toonRaster={magTonen(i)}
                                                overruled={beoordelingen[i].soort !== 'examenweek' && magTonen(i)}
                                                blended={blended}
                                                onToonToch={() =>
                                                    setToonToch(prev =>
                                                        new Set(prev).add(`${o.jaargroep.id}|${weekMaandag}`)
                                                    )
                                                }
                                                onMeld={meld}
                                            />
                                        ))}

                                        {!busy && diagnose.totaal > 0 && (
                                            <details className={s.diagnose}>
                                                <summary>Diagnose van de ruwe Untis-velden (fase 0)</summary>
                                                <div className={s.diagnoseBody}>
                                                    <table className={s.diagnoseTabel}>
                                                        <tbody>
                                                            <tr>
                                                                <th>Blokken</th>
                                                                <td>{diagnose.totaal}</td>
                                                            </tr>
                                                            <tr>
                                                                <th>status</th>
                                                                <td>
                                                                    {diagnose.statussen
                                                                        .map(t => `${t.waarde} ×${t.aantal}`)
                                                                        .join(' · ')}
                                                                </td>
                                                            </tr>
                                                            <tr>
                                                                <th>type</th>
                                                                <td>
                                                                    {diagnose.types
                                                                        .map(t => `${t.waarde} ×${t.aantal}`)
                                                                        .join(' · ')}
                                                                </td>
                                                            </tr>
                                                            <tr>
                                                                <th>Met lokaal / docent</th>
                                                                <td>
                                                                    {diagnose.metLokaal} / {diagnose.metDocent}
                                                                </td>
                                                            </tr>
                                                            <tr>
                                                                <th>CLASS-posities met meer dan de eigen klasgroep</th>
                                                                <td>{diagnose.klassenMeerDanEigen}</td>
                                                            </tr>
                                                            <tr>
                                                                <th>Entry-id gedeeld / verschillend (samengevoegde examens)</th>
                                                                <td>
                                                                    {diagnose.idGedeeld} / {diagnose.idVerschilt}
                                                                </td>
                                                            </tr>
                                                            <tr>
                                                                <th>Overeenkomst per jaargroep</th>
                                                                <td>
                                                                    {overzichten
                                                                        .map((o, i) => {
                                                                            const pct = overeenkomstPct(beoordelingen[i]);
                                                                            return `${o.jaargroep.naam}: ${
                                                                                pct === null ? 'n.v.t.' : `${pct}%`
                                                                            } (${beoordelingen[i].soort})`;
                                                                        })
                                                                        .join(' · ')}
                                                                </td>
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                    <pre className={s.diagnoseCode}>
                                                        {diagnose.voorbeelden
                                                            .map(b =>
                                                                JSON.stringify({
                                                                    klasgroep: b.klasgroep,
                                                                    olod: b.olodNaam,
                                                                    start: b.start.toISOString(),
                                                                    eind: b.eind.toISOString(),
                                                                    ids: b.ids,
                                                                    klassen: b.klassen,
                                                                    lokaal: b.lokaal,
                                                                    docent: b.docent,
                                                                    status: b.status,
                                                                    type: b.untisType,
                                                                    info: b.type,
                                                                })
                                                            )
                                                            .join('\n')}
                                                    </pre>
                                                </div>
                                            </details>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {share && (
                <BevestigDialog
                    titel={`Opleiding "${share.opleiding.naam}" overnemen?`}
                    bericht={
                        <>
                            Deze link bevat de opleiding <strong>{share.opleiding.naam}</strong> met{' '}
                            {meervoud(share.opleiding.klasgroepen.length, 'klasgroep', 'klasgroepen')} en{' '}
                            {meervoud(share.opleiding.jaargroepen.length, 'jaargroep', 'jaargroepen')}
                            {share.weekMaandag
                                ? `, en opent week ${isoWeekNumber(parseIsoDate(share.weekMaandag))}`
                                : ''}
                            .{' '}
                            {bestaandeMetNaam
                                ? 'Je hebt al een opleiding met die naam; die wordt vervangen door de versie uit de link.'
                                : 'Ze wordt aan je eigen opleidingen toegevoegd.'}
                        </>
                    }
                    bevestigLabel={bestaandeMetNaam ? 'Vervangen' : 'Overnemen'}
                    danger={!!bestaandeMetNaam}
                    onBevestig={neemShareOver}
                    onAnnuleer={() => setShare(null)}
                />
            )}

            {melding && (
                <div className={s.melding} role="status">
                    {melding}
                </div>
            )}

            {/* Afdrukweergave: dezelfde rasters en meldingen, één raster per pagina. */}
            {opleiding && tab === 'overzicht' && !busy && (
                <div className={s.printRoot}>
                    {overzichten.map((o, i) => (
                        <div
                            key={o.jaargroep.id}
                            className={magTonen(i) ? s.printPagina : s.printNotitie}
                        >
                            {magTonen(i) ? (
                                <>
                                    {/* De titelband zit in de SVG zelf. */}
                                    <ExamenRaster
                                        overzicht={o}
                                        weekMaandag={maandag}
                                        opleidingNaam={opleiding.naam}
                                        opgehaaldOp={opgehaaldOp}
                                    />
                                    <AfwijkingenLijst overzicht={o} />
                                </>
                            ) : (
                                <>
                                    <div className={s.printKop}>
                                        {o.jaargroep.naam}
                                        {o.jaargroep.klasgroepen.length > 1 &&
                                            ` · ${o.jaargroep.klasgroepen.join(', ')}`}
                                    </div>
                                    <GeenRasterMelding
                                        overzicht={o}
                                        beoordeling={beoordelingen[i]}
                                        blended={blended}
                                    />
                                </>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
