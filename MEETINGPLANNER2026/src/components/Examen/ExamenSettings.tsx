import { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    CalendarRange,
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    GraduationCap,
    Info,
    Layers,
    Link2,
    Loader2,
    Plus,
    RotateCcw,
    Share2,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import { untisService } from '../../services/UntisService';
import { addDays, formatDateBE, isoWeekNumber, parseIsoDate } from '../Traject/dateUtils';
import { SettingsCard, Uitleg } from '../Traject/SettingsCard';
import type { CardSummary } from '../Traject/settingsSummaries';
import { BevestigDialog } from '../Traject/TrajectDialogs';
import { copyToClipboard } from '../Traject/trajectShare';
import tstyles from '../Traject/Traject.module.css';
import s from './Examen.module.css';
import { stelJaargroepenVoor, type ClusterVoorstel } from './cluster';
import { examenService, foutTekst } from './examenService';
import { buildExamenShareUrl } from './examenShare';
import { nietIngedeeld, type useOpleidingen } from './examenStore';
import { KlasgroepKiezer } from './KlasgroepKiezer';
import {
    effectievePeriode,
    effectieveSemesters,
    examenWeken,
    periodeGeldig,
    standaardPeriode,
    type ExamenPeriode,
    type ExamenWeek,
    type PeriodeVeld,
} from './periode';
import type { Jaargroep, KlasgroepResultaat, Opleiding } from './types';

export type ExamenKaart = 'opleidingen' | 'periode' | 'jaargroepen' | 'delen';
type Store = ReturnType<typeof useOpleidingen>;

interface Props {
    store: Store;
    /** De actieve opleiding (die in de topbar gekozen is), of null. */
    opleiding: Opleiding | null;
    /** De algemene semestergrenzen (voor alle opleidingen) en de handlers om ze te wijzigen. */
    periode: ExamenPeriode;
    onZetGrens: (veld: PeriodeVeld, iso: string) => void;
    onHerstelPeriode: () => void;
    /** De actieve week (maandag) — basis voor het clustervoorstel — en hoe ze te wijzigen. */
    weekMaandag: string;
    onSetWeek: (datum: Date | string) => void;
    onKiesOpleiding: (id: string) => void;
    /** Welke kaart open moet staan bij het openen van de instellingen. */
    initieleKaart?: ExamenKaart;
    onDone: () => void;
}

interface Voorstel {
    groepen: ClusterVoorstel[];
    mislukt: string[];
    weekMaandag: string;
}

type Dialoog = { soort: 'verwijderOpleiding' } | { soort: 'voorstelOvernemen' };

function meervoud(n: number, enkel: string, meer: string): string {
    return `${n} ${n === 1 ? enkel : meer}`;
}

const dag = (iso: string) => formatDateBE(parseIsoDate(iso));

export function ExamenSettingsView({
    store,
    opleiding,
    periode,
    onZetGrens,
    onHerstelPeriode,
    weekMaandag,
    onSetWeek,
    onKiesOpleiding,
    initieleKaart = 'opleidingen',
    onDone,
}: Props) {
    const { opleidingen } = store;
    // Bewust niet gepersisteerd — bij elke terugkeer opnieuw het overzicht.
    const [open, setOpen] = useState<Record<ExamenKaart, boolean>>({
        opleidingen: initieleKaart === 'opleidingen',
        periode: initieleKaart === 'periode',
        jaargroepen: initieleKaart === 'jaargroepen',
        delen: initieleKaart === 'delen',
    });
    const toggle = (id: ExamenKaart) => setOpen(o => ({ ...o, [id]: !o[id] }));

    const [nieuweNaam, setNieuweNaam] = useState('');
    const [dialoog, setDialoog] = useState<Dialoog | null>(null);
    const [voorstel, setVoorstel] = useState<Voorstel | null>(null);
    const [voorstelBusy, setVoorstelBusy] = useState(false);
    const [voorstelFout, setVoorstelFout] = useState<string | null>(null);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [shareCopied, setShareCopied] = useState(false);

    const actiefJaar = untisService.getActiveSchoolYearName();
    const maandag = useMemo(() => parseIsoDate(weekMaandag), [weekMaandag]);
    const weekLabel = `week ${isoWeekNumber(maandag)} (${formatDateBE(maandag)} – ${formatDateBE(addDays(maandag, 4))})`;

    // De algemene grenzen gelden voor alle opleidingen; een opleiding die haar
    // examens elders legt kan ze overrulen met eigen grenzen. Alles wat hier
    // afgeleid wordt (semesters, examenweken) betreft de actieve opleiding.
    const eigen = opleiding?.eigenPeriode;
    const effPeriode = useMemo(() => effectievePeriode(periode, eigen), [periode, eigen]);
    const weken = useMemo(() => examenWeken(effPeriode), [effPeriode]);
    const [sem1, sem2] = useMemo(() => effectieveSemesters(effPeriode), [effPeriode]);
    const algemeenGeldig = periodeGeldig(periode);
    const eigenGeldig = !eigen || periodeGeldig(eigen);
    const standaard = standaardPeriode();
    const metEigenPeriode = opleidingen.filter(o => o.eigenPeriode);
    const anderenMetEigen = metEigenPeriode.filter(o => o.id !== opleiding?.id);

    // Een voorstel hoort bij één opleiding; een deel-link is een momentopname
    // van de configuratie. Beide vervallen zodra er iets verandert.
    useEffect(() => {
        setVoorstel(null);
        setVoorstelFout(null);
    }, [opleiding?.id]);
    useEffect(() => {
        setShareUrl(null);
    }, [opleiding]);

    const los = opleiding ? nietIngedeeld(opleiding) : [];

    const samenvatting: Record<ExamenKaart, CardSummary> = {
        opleidingen:
            opleidingen.length === 0
                ? { text: 'Nog geen opleiding ingesteld', tone: 'warn' }
                : opleiding && opleiding.klasgroepen.length === 0
                  ? { text: `${opleiding.naam} · nog geen klasgroepen`, tone: 'warn' }
                  : {
                        text: `${meervoud(opleidingen.length, 'opleiding', 'opleidingen')} · ${
                            opleiding ? `${opleiding.naam}, ${meervoud(opleiding.klasgroepen.length, 'klasgroep', 'klasgroepen')}` : ''
                        }`,
                        tone: 'normal',
                    },
        periode: {
            text:
                `S1 ${dag(sem1.start)}–${dag(sem1.eind)} · S2 ${dag(sem2.start)}–${dag(sem2.eind)}` +
                ` · examenweken ${weken.map(w => w.weekNr).join(' en ')}` +
                (eigen
                    ? ` · eigen periode voor ${opleiding?.naam || 'deze opleiding'}`
                    : metEigenPeriode.length > 0
                      ? ` · ${meervoud(metEigenPeriode.length, 'opleiding', 'opleidingen')} met eigen periode`
                      : '') +
                (algemeenGeldig ? '' : ' · algemene grens ongeldig') +
                (eigenGeldig ? '' : ' · eigen grens ongeldig'),
            tone: algemeenGeldig && eigenGeldig ? 'normal' : 'warn',
        },
        jaargroepen: !opleiding
            ? { text: 'Kies eerst een opleiding', tone: 'warn' }
            : opleiding.klasgroepen.length === 0
              ? { text: 'Kies eerst klasgroepen', tone: 'warn' }
              : opleiding.jaargroepen.length === 0
                ? { text: 'Nog geen jaargroepen — elke klasgroep apart', tone: 'warn' }
                : {
                      text: `${meervoud(opleiding.jaargroepen.length, 'jaargroep', 'jaargroepen')}${
                          los.length > 0 ? ` · ${los.length} niet ingedeeld` : ''
                      }`,
                      tone: los.length > 0 ? 'warn' : 'normal',
                  },
        delen:
            !opleiding || opleiding.klasgroepen.length === 0
                ? { text: 'Stel eerst een opleiding met klasgroepen in', tone: 'warn' }
                : { text: `Link met de configuratie van ${opleiding.naam}`, tone: 'normal' },
    };

    const voegOpleidingToe = () => {
        const naam = nieuweNaam.trim();
        if (!naam) return;
        const id = store.voegToe(naam);
        onKiesOpleiding(id);
        setNieuweNaam('');
    };

    const maakVoorstel = async () => {
        if (!opleiding || opleiding.klasgroepen.length === 0) return;
        const klasgroepen = opleiding.klasgroepen;
        setVoorstelBusy(true);
        setVoorstelFout(null);
        try {
            const results = await Promise.allSettled(
                klasgroepen.map(k => examenService.getWeek(k, weekMaandag))
            );
            const perKlas: Record<string, KlasgroepResultaat> = {};
            const mislukt: string[] = [];
            results.forEach((r, i) => {
                const k = klasgroepen[i];
                if (r.status === 'fulfilled') perKlas[k] = { blokken: r.value.blokken };
                else {
                    perKlas[k] = { blokken: [], fout: foutTekst(r.reason) };
                    mislukt.push(k);
                }
            });
            if (mislukt.length === klasgroepen.length) {
                setVoorstelFout(`Geen enkel rooster kon opgehaald worden (${perKlas[klasgroepen[0]].fout}).`);
                return;
            }
            setVoorstel({ groepen: stelJaargroepenVoor(klasgroepen, perKlas), mislukt, weekMaandag });
        } catch (e) {
            setVoorstelFout(foutTekst(e));
        } finally {
            setVoorstelBusy(false);
        }
    };

    const neemVoorstelOver = () => {
        if (!opleiding || !voorstel) return;
        store.vervangJaargroepen(
            opleiding.id,
            voorstel.groepen.map(g => ({ naam: g.naam, klasgroepen: g.klasgroepen }))
        );
        setVoorstel(null);
        setDialoog(null);
    };

    const vraagOvername = () => {
        if (!opleiding) return;
        if (opleiding.jaargroepen.length > 0) setDialoog({ soort: 'voorstelOvernemen' });
        else neemVoorstelOver();
    };

    const flashCopied = () => {
        setShareCopied(true);
        window.setTimeout(() => setShareCopied(false), 1500);
    };

    const handleGenerateLink = async () => {
        if (!opleiding) return;
        const url = buildExamenShareUrl(opleiding);
        setShareUrl(url);
        if (await copyToClipboard(url)) flashCopied();
    };

    const handleCopyShare = async () => {
        if (shareUrl && (await copyToClipboard(shareUrl))) flashCopied();
    };

    const deelbaar = !!opleiding && opleiding.klasgroepen.length > 0;

    return (
        <div className={tstyles.settings}>
            <div className={tstyles.settingsTopBar}>
                <div className={tstyles.settingsTopBarInner}>
                    <button
                        className={tstyles.settingsDoneBtn}
                        onClick={onDone}
                        title="Sluit de instellingen en ga terug naar het overzicht"
                    >
                        <Check size={16} /> Klaar — naar het overzicht
                    </button>
                    <span className={tstyles.settingsPageTitle}>Instellingen</span>
                    {actiefJaar && (
                        <span
                            className={tstyles.academiejaarBadge}
                            title="Het academiejaar waarvan de klasgroepen en roosters geladen worden"
                        >
                            Academiejaar {actiefJaar}
                        </span>
                    )}
                </div>
            </div>

            <div className={tstyles.settingsInner}>
                <SettingsCard
                    id="examen-opleidingen"
                    icon={<GraduationCap size={18} />}
                    title="Mijn opleidingen"
                    summary={samenvatting.opleidingen}
                    open={open.opleidingen}
                    onToggle={() => toggle('opleidingen')}
                >
                    <div className={tstyles.settingsHint}>
                        Stel eenmalig in welke opleidingen je beheert en welke klasgroepen erbij horen.
                        Het overzicht toont altijd één opleiding tegelijk.
                    </div>

                    {opleidingen.length > 0 && (
                        <div className={s.opleidingChips} role="tablist" aria-label="Opleidingen">
                            {opleidingen.map(o => (
                                <button
                                    key={o.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={o.id === opleiding?.id}
                                    className={`${s.opleidingChip} ${o.id === opleiding?.id ? s.opleidingChipActief : ''}`}
                                    onClick={() => onKiesOpleiding(o.id)}
                                    title={`${o.naam} bewerken`}
                                >
                                    {o.naam || <em>naamloos</em>}
                                    <span className={s.opleidingChipMeta}>{o.klasgroepen.length}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className={s.nieuwRij}>
                        <input
                            className={s.tekstInput}
                            type="text"
                            placeholder="Naam van een nieuwe opleiding, bv. Toegepaste Informatica"
                            value={nieuweNaam}
                            onChange={e => setNieuweNaam(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    voegOpleidingToe();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className={tstyles.toolbarBtn}
                            onClick={voegOpleidingToe}
                            disabled={!nieuweNaam.trim()}
                        >
                            <Plus size={14} /> Opleiding toevoegen
                        </button>
                    </div>

                    {opleiding && (
                        <div className={s.opleidingPaneel}>
                            <div className={s.veldRij}>
                                <label className={s.veld}>
                                    <span>Naam van de opleiding</span>
                                    <input
                                        className={s.tekstInput}
                                        type="text"
                                        value={opleiding.naam}
                                        onChange={e => store.hernoem(opleiding.id, e.target.value)}
                                        placeholder="Naam"
                                    />
                                </label>
                                <button
                                    type="button"
                                    className={`${tstyles.toolbarBtn} ${tstyles.toolbarBtnDanger}`}
                                    onClick={() => setDialoog({ soort: 'verwijderOpleiding' })}
                                    title="Verwijder deze opleiding met haar klasgroepen en jaargroepen uit deze browser"
                                >
                                    <Trash2 size={14} /> Verwijder opleiding
                                </button>
                            </div>
                            <div className={tstyles.settingsSubtitle}>
                                Klasgroepen van {opleiding.naam || 'deze opleiding'}
                            </div>
                            <KlasgroepKiezer
                                geselecteerd={opleiding.klasgroepen}
                                onToggle={k => store.toggleKlasgroep(opleiding.id, k)}
                                onSet={ks => store.setKlasgroepen(opleiding.id, ks)}
                            />
                        </div>
                    )}

                    <Uitleg>
                        <p>
                            Een opleiding is hier gewoon een naam met een lijst klasgroepen uit Untis. Het
                            examenoverzicht haalt voor een gekozen week het rooster van elk van die
                            klasgroepen op en voegt ze samen tot zo weinig mogelijk rasters.
                        </p>
                        <p>
                            Alles wordt enkel in <em>deze browser</em> bewaard. Gebruik "Deel met collega's"
                            om de configuratie aan iemand anders door te geven.
                        </p>
                    </Uitleg>
                </SettingsCard>

                <SettingsCard
                    id="examen-periode"
                    icon={<CalendarRange size={18} />}
                    title="Academiejaar"
                    summary={samenvatting.periode}
                    open={open.periode}
                    onToggle={() => toggle('periode')}
                >
                    <div className={tstyles.settingsHint}>
                        De semestergrenzen bepalen de examenweken: de laatste volledige week vóór elk
                        semestereinde. Die weken staan als S1/S2-knoppen in de weekkiezer, en de
                        eerstvolgende is de week waarop het overzicht standaard opent. Ze gelden voor
                        <strong> al je opleidingen</strong> — enkel een opleiding die haar examens elders
                        legt, krijgt hieronder eigen grenzen.
                    </div>
                    <div className={tstyles.subtitleRow}>
                        <div className={tstyles.settingsSubtitle}>Algemene semestergrenzen</div>
                        <button
                            type="button"
                            className={tstyles.toolbarBtn}
                            onClick={onHerstelPeriode}
                            title={`Zet de grensdatums terug op die van academiejaar ${actiefJaar ?? ''}`.trim()}
                        >
                            <RotateCcw size={14} /> Standaarddatums
                        </button>
                    </div>
                    <div className={tstyles.dateRow}>
                        <div className={tstyles.dateField}>
                            <label>Semester 1 · start</label>
                            <input
                                type="date"
                                value={periode.s1Start}
                                onChange={e => onZetGrens('s1Start', e.target.value)}
                            />
                        </div>
                        <div className={tstyles.dateField}>
                            <label>Semester 1 · einde</label>
                            <input
                                type="date"
                                value={periode.s1Eind}
                                min={periode.s1Start || undefined}
                                onChange={e => onZetGrens('s1Eind', e.target.value)}
                            />
                        </div>
                        <div className={tstyles.dateField}>
                            <label>Semester 2 · start</label>
                            <input
                                type="date"
                                value={periode.s2Start}
                                onChange={e => onZetGrens('s2Start', e.target.value)}
                            />
                        </div>
                        <div className={tstyles.dateField}>
                            <label>Semester 2 · einde</label>
                            <input
                                type="date"
                                value={periode.s2Eind}
                                min={periode.s2Start || undefined}
                                onChange={e => onZetGrens('s2Eind', e.target.value)}
                            />
                        </div>
                    </div>
                    {!algemeenGeldig && (
                        <div className={tstyles.importMsgErr}>
                            Een semestergrens is leeg of loopt achteruit. Tot je dat corrigeert gelden de
                            standaarddatums (semester 1: {dag(standaard.s1Start)}–{dag(standaard.s1Eind)},
                            semester 2: {dag(standaard.s2Start)}–{dag(standaard.s2Eind)}).
                        </div>
                    )}
                    {anderenMetEigen.length > 0 && (
                        <div className={s.overruleNoot}>
                            <Info size={14} />
                            <span>
                                {anderenMetEigen.map(o => o.naam || 'naamloos').join(', ')}{' '}
                                {anderenMetEigen.length === 1 ? 'volgt' : 'volgen'} deze grenzen niet, maar
                                {anderenMetEigen.length === 1 ? ' haar' : ' hun'} eigen periode hieronder.
                            </span>
                        </div>
                    )}

                    <div className={tstyles.subtitleRow}>
                        <div className={tstyles.settingsSubtitle}>Afwijkende periode voor één opleiding</div>
                    </div>
                    {!opleiding ? (
                        <div className={tstyles.settingsHint}>
                            Kies of maak eerst een opleiding hierboven om er een eigen examenperiode aan te
                            geven.
                        </div>
                    ) : (
                        <>
                            <label className={s.overruleRij}>
                                <input
                                    type="checkbox"
                                    checked={Boolean(eigen)}
                                    onChange={e =>
                                        store.zetEigenPeriode(
                                            opleiding.id,
                                            // Aanzetten vertrekt van wat nu geldt: de eerste wijziging is
                                            // dan een aanpassing en geen herinvoer van vier datums.
                                            e.target.checked ? effPeriode : null
                                        )
                                    }
                                />
                                <span>
                                    <strong>{opleiding.naam || 'Deze opleiding'}</strong> heeft een eigen
                                    examenperiode
                                    <span className={s.overruleUitleg}>
                                        {eigen
                                            ? 'De algemene grenzen hierboven gelden niet voor deze opleiding.'
                                            : 'Uit: deze opleiding volgt de algemene grenzen hierboven, ook wanneer die later wijzigen.'}
                                    </span>
                                </span>
                            </label>
                            {eigen && (
                                <div className={s.overruleBlok}>
                                    <div className={tstyles.dateRow}>
                                        <div className={tstyles.dateField}>
                                            <label>Semester 1 · start</label>
                                            <input
                                                type="date"
                                                value={eigen.s1Start}
                                                onChange={e =>
                                                    store.zetEigenGrens(opleiding.id, 's1Start', e.target.value)
                                                }
                                            />
                                        </div>
                                        <div className={tstyles.dateField}>
                                            <label>Semester 1 · einde</label>
                                            <input
                                                type="date"
                                                value={eigen.s1Eind}
                                                min={eigen.s1Start || undefined}
                                                onChange={e =>
                                                    store.zetEigenGrens(opleiding.id, 's1Eind', e.target.value)
                                                }
                                            />
                                        </div>
                                        <div className={tstyles.dateField}>
                                            <label>Semester 2 · start</label>
                                            <input
                                                type="date"
                                                value={eigen.s2Start}
                                                onChange={e =>
                                                    store.zetEigenGrens(opleiding.id, 's2Start', e.target.value)
                                                }
                                            />
                                        </div>
                                        <div className={tstyles.dateField}>
                                            <label>Semester 2 · einde</label>
                                            <input
                                                type="date"
                                                value={eigen.s2Eind}
                                                min={eigen.s2Start || undefined}
                                                onChange={e =>
                                                    store.zetEigenGrens(opleiding.id, 's2Eind', e.target.value)
                                                }
                                            />
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className={tstyles.toolbarBtn}
                                        onClick={() => store.zetEigenPeriode(opleiding.id, periode)}
                                        title="Neem de algemene grenzen over als startpunt (de eigen periode blijft aan)"
                                    >
                                        <RotateCcw size={14} /> Algemene grenzen overnemen
                                    </button>
                                    {!eigenGeldig && (
                                        <div className={tstyles.importMsgErr}>
                                            Een eigen semestergrens is leeg of loopt achteruit. Tot je dat
                                            corrigeert gelden voor deze opleiding de algemene grenzen.
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    <div className={tstyles.subtitleRow}>
                        <div className={tstyles.settingsSubtitle}>
                            Examenweken{opleiding ? ` van ${opleiding.naam || 'deze opleiding'}` : ''}
                            {eigen && eigenGeldig ? ' — uit de eigen periode' : ''}
                        </div>
                    </div>
                    <div className={s.examenWekenStrip} aria-label="Examenweken">
                        {weken.map(w => (
                            <div key={w.id} className={s.examenWeekCel} title={w.omschrijving}>
                                <span className={s.examenWeekKort}>{w.label}</span>
                                <span className={s.examenWeekDatums}>
                                    week {w.weekNr} · {dag(w.weekMaandag)} – {formatDateBE(addDays(parseIsoDate(w.weekMaandag), 4))}
                                </span>
                            </div>
                        ))}
                    </div>
                    <Uitleg>
                        <p>
                            De algemene grenzen zijn dezelfde als in de Traject Planner. Had je die daar al
                            ingesteld, dan zijn ze hier de eerste keer overgenomen; daarna staan beide los
                            van elkaar.
                        </p>
                        <p>
                            Eén stel grenzen volstaat zolang je opleidingen in dezelfde weken examineren —
                            dan geef je ze maar één keer in. Wijkt er één af, zet dan enkel bij díé opleiding
                            de eigen periode aan; de andere blijven de algemene grenzen volgen, ook wanneer
                            je die later verschuift.
                        </p>
                        <p>
                            Valt de examenperiode niet in de laatste week van het semester, blader dan gewoon
                            een week terug of vooruit — de S1/S2-knoppen zijn een vertrekpunt, geen
                            beperking. De eigen periode is er voor een opleiding die er structureel naast
                            valt, niet voor een eenmalige uitzondering.
                        </p>
                    </Uitleg>
                </SettingsCard>

                <SettingsCard
                    id="examen-jaargroepen"
                    icon={<Layers size={18} />}
                    title="Jaargroepen"
                    summary={samenvatting.jaargroepen}
                    open={open.jaargroepen}
                    onToggle={() => toggle('jaargroepen')}
                >
                    {!opleiding ? (
                        <div className={tstyles.settingsHint}>Kies of maak eerst een opleiding hierboven.</div>
                    ) : opleiding.klasgroepen.length === 0 ? (
                        <div className={tstyles.settingsHint}>
                            Kies eerst de klasgroepen van {opleiding.naam || 'de opleiding'} hierboven.
                        </div>
                    ) : (
                        <>
                            <div className={tstyles.settingsHint}>
                                Klasgroepen met hetzelfde examenrooster delen één raster. Laat een voorstel
                                maken op basis van een examenweek, of stel de jaargroepen zelf samen. Een
                                klasgroep zit in hoogstens één jaargroep; niet-ingedeelde klasgroepen krijgen
                                elk een eigen raster.
                            </div>

                            <div className={tstyles.settingsSubtitle}>Week voor het voorstel</div>
                            <WeekKeuze weken={weken} weekMaandag={weekMaandag} onSetWeek={onSetWeek} />
                            <div className={tstyles.settingsHint}>
                                Neem een examenweek: in een gewone lesweek heeft elke klasgroep een eigen
                                rooster en valt er niets samen te voegen. De examenweken volgen uit de
                                semestergrenzen onder "Academiejaar".
                            </div>

                            <div className={tstyles.backupRow}>
                                <button
                                    type="button"
                                    className={`${tstyles.toolbarBtn} ${tstyles.dialoogKnopPrimair}`}
                                    onClick={maakVoorstel}
                                    disabled={voorstelBusy}
                                    title="Haalt de roosters van de gekozen week op en groepeert klasgroepen met hetzelfde rooster"
                                >
                                    {voorstelBusy ? (
                                        <Loader2 className="animate-spin" size={14} />
                                    ) : (
                                        <Sparkles size={14} />
                                    )}
                                    Voorstel op basis van {weekLabel}
                                </button>
                                <button
                                    type="button"
                                    className={tstyles.toolbarBtn}
                                    onClick={() =>
                                        store.voegJaargroepToe(
                                            opleiding.id,
                                            `Jaargroep ${opleiding.jaargroepen.length + 1}`
                                        )
                                    }
                                >
                                    <Plus size={14} /> Nieuwe jaargroep
                                </button>
                            </div>

                            {voorstelFout && <div className={tstyles.importMsgErr}>{voorstelFout}</div>}

                            {voorstel && (
                                <VoorstelPaneel
                                    voorstel={voorstel}
                                    onNaam={(i, naam) =>
                                        setVoorstel(v =>
                                            v
                                                ? {
                                                      ...v,
                                                      groepen: v.groepen.map((g, gi) =>
                                                          gi === i ? { ...g, naam } : g
                                                      ),
                                                  }
                                                : v
                                        )
                                    }
                                    onOvernemen={vraagOvername}
                                    onAnnuleer={() => setVoorstel(null)}
                                />
                            )}

                            {opleiding.jaargroepen.length === 0 && !voorstel && (
                                <div className={`${tstyles.cardNote} ${tstyles.cardNoteWarn}`}>
                                    <AlertTriangle size={16} />
                                    <span>
                                        Nog geen jaargroepen: elke klasgroep krijgt voorlopig een eigen raster.
                                    </span>
                                </div>
                            )}

                            {opleiding.jaargroepen.length > 0 && (
                                <div className={s.jaargroepLijst}>
                                    {opleiding.jaargroepen.map(j => (
                                        <JaargroepRij
                                            key={j.id}
                                            opleiding={opleiding}
                                            jaargroep={j}
                                            vrij={los}
                                            store={store}
                                        />
                                    ))}
                                </div>
                            )}

                            {los.length > 0 && opleiding.jaargroepen.length > 0 && (
                                <div className={s.losRij}>
                                    <strong>Niet ingedeeld:</strong> {los.join(', ')} — elk apart getoond.
                                </div>
                            )}

                            <Uitleg>
                                <p>
                                    Het voorstel bouwt per klasgroep een weeksignatuur (de set examens op
                                    tijdstip + vak) en groepeert klasgroepen met dezelfde signatuur. Groepen
                                    die sterk overlappen (≥ 80 %) worden samengevoegd, met de verschillen
                                    expliciet benoemd. Jij bevestigt of past aan; de indeling wordt bewaard
                                    en in volgende weken hergebruikt.
                                </p>
                                <p>
                                    Klopt een jaargroep in een latere week niet meer helemaal, dan blijft het
                                    raster staan en verschijnen de afwijkingen expliciet onder het raster — een
                                    document dat rondgemaild wordt moet van week tot week herkenbaar blijven.
                                </p>
                            </Uitleg>
                        </>
                    )}
                </SettingsCard>

                <SettingsCard
                    id="examen-delen"
                    icon={<Share2 size={18} />}
                    title="Deel met collega's"
                    summary={samenvatting.delen}
                    open={open.delen}
                    onToggle={() => toggle('delen')}
                >
                    <div className={tstyles.settingsHint}>
                        Geef een collega een link met de opleiding, haar klasgroepen en jaargroepen. De
                        collega kiest daarna zelf een week.
                    </div>
                    <div className={tstyles.backupRow}>
                        <button
                            type="button"
                            className={tstyles.toolbarBtn}
                            onClick={handleGenerateLink}
                            disabled={!deelbaar}
                            title={
                                deelbaar
                                    ? `Genereer en kopieer een link met de configuratie van ${opleiding?.naam}`
                                    : 'Stel eerst een opleiding met klasgroepen in'
                            }
                        >
                            <Link2 size={14} /> Genereer configuratie-link
                        </button>
                        {shareUrl && (
                            <button type="button" className={tstyles.toolbarBtn} onClick={handleCopyShare}>
                                {shareCopied ? <Check size={14} /> : <Copy size={14} />}
                                {shareCopied ? 'Gekopieerd!' : 'Kopieer link'}
                            </button>
                        )}
                    </div>
                    {shareUrl && (
                        <input
                            className={tstyles.shareUrlInput}
                            type="text"
                            readOnly
                            value={shareUrl}
                            onFocus={e => e.currentTarget.select()}
                        />
                    )}
                    <Uitleg>
                        <p>
                            De ontvanger krijgt eerst een bevestiging vóór de opleiding overgenomen wordt;
                            een link overschrijft nooit stilzwijgend iemands eigen opleidingen. Bestaat er
                            bij de collega al een opleiding met dezelfde naam, dan wordt die vervangen.
                        </p>
                        <p>
                            De link verspreidt een kopie, geen gedeelde waarheid: past iemand daarna zijn
                            indeling aan, dan merk jij daar niets van. Genereer na een wijziging een nieuwe
                            link. Via "Exporteren" in het overzicht kan je ook een link naar één concrete
                            week delen.
                        </p>
                    </Uitleg>
                </SettingsCard>
            </div>

            {dialoog?.soort === 'verwijderOpleiding' && opleiding && (
                <BevestigDialog
                    titel={`"${opleiding.naam || 'naamloos'}" verwijderen?`}
                    bericht={
                        <>
                            De opleiding met haar {meervoud(opleiding.klasgroepen.length, 'klasgroep', 'klasgroepen')}{' '}
                            en {meervoud(opleiding.jaargroepen.length, 'jaargroep', 'jaargroepen')} wordt uit deze
                            browser verwijderd. Dit kan niet ongedaan gemaakt worden.
                        </>
                    }
                    bevestigLabel="Verwijderen"
                    danger
                    onBevestig={() => {
                        store.verwijder(opleiding.id);
                        setDialoog(null);
                    }}
                    onAnnuleer={() => setDialoog(null)}
                />
            )}

            {dialoog?.soort === 'voorstelOvernemen' && opleiding && voorstel && (
                <BevestigDialog
                    titel="Jaargroepen vervangen?"
                    bericht={
                        <>
                            De huidige {meervoud(opleiding.jaargroepen.length, 'jaargroep', 'jaargroepen')} van{' '}
                            <strong>{opleiding.naam}</strong> worden vervangen door de{' '}
                            {meervoud(voorstel.groepen.length, 'jaargroep', 'jaargroepen')} uit het voorstel.
                        </>
                    }
                    bevestigLabel="Vervangen"
                    danger
                    onBevestig={neemVoorstelOver}
                    onAnnuleer={() => setDialoog(null)}
                />
            )}
        </div>
    );
}

interface WeekKeuzeProps {
    weken: ExamenWeek[];
    weekMaandag: string;
    onSetWeek: (datum: Date | string) => void;
}

/** Compacte weekkiezer: de examenweken S1/S2 als snelkeuze, plus vorige/volgende. */
function WeekKeuze({ weken, weekMaandag, onSetWeek }: WeekKeuzeProps) {
    const maandag = parseIsoDate(weekMaandag);
    return (
        <div className={s.weekKeuze} role="group" aria-label="Week voor het voorstel">
            {weken.map(w => (
                <button
                    key={w.id}
                    type="button"
                    className={`${tstyles.toolbarBtn} ${w.weekMaandag === weekMaandag ? tstyles.semesterBtnActief : ''}`}
                    onClick={() => onSetWeek(w.weekMaandag)}
                    title={w.omschrijving}
                    aria-pressed={w.weekMaandag === weekMaandag}
                >
                    {w.label}
                </button>
            ))}
            <span className={s.weekKeuzeScheiding} aria-hidden="true" />
            <button
                type="button"
                className={tstyles.toolbarBtn}
                onClick={() => onSetWeek(addDays(maandag, -7))}
                title="Vorige week"
                aria-label="Vorige week"
            >
                <ChevronLeft size={14} />
            </button>
            <span className={s.weekLabel}>
                Week {isoWeekNumber(maandag)} · {formatDateBE(maandag)} – {formatDateBE(addDays(maandag, 4))}
            </span>
            <button
                type="button"
                className={tstyles.toolbarBtn}
                onClick={() => onSetWeek(addDays(maandag, 7))}
                title="Volgende week"
                aria-label="Volgende week"
            >
                <ChevronRight size={14} />
            </button>
        </div>
    );
}

interface RijProps {
    opleiding: Opleiding;
    jaargroep: Jaargroep;
    /** Klasgroepen van de opleiding die in geen enkele jaargroep zitten. */
    vrij: string[];
    store: Store;
}

function JaargroepRij({ opleiding, jaargroep, vrij, store }: RijProps) {
    const [open, setOpen] = useState(false);
    const [gekozen, setGekozen] = useState<Set<string>>(() => new Set());

    // Een klasgroep die intussen elders ingedeeld raakte, valt uit de keuze.
    const vrijSleutel = vrij.join('|');
    useEffect(() => {
        setGekozen(g => {
            const next = new Set(Array.from(g).filter(k => vrij.includes(k)));
            return next.size === g.size ? g : next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vrijSleutel]);

    const toggleGekozen = (k: string) =>
        setGekozen(g => {
            const next = new Set(g);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });

    const alleGekozen = vrij.length > 0 && vrij.every(k => gekozen.has(k));

    const voegToe = () => {
        if (gekozen.size === 0) return;
        store.verplaatsKlasgroepen(opleiding.id, Array.from(gekozen), jaargroep.id);
        setGekozen(new Set());
        setOpen(false);
    };

    const sluit = () => {
        setOpen(false);
        setGekozen(new Set());
    };

    return (
        <div className={s.jaargroepRij}>
            <input
                className={`${s.tekstInput} ${s.jaargroepNaam}`}
                type="text"
                value={jaargroep.naam}
                onChange={e => store.hernoemJaargroep(opleiding.id, jaargroep.id, e.target.value)}
                placeholder="Naam van de jaargroep, bv. 2 TI"
                aria-label="Naam van de jaargroep"
            />
            <div className={s.jaargroepChips}>
                {jaargroep.klasgroepen.map(k => (
                    <span key={k} className={tstyles.klasChip}>
                        {k}
                        <button
                            type="button"
                            className={tstyles.klasChipRemove}
                            onClick={() => store.verplaatsKlasgroep(opleiding.id, k, null)}
                            title={`${k} uit deze jaargroep halen (blijft in de opleiding)`}
                            aria-label={`${k} uit de jaargroep halen`}
                        >
                            <X size={12} />
                        </button>
                    </span>
                ))}
                {jaargroep.klasgroepen.length === 0 && (
                    <span className={s.jaargroepLeeg}>nog geen klasgroepen</span>
                )}
                <button
                    type="button"
                    className={`${s.toevoegKnop} ${open ? s.toevoegKnopActief : ''}`}
                    onClick={() => (open ? sluit() : setOpen(true))}
                    disabled={vrij.length === 0}
                    title={
                        vrij.length === 0
                            ? 'Alle klasgroepen van de opleiding zijn al ingedeeld'
                            : 'Niet-ingedeelde klasgroepen aan deze jaargroep toevoegen'
                    }
                    aria-expanded={open}
                >
                    <Plus size={12} /> klasgroepen toevoegen
                </button>
            </div>
            <button
                type="button"
                className={tstyles.klasSelectedClear}
                onClick={() => store.verwijderJaargroep(opleiding.id, jaargroep.id)}
                title="Jaargroep verwijderen — de klasgroepen blijven in de opleiding en worden apart getoond"
                aria-label="Jaargroep verwijderen"
            >
                <Trash2 size={13} />
            </button>

            {open && vrij.length > 0 && (
                <div className={s.toevoegPaneel}>
                    <div className={s.toevoegKop}>
                        <span>Niet-ingedeelde klasgroepen — vink aan wat bij {jaargroep.naam || 'deze jaargroep'} hoort</span>
                        <button
                            type="button"
                            className={tstyles.klasSelectedClear}
                            onClick={() => setGekozen(alleGekozen ? new Set() : new Set(vrij))}
                        >
                            {alleGekozen ? 'Selecteer geen' : 'Selecteer alle'}
                        </button>
                    </div>
                    <div className={s.toevoegChips}>
                        {vrij.map(k => {
                            const aan = gekozen.has(k);
                            return (
                                <label key={k} className={`${s.toevoegChip} ${aan ? s.toevoegChipActief : ''}`}>
                                    <input type="checkbox" checked={aan} onChange={() => toggleGekozen(k)} />
                                    {k}
                                </label>
                            );
                        })}
                    </div>
                    <div className={tstyles.backupRow}>
                        <button
                            type="button"
                            className={`${tstyles.toolbarBtn} ${tstyles.dialoogKnopPrimair}`}
                            onClick={voegToe}
                            disabled={gekozen.size === 0}
                        >
                            <Plus size={14} />
                            {gekozen.size === 0
                                ? 'Toevoegen'
                                : `Voeg ${meervoud(gekozen.size, 'klasgroep', 'klasgroepen')} toe`}
                        </button>
                        <button type="button" className={tstyles.toolbarBtn} onClick={sluit}>
                            Annuleren
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

interface VoorstelProps {
    voorstel: Voorstel;
    onNaam: (index: number, naam: string) => void;
    onOvernemen: () => void;
    onAnnuleer: () => void;
}

function VoorstelPaneel({ voorstel, onNaam, onOvernemen, onAnnuleer }: VoorstelProps) {
    const maandag = parseIsoDate(voorstel.weekMaandag);
    return (
        <div className={s.voorstel}>
            <div className={s.voorstelKop}>
                <Sparkles size={14} />
                Voorstel op basis van week {isoWeekNumber(maandag)}:{' '}
                {meervoud(voorstel.groepen.length, 'jaargroep', 'jaargroepen')}
            </div>
            {voorstel.mislukt.length > 0 && (
                <div className={tstyles.importMsgErr}>
                    Niet meegenomen (rooster niet opgehaald): {voorstel.mislukt.join(', ')}
                </div>
            )}
            {voorstel.groepen.map((g, i) => (
                <div key={i} className={s.voorstelGroep}>
                    <input
                        className={`${s.tekstInput} ${s.jaargroepNaam}`}
                        type="text"
                        value={g.naam}
                        onChange={e => onNaam(i, e.target.value)}
                        aria-label="Naam van de voorgestelde jaargroep"
                    />
                    <div className={s.voorstelKlassen}>
                        {g.klasgroepen.map(k => (
                            <span key={k} className={tstyles.klasChip}>
                                {k}
                            </span>
                        ))}
                    </div>
                    {g.leeg && (
                        <div className={s.voorstelVerschil}>
                            <AlertTriangle size={12} /> Geen enkel blok in deze week — is dit wel een
                            examenweek voor deze klasgroepen?
                        </div>
                    )}
                    {g.verschillen.map(v => (
                        <div key={v} className={s.voorstelVerschil}>
                            <AlertTriangle size={12} /> {v}
                        </div>
                    ))}
                </div>
            ))}
            <div className={tstyles.backupRow}>
                <button
                    type="button"
                    className={`${tstyles.toolbarBtn} ${tstyles.dialoogKnopPrimair}`}
                    onClick={onOvernemen}
                >
                    <Check size={14} /> Overnemen als jaargroepen
                </button>
                <button type="button" className={tstyles.toolbarBtn} onClick={onAnnuleer}>
                    Annuleren
                </button>
            </div>
        </div>
    );
}
