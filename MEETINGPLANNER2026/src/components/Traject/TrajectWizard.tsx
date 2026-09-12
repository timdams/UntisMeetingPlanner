import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    ArrowRight,
    Check,
    ClipboardList,
    Link2,
    Loader2,
    Sparkles,
    Wand2,
    X,
} from 'lucide-react';
import type { Lesblok, StudentTraject } from './types';
import { isActief } from './types';
import {
    actievePeriode,
    allePeriodes,
    matchtPeriode,
    periodesVoor,
    type Periode,
    type PeriodeGrenzen,
    type PeriodeType,
} from './academicYear';
import { addDays, bereikRaakt, formatDateBE, fridayEndOf, parseIsoDate } from './dateUtils';
import { jaarVanKlasgroep } from './settingsSummaries';
import { usePeriodeRoosters } from './useTrajectBlokken';
import {
    lesweken,
    mediaanLessen,
    standaardWeken,
    vakkenUitRoosters,
    zoekVoorstel,
    type Lesweek,
    type VakInRoosters,
    type Voorkeur,
    type Voorstel,
} from './trajectVoorstel';
import {
    bouwPuzzel,
    groepVoorOlod,
    koppelingActief,
    nietGeplaatst,
    vasteKlasgroepen,
    type KoppelInstellingen,
    type OnmogelijkeGroep,
} from './koppelGroepen';
import {
    aantalGeregeld,
    bewaarProgramma,
    laadProgramma,
    leesProgramma,
    treffers,
} from './programma';
import { KoppelGroepenDialoog } from './KoppelGroepenDialoog';
import { PlakProgrammaDialoog, ProgrammaPaneel } from './ProgrammaPaneel';
import { PeriodeSwitcher } from './PeriodeSwitcher';
import styles from './Traject.module.css';

// Meer dan drie ijkweken maakt het voorstel niet beter, wel trager: een rooster
// dat in drie weken niet stabiel is, is dat in vijf ook niet.
const MAX_WEKEN = 3;

interface Props {
    // De shortlist: alleen deze klasgroepen doen mee aan de puzzel.
    klasgroepen: string[];
    // De periode waarvoor de wizard een rooster zoekt.
    actiefBereik: { van: string; tot: string };
    periodeGrenzen: PeriodeGrenzen;
    periodeType: PeriodeType;
    traject: StudentTraject;
    // Vakken die samen bij één klasgroep horen (een lab). Wordt hier ingesteld
    // — het is een eigenschap van de opleiding — maar hoort bij de instellingen,
    // zodat ze meereist met profiel, back-up en link. Zie koppelGroepen.ts.
    koppelGroepen: KoppelInstellingen;
    onKoppelGroepen: (inst: KoppelInstellingen) => void;
    // De periode waarvoor een keuze van dít vak geldt (semestervak = zijn hele
    // semester) — enkel om ze in het resultaat te benoemen.
    bereikVoorOlod: (olodNaam: string) => { van: string; tot: string };
    // De voorgestelde keuzes overnemen in het traject. Overnemen sluit de
    // wizard nooit: een traject bestaat uit alle periodes samen, dus na het
    // overnemen vraagt ze eerst of de rest van het jaar ook nog gelegd wordt.
    // Enkel {@link Props.onClose} sluit ze.
    onOvernemen: (keuzes: { olodNaam: string; klasgroep: string }[]) => void;
    // Van periode wisselen zonder de wizard te verlaten. Zet de actieve periode
    // van het hele werkblad om — dezelfde schakelaar als in de contextbalk.
    onKiesPeriode: (p: Periode) => void;
    onClose: () => void;
}

interface JaarBlok {
    label: string;
    vakken: VakInRoosters[];
}

/** De vakken gegroepeerd per leerjaar van de klasgroepen die ze geven. */
function jaarBlokken(vakken: VakInRoosters[]): JaarBlok[] {
    const perJaar = new Map<string, VakInRoosters[]>();
    for (const vak of vakken) {
        // Een vaknaam hangt niet aan één jaar: geeft zowel 1 TI als 2 TI dit
        // vak, dan hoort het in beide blokken thuis. Het blijft hetzelfde vak,
        // dus aanvinken in het ene blok vinkt het ook in het andere aan.
        const jaren = new Set(vak.klasgroepen.map(k => jaarVanKlasgroep(k) ?? '~'));
        for (const jaar of jaren) {
            const lijst = perJaar.get(jaar);
            if (lijst) lijst.push(vak);
            else perJaar.set(jaar, [vak]);
        }
    }
    return Array.from(perJaar.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([jaar, lijst]) => ({
            label: jaar === '~' ? 'Overige' : `${jaar}e jaar`,
            vakken: lijst,
        }));
}

/**
 * De wizard: de gebruiker duidt aan welke vakken de student moet volgen, en de
 * tool zoekt daar een combinatie van klasgroepen bij.
 *
 * Er wordt gepuzzeld op **referentieweken** in plaats van op het volledige
 * semester. Een rooster herhaalt zich meestal week na week (soms in een
 * even/oneven ritme), terwijl de eerste en de laatste lesweek vaak atypisch
 * zijn en er verspreid eenmalige lessen staan. Zonder die keuze zou elke
 * losse extra les als een onoplosbare botsing tellen. De gebruiker kiest zelf
 * 1 tot {@link MAX_WEKEN} weken; het voorstel start op de twee opeenvolgende
 * lesweken uit het midden van de periode die het dichtst bij een doorsneeweek
 * liggen.
 */
export function TrajectWizard({
    klasgroepen,
    actiefBereik,
    periodeGrenzen,
    periodeType,
    traject,
    koppelGroepen,
    onKoppelGroepen,
    bereikVoorOlod,
    onOvernemen,
    onKiesPeriode,
    onClose,
}: Props) {
    const { perKlas, klaar, totaal, mislukt } = usePeriodeRoosters(klasgroepen, actiefBereik);
    const laadt = klaar < totaal;

    const [weekKeuze, setWeekKeuze] = useState<number[]>([]);
    const [gekozenVakken, setGekozenVakken] = useState<Set<string>>(new Set());
    const [voorkeur, setVoorkeur] = useState<Voorkeur>('conflictvrij');
    const [voorstel, setVoorstel] = useState<Voorstel | null>(null);
    const [bezig, setBezig] = useState(false);
    const [koppelOpen, setKoppelOpen] = useState(false);
    // Het geplakte programma van de student: zie programma.ts. Het overleeft
    // het sluiten van de wizard (sessieopslag), want wie het hele jaar periode
    // per periode legt, doet dat niet in één keer.
    const [programma, setProgramma] = useState<string[]>(laadProgramma);
    const [plakOpen, setPlakOpen] = useState(false);
    // De periode waar de gebruiker heen wil terwijl er nog een onbenut
    // voorstel op tafel ligt; null zolang er niets te vragen valt.
    const [wisselVraag, setWisselVraag] = useState<Periode | null>(null);
    // Staat aan van zodra een voorstel overgenomen is: dan vraagt de voet of de
    // andere periodes ook nog gelegd worden. Een traject is het hele jaar, en
    // wie één module legt en de wizard ziet dichtvallen, opent ze vier keer.
    const [verderVraag, setVerderVraag] = useState(false);

    useEffect(() => {
        // Staat het geavanceerde venster open, dan sluit Esc enkel dát venster
        // (die dialoog luistert zelf mee) en niet de hele wizard eronder.
        // Dezelfde regel voor de vraag bij een periodewissel: eerst die weg,
        // pas daarna de wizard.
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (koppelOpen || plakOpen) return;
            if (wisselVraag) setWisselVraag(null);
            else if (verderVraag) setVerderVraag(false);
            else onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, koppelOpen, plakOpen, wisselVraag, verderVraag]);

    useEffect(() => bewaarProgramma(programma), [programma]);

    // De periodes waar de knoppen in de kop tussen wisselen: dezelfde reeks
    // als de contextbalk van het werkblad (S1/S2 of M1…M4).
    const periodes = useMemo(
        () => periodesVoor(periodeType, periodeGrenzen),
        [periodeType, periodeGrenzen]
    );

    // Eénmalig klaarzetten per periode; zie de twee effecten hieronder.
    const klaargezet = useRef(false);

    // Wisselt de gebruiker van periode zonder de wizard te verlaten, dan
    // begint de puzzel van nul: andere lesweken, andere vakken, een ander
    // stuk traject. Enkel de **voorkeur** blijft staan — die hoort bij de
    // student en niet bij de periode, en wie het hele jaar na elkaar
    // wizardt wil ze niet vier keer opnieuw aanduiden.
    //
    // Dit effect staat bewust vóór het klaarzet-effect: effecten lopen in
    // volgorde van declaratie, dus binnen dezelfde commit is `klaargezet`
    // alweer vrijgegeven tegen de tijd dat het klaarzetten aan de beurt is.
    // Anders zou een periode waarvan de roosters al in de cache zitten met
    // een lege weekkeuze achterblijven.
    const bereikKey = `${actiefBereik.van}|${actiefBereik.tot}`;
    const vorigeKey = useRef(bereikKey);
    useEffect(() => {
        if (vorigeKey.current === bereikKey) return;
        vorigeKey.current = bereikKey;
        klaargezet.current = false;
        setWeekKeuze([]);
        setGekozenVakken(new Set());
        setVoorstel(null);
        setWisselVraag(null);
        setVerderVraag(false);
    }, [bereikKey]);

    const vakken = useMemo(() => vakkenUitRoosters(perKlas), [perKlas]);
    const weken = useMemo<Lesweek[]>(() => lesweken(perKlas), [perKlas]);
    // Het aantal lessen in een doorsneeweek — ijkpunt voor de tooltip per week.
    const normaleWeek = useMemo(() => mediaanLessen(weken), [weken]);
    const blokken = useMemo(() => jaarBlokken(vakken), [vakken]);

    // Wat er nu al in het traject staat voor deze periode: per vak de klasgroep.
    // Voedt zowel de beginselectie als het behoud van vakken die de puzzel niet
    // kan plaatsen.
    const huidig = useMemo(() => {
        const map = new Map<string, string>();
        for (const sel of traject) {
            if (!isActief(sel)) continue;
            if (!bereikRaakt(sel.van, sel.tot, actiefBereik.van, actiefBereik.tot)) continue;
            if (!map.has(sel.olodNaam)) map.set(sel.olodNaam, sel.klasgroep);
        }
        return map;
    }, [traject, actiefBereik]);

    // Eénmalig per periode klaarzetten zodra de roosters binnen zijn: de weken
    // uit standaardWeken en de vakken die al in het traject staan. Daarna is
    // het van de gebruiker — latere renders mogen zijn keuzes niet
    // overschrijven, tot de periode wisselt (zie het effect hierboven).
    useEffect(() => {
        if (klaargezet.current || laadt || vakken.length === 0) return;
        klaargezet.current = true;
        setWeekKeuze(standaardWeken(weken).map(d => d.getTime()));
        const namen = vakken.map(v => v.olodNaam).filter(n => huidig.has(n));
        if (namen.length > 0) setGekozenVakken(new Set(namen));
    }, [laadt, vakken, weken, huidig]);

    // ----- Het geplakte programma (zie programma.ts) -----

    // Alles wat al in het traject staat, ongeacht de periode: een vak dat in M1
    // gekozen werd, is voor de lijst behandeld en hoeft in M2 niet opnieuw op te
    // lichten.
    const trajectNamen = useMemo(
        () => Array.from(new Set(traject.filter(isActief).map(s => s.olodNaam))),
        [traject]
    );
    const periodeVakken = useMemo(() => vakken.map(v => v.olodNaam), [vakken]);
    const programmaRegels = useMemo(
        () => leesProgramma(programma, periodeVakken, trajectNamen),
        [programma, periodeVakken, trajectNamen]
    );
    const programmaTreffers = useMemo(() => treffers(programmaRegels), [programmaRegels]);

    // De treffers aanduiden zodra de roosters van deze periode binnen zijn, en
    // opnieuw na elke periodewissel of nieuwe lijst — dat is de hele belofte van
    // de knop. Eén keer per (periode, lijst): daarna is het aan de gebruiker, en
    // een vak dat hij zelf uitvinkt mag niet bij de volgende render terugkomen.
    //
    // Dit effect staat bewust ná het klaarzet-effect hierboven: dat vervangt de
    // selectie door wat er al in het traject staat, terwijl dit erbij zet.
    const programmaStempel = useRef('');
    useEffect(() => {
        if (laadt || vakken.length === 0) return;
        const stempel = `${bereikKey}|${JSON.stringify(programma)}`;
        if (programmaStempel.current === stempel) return;
        programmaStempel.current = stempel;
        if (programmaTreffers.length === 0) return;
        setVoorstel(null);
        setGekozenVakken(s => {
            const next = new Set(s);
            for (const naam of programmaTreffers) next.add(naam);
            return next;
        });
    }, [laadt, vakken, bereikKey, programma, programmaTreffers]);

    // Elke wijziging aan de invoer maakt een bestaand voorstel oud nieuws — en
    // daarmee ook de vraag die na het overnemen van dát voorstel openstond.
    const wijzig = (actie: () => void) => {
        setVoorstel(null);
        setVerderVraag(false);
        actie();
    };

    const toggleWeek = (ma: number) => {
        wijzig(() =>
            setWeekKeuze(w => {
                if (w.includes(ma)) return w.filter(x => x !== ma);
                if (w.length >= MAX_WEKEN) return w;
                return [...w, ma].sort((a, b) => a - b);
            })
        );
    };

    const toggleVak = (naam: string) => {
        wijzig(() =>
            setGekozenVakken(s => {
                const next = new Set(s);
                if (next.has(naam)) next.delete(naam);
                else next.add(naam);
                return next;
            })
        );
    };

    const zetBlok = (blok: JaarBlok, aan: boolean) => {
        wijzig(() =>
            setGekozenVakken(s => {
                const next = new Set(s);
                blok.vakken.forEach(v => (aan ? next.add(v.olodNaam) : next.delete(v.olodNaam)));
                return next;
            })
        );
    };

    // De referentieweken als tijdvensters, om lessen tegen af te toetsen.
    const vensters = useMemo(
        () => weekKeuze.map(ma => ({ van: ma, tot: fridayEndOf(new Date(ma)).getTime() })),
        [weekKeuze]
    );
    const inWeken = (b: Lesblok) => {
        const t = b.start.getTime();
        return vensters.some(v => t >= v.van && t <= v.tot);
    };

    // Waar een groep elders in het jaar al vastligt — enkel met de instelling
    // "ook in de andere periodes dezelfde klasgroep".
    const elders = useMemo(
        () => vasteKlasgroepen(traject, koppelGroepen, actiefBereik),
        [traject, koppelGroepen, actiefBereik]
    );

    // De puzzel zoals ze aan de solver gegeven wordt: per gekozen vak de
    // klasgroepen die het in de referentieweken effectief geven, en per groep
    // vakken die samen horen één gezamenlijke keuze. Zie koppelGroepen.ts.
    const puzzel = useMemo(
        () => bouwPuzzel(vakken, gekozenVakken, inWeken, koppelGroepen, elders.vast),
        [vakken, gekozenVakken, vensters, koppelGroepen, elders]
    );

    const doeVoorstel = () => {
        setBezig(true);
        setVoorstel(null);
        // Even door de eventlus, zodat de knop eerst zijn "rekenen…"-stand
        // schildert; de zoektocht zelf is synchroon (en hooguit een seconde).
        window.setTimeout(() => {
            setVoorstel(zoekVoorstel(puzzel.mee, voorkeur, Math.max(1, weekKeuze.length)));
            setBezig(false);
        }, 20);
    };

    // Vakken die de puzzel niet kon plaatsen maar die al in het traject staan,
    // houden hun huidige klasgroep: het voorstel overnemen mag geen keuze
    // opeten die de wizard zelf niet kan maken. Naast vakken zonder les in de
    // ijkweken gaat het om de leden van een groep die niet in één klasgroep past.
    const behouden = useMemo(
        () =>
            nietGeplaatst(puzzel)
                .filter(naam => huidig.has(naam))
                .map(naam => ({ olodNaam: naam, klasgroep: huidig.get(naam) as string })),
        [puzzel, huidig]
    );

    // Een keuze voor een groep vult al haar leden in: het traject kent geen
    // groepen, enkel vakken.
    const alsKeuzes = (v: Voorstel) =>
        v.keuzes.flatMap(k =>
            (k.leden ?? [k.olodNaam]).map(olodNaam => ({ olodNaam, klasgroep: k.klasgroep }))
        );

    // Het voorstel in het traject zetten. Dit sluit de wizard niet: dat doet
    // enkel de knop "Nee, sluiten" in de vraag die erop volgt.
    const neemOver = () => {
        if (!voorstel) return;
        onOvernemen([...alsKeuzes(voorstel), ...behouden]);
    };

    // De knop in de voet: overnemen, en dan vragen of de rest van het jaar ook
    // nog aan de beurt komt.
    const neemOverEnVraag = () => {
        if (!voorstel) return;
        neemOver();
        setVerderVraag(true);
    };

    // Een klik op een periodeknop in de kop. Ligt er nog een voorstel dat niet
    // overgenomen is, dan wordt eerst gevraagd wat ermee moet: een wissel
    // herstart de puzzel, en een berekend voorstel mag niet in stilte
    // verdwijnen. Zo gaat de begeleider met één venster het hele jaar af —
    // M1 overnemen, door naar M2 — in plaats van de wizard vier keer te openen.
    const kiesPeriode = (p: Periode) => {
        if (matchtPeriode(p, actiefBereik.van, actiefBereik.tot)) return;
        // Na een overnemen is het voorstel verbruikt: er valt niets meer te
        // redden, dus de schakelaar in de kop wisselt gewoon meteen.
        if (verderVraag) {
            setVerderVraag(false);
            onKiesPeriode(p);
        } else if (voorstel) setWisselVraag(p);
        else onKiesPeriode(p);
    };

    const wisselNa = (overnemen: boolean) => {
        const p = wisselVraag;
        if (!p) return;
        setWisselVraag(null);
        if (overnemen) neemOver();
        onKiesPeriode(p);
    };

    // De periodes die nu niet aan de beurt zijn, met wat er al voor in het
    // traject staat: zo wijst de vraag na het overnemen aan waar nog niets ligt.
    const anderePeriodes = useMemo(
        () =>
            periodes
                .filter(p => !matchtPeriode(p, actiefBereik.van, actiefBereik.tot))
                .map(p => ({
                    periode: p,
                    aantal: traject.filter(
                        s => isActief(s) && bereikRaakt(s.van, s.tot, p.start, p.eind)
                    ).length,
                })),
        [periodes, actiefBereik, traject]
    );

    // De eerstvolgende periode is de natuurlijke voortzetting en krijgt daarom
    // de opgelichte knop. Staat de wizard in de laatste periode, dan is er geen
    // — de andere knoppen blijven dan gelijkwaardig.
    const volgendePeriode = useMemo(() => {
        const i = periodes.findIndex(p => matchtPeriode(p, actiefBereik.van, actiefBereik.tot));
        return i >= 0 ? (periodes[i + 1] ?? null) : null;
    }, [periodes, actiefBereik]);

    const verderIn = (p: Periode) => {
        setVerderVraag(false);
        onKiesPeriode(p);
    };

    // Enkel de datums: welke periode het is, staat naast de titel al als
    // opgelichte knop in de periode-schakelaar.
    const periodeLabel = useMemo(
        () =>
            `${formatDateBE(parseIsoDate(actiefBereik.van))} – ${formatDateBE(
                parseIsoDate(actiefBereik.tot)
            )}`,
        [actiefBereik]
    );

    // De naam van de actieve periode, voor de zinnen die erover gaan. Een
    // handmatig ingesteld bereik past op geen enkele periode en heet dan
    // gewoon "deze periode".
    const periodeNaam = useMemo(() => {
        const p = actievePeriode(allePeriodes(periodeGrenzen), actiefBereik.van, actiefBereik.tot);
        return p ? p.label : 'deze periode';
    }, [actiefBereik, periodeGrenzen]);

    // Een vak waarvan de keuze verder reikt dan de actieve periode (een
    // semestervak in modulemodus) krijgt in het resultaat zijn eigen badge.
    const periodeBadge = (olodNaam: string): string | null => {
        const b = bereikVoorOlod(olodNaam);
        if (b.van === actiefBereik.van && b.tot === actiefBereik.tot) return null;
        const p = actievePeriode(allePeriodes(periodeGrenzen), b.van, b.tot);
        return p ? p.kort : null;
    };

    // Hoeveel bestaande keuzes het overnemen vervangt. Zelfde regel als in
    // TrajectPlanner: alles wat de periode raakt gaat eruit, behalve een
    // gedeactiveerde keuze die het voorstel niet invult — die blijft geparkeerd.
    const teVervangen = useMemo(() => {
        const ingevuld = new Set(
            (voorstel?.keuzes ?? []).flatMap(k => k.leden ?? [k.olodNaam])
        );
        return traject.filter(
            s =>
                bereikRaakt(s.van, s.tot, actiefBereik.van, actiefBereik.tot) &&
                (isActief(s) || ingevuld.has(s.olodNaam))
        ).length;
    }, [traject, actiefBereik, voorstel]);

    const kanRekenen = !laadt && weekKeuze.length > 0 && puzzel.mee.length > 0;

    // Wie geeft hoeveel van de aangevinkte leden — en welk vak ontbreekt daar
    // dan. Dat laatste maakt het verschil tussen "mijn shortlist is te smal" en
    // "dit vak bestaat daar niet".
    const dekkingTekst = (g: OnmogelijkeGroep) =>
        g.dekking
            .slice(0, 3)
            .map(d => {
                const mist = g.olods.filter(o => !d.olods.includes(o));
                return (
                    `${d.klasgroep}: ${d.olods.length} van de ${g.olods.length}` +
                    (mist.length > 0 ? ` (mist ${mist.join(', ')})` : '')
                );
            })
            .join(' · ');

    // Bewust geen onClick op de achtergrond: dit is een formulier met een
    // berekend resultaat, en een misklik ernaast mag dat niet weggooien.
    // Sluiten gaat met Esc of met de X.
    return createPortal(
        <div className={styles.zoomBackdrop}>
            <div
                className={`${styles.wizDialog} ${
                    programma.length > 0 ? styles.wizDialogBreed : ''
                }`}
                role="dialog"
                aria-modal="true"
                aria-label="Wizard: stel een rooster voor"
            >
                <div className={styles.zoomHeaderBar}>
                    <Wand2 size={16} />
                    <span className={styles.zoomTitle}>Stel een rooster voor</span>
                    <span className={styles.zoomSubtitle}>{periodeLabel}</span>
                    <div className={styles.zoomSpacer} />
                    {/* Dezelfde schakelaar als in de contextbalk van het
                        werkblad, zodat het hele jaar in één zitting gepuzzeld
                        kan worden. Ze zet de actieve periode van het werkblad
                        om: sluit de wizard, dan staat het werkblad in de
                        periode waar je laatst aan werkte. */}
                    <span className={styles.wizPeriodeLabel}>Periode</span>
                    <PeriodeSwitcher
                        compact
                        periodes={periodes}
                        actieveStart={actiefBereik.van}
                        actieveEind={actiefBereik.tot}
                        onKies={kiesPeriode}
                    />
                    <button
                        type="button"
                        className={styles.zoomClose}
                        onClick={onClose}
                        title="Sluiten (Esc)"
                        aria-label="Sluiten"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* De wissel wacht op een antwoord: overnemen is de reden dat
                    de knoppen er staan, dus die staat vooraan. */}
                {wisselVraag && (
                    <div className={styles.koppelVraag} role="alertdialog" aria-live="polite">
                        <span className={styles.koppelVraagTekst}>
                            Je voorstel voor <strong>{periodeNaam}</strong> is nog niet
                            overgenomen. Overnemen vóór je naar{' '}
                            <strong>{wisselVraag.label}</strong> gaat?
                        </span>
                        <button
                            type="button"
                            className={styles.koppelVraagJa}
                            onClick={() => wisselNa(true)}
                            title={`Zet dit voorstel in het traject en puzzel verder in ${wisselVraag.label}`}
                        >
                            <Check size={13} /> Overnemen en wisselen
                        </button>
                        <button
                            type="button"
                            className={styles.koppelVraagNee}
                            onClick={() => wisselNa(false)}
                            title="Het voorstel vervalt; het traject blijft zoals het was"
                        >
                            <ArrowRight size={13} /> Wisselen zonder overnemen
                        </button>
                        <button
                            type="button"
                            className={styles.koppelVraagNee}
                            onClick={() => setWisselVraag(null)}
                        >
                            Annuleren
                        </button>
                    </div>
                )}

                <div className={styles.wizMain}>
                    <div className={styles.wizBody}>
                        {/* ① Referentieweken */}
                        <section className={styles.wizSectie}>
                            <div className={styles.wizSectieKop}>
                                <span className={styles.wizStap}>1</span>
                                Referentieweken
                                <span className={styles.wizSectieHint}>
                                    de weken waarop de puzzel gelegd wordt — maximaal {MAX_WEKEN}
                                </span>
                            </div>
                            {laadt ? (
                                <div className={styles.kiesEmpty}>
                                    <Loader2 size={14} className="animate-spin" /> Roosters laden… (
                                    {klaar}/{totaal})
                                </div>
                            ) : weken.length === 0 ? (
                                <div className={styles.kiesEmpty}>
                                    Geen enkele klasgroep uit je shortlist geeft les in deze periode.
                                </div>
                            ) : (
                                <>
                                    <div className={styles.wizWeken}>
                                        {weken.map((w, i) => {
                                            const ma = w.maandag.getTime();
                                            const aan = weekKeuze.includes(ma);
                                            const vol = !aan && weekKeuze.length >= MAX_WEKEN;
                                            const rand = i === 0 || i === weken.length - 1;
                                            return (
                                                <button
                                                    key={ma}
                                                    type="button"
                                                    className={`${styles.wizWeekChip} ${
                                                        aan ? styles.wizWeekChipAan : ''
                                                    } ${rand ? styles.wizWeekChipRand : ''}`}
                                                    onClick={() => toggleWeek(ma)}
                                                    disabled={vol}
                                                    aria-pressed={aan}
                                                    title={
                                                        `Week ${formatDateBE(w.maandag)} – ${formatDateBE(
                                                            addDays(w.maandag, 4)
                                                        )}\n` +
                                                        (rand
                                                            ? `${
                                                                  i === 0 ? 'Eerste' : 'Laatste'
                                                              } lesweek van de periode — vaak atypisch.\n`
                                                            : '') +
                                                        `${w.lessen} lessen bij je klasgroepen deze week` +
                                                        (w.lessen > normaleWeek
                                                            ? `\nMeer dan een doorsneeweek (${normaleWeek}) — mogelijk inhaallessen.`
                                                            : w.lessen < normaleWeek
                                                              ? `\nMinder dan een doorsneeweek (${normaleWeek}) — mogelijk een feestdag.`
                                                              : '') +
                                                        (vol
                                                            ? `\nEr zijn al ${MAX_WEKEN} weken gekozen.`
                                                            : '')
                                                    }
                                                >
                                                    {formatDateBE(w.maandag)}
                                                    <span className={styles.wizWeekAantal}>{w.lessen}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className={styles.wizVoetnoot}>
                                        Een rooster herhaalt zich meestal week na week; losse eenmalige
                                        lessen mogen een voorstel niet doen mislukken. Twee
                                        opeenvolgende weken vangen ook een even/oneven ritme. De eerste
                                        en laatste lesweek staan er wel bij, maar zijn vaak atypisch —
                                        ze worden niet vanzelf gekozen.
                                    </div>
                                </>
                            )}
                        </section>

                        {/* ② Vakken */}
                        <section className={styles.wizSectie}>
                            <div className={styles.wizSectieKop}>
                                <span className={styles.wizStap}>2</span>
                                Vakken
                                <span className={styles.wizSectieHint}>
                                    {gekozenVakken.size} aangeduid
                                </span>
                                {/* Het programma van de student in één keer
                                    aanduiden in plaats van vak per vak. Zie
                                    programma.ts. */}
                                <button
                                    type="button"
                                    className={styles.wizKopActie}
                                    onClick={() => setPlakOpen(true)}
                                    title={
                                        'Plak de OLODs van de student, één per regel. De wizard duidt ' +
                                        'aan wat in deze periode lesgegeven wordt en houdt de rest bij.'
                                    }
                                >
                                    <ClipboardList size={12} />
                                    Plak programma
                                    <span className={styles.wizKopActieStand}>
                                        {programma.length === 0
                                            ? 'leeg'
                                            : `${aantalGeregeld(programmaRegels)}/${programma.length}`}
                                    </span>
                                </button>
                                {/* Achter een knopje: de meeste opleidingen hebben
                                    niets te koppelen en hoeven dit nooit te zien. */}
                                <button
                                    type="button"
                                    className={`${styles.wizKopActie} ${styles.wizKopActieNaast}`}
                                    onClick={() => setKoppelOpen(true)}
                                    title="Duid aan welke vakken samen bij één klasgroep horen (een lab)"
                                >
                                    <Link2 size={12} />
                                    Vakken die samen horen
                                    <span className={styles.wizKopActieStand}>
                                        {koppelingActief(koppelGroepen)
                                            ? `${koppelGroepen.groepen.length} ${
                                                  koppelGroepen.groepen.length === 1
                                                      ? 'groep'
                                                      : 'groepen'
                                              }`
                                            : 'uit'}
                                    </span>
                                </button>
                            </div>
                            {!laadt && blokken.length === 0 ? (
                                <div className={styles.kiesEmpty}>Niets te kiezen in deze periode.</div>
                            ) : (
                                <div className={styles.wizBlokken}>
                                    {blokken.map(blok => (
                                        <div key={blok.label} className={styles.wizBlok}>
                                            <div className={styles.wizBlokKop}>
                                                <span className={styles.wizBlokLabel}>{blok.label}</span>
                                                <button
                                                    type="button"
                                                    className={styles.wizBlokActie}
                                                    onClick={() => zetBlok(blok, true)}
                                                >
                                                    alles
                                                </button>
                                                <button
                                                    type="button"
                                                    className={styles.wizBlokActie}
                                                    onClick={() => zetBlok(blok, false)}
                                                >
                                                    geen
                                                </button>
                                            </div>
                                            <div className={styles.wizChips}>
                                                {blok.vakken.map(vak => {
                                                    const aan = gekozenVakken.has(vak.olodNaam);
                                                    const heeftLes = vak.blokken.some(inWeken);
                                                    const groep = groepVoorOlod(
                                                        vak.olodNaam,
                                                        koppelGroepen
                                                    );
                                                    return (
                                                        <button
                                                            key={vak.olodNaam}
                                                            type="button"
                                                            className={`${styles.wizChip} ${
                                                                aan ? styles.wizChipAan : ''
                                                            } ${heeftLes ? '' : styles.wizChipLeeg}`}
                                                            onClick={() => toggleVak(vak.olodNaam)}
                                                            aria-pressed={aan}
                                                            title={
                                                                `${vak.klasgroepen.join(', ')}` +
                                                                (heeftLes
                                                                    ? ''
                                                                    : '\nGeen les in de gekozen referentieweken.') +
                                                                (groep
                                                                    ? `\nHoort bij ${groep.naam}: die vakken komen samen in één klasgroep.`
                                                                    : '')
                                                            }
                                                        >
                                                            {aan && <Check size={11} strokeWidth={3} />}
                                                            {vak.olodNaam}
                                                            {groep && (
                                                                <span
                                                                    className={styles.wizChipGroep}
                                                                    title={`Groep ${groep.naam}`}
                                                                >
                                                                    <Link2 size={10} />
                                                                    {groep.naam}
                                                                </span>
                                                            )}
                                                            <span className={styles.wizChipAantal}>
                                                                {vak.klasgroepen.length}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* ③ Voorkeur + resultaat */}
                        <section className={styles.wizSectie}>
                            <div className={styles.wizSectieKop}>
                                <span className={styles.wizStap}>3</span>
                                Voorstel
                            </div>
                            <div className={styles.wizVoorkeurRij}>
                                <div className={styles.wizVoorkeur} role="radiogroup" aria-label="Voorkeur">
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={voorkeur === 'conflictvrij'}
                                        className={`${styles.wizVoorkeurKnop} ${
                                            voorkeur === 'conflictvrij' ? styles.wizVoorkeurKnopAan : ''
                                        }`}
                                        onClick={() => wijzig(() => setVoorkeur('conflictvrij'))}
                                        title="Een botsing weegt altijd zwaarder dan een extra lesdag: er wordt alleen gebotst als het niet anders kan."
                                    >
                                        Zo weinig mogelijk botsingen
                                    </button>
                                    <button
                                        type="button"
                                        role="radio"
                                        aria-checked={voorkeur === 'compact'}
                                        className={`${styles.wizVoorkeurKnop} ${
                                            voorkeur === 'compact' ? styles.wizVoorkeurKnopAan : ''
                                        }`}
                                        onClick={() => wijzig(() => setVoorkeur('compact'))}
                                        title="Een lesdag minder mag één botsing per week kosten (twee niet). Handig voor wie werkt of pendelt."
                                    >
                                        Zo weinig mogelijk lesdagen
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    className={styles.wizRekenKnop}
                                    onClick={doeVoorstel}
                                    disabled={!kanRekenen || bezig}
                                    title={
                                        laadt
                                            ? 'De roosters worden nog opgehaald'
                                            : weekKeuze.length === 0
                                              ? 'Kies eerst minstens één referentieweek'
                                              : puzzel.mee.length === 0
                                                ? 'Duid eerst vakken aan die in de referentieweken lesgeven'
                                                : `Zoek een combinatie van klasgroepen voor ${puzzel.mee.reduce(
                                                      (n, v) => n + (v.leden?.length ?? 1),
                                                      0
                                                  )} vakken`
                                    }
                                >
                                    {bezig ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" /> Rekenen…
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={14} /> Doe voorstel
                                        </>
                                    )}
                                </button>
                            </div>

                            {puzzel.zonderLes.length > 0 && (
                                <div className={styles.wizWaarschuwing}>
                                    <AlertTriangle size={13} />
                                    <span>
                                        <strong>{puzzel.zonderLes.join(', ')}</strong> heeft geen les in
                                        de gekozen referentieweken en zit niet in de puzzel.
                                        {behouden.length > 0
                                            ? ' De keuze die er nu voor in het traject staat, blijft staan.'
                                            : ' Kies er een andere week bij als dat vak toch mee moet.'}
                                    </span>
                                </div>
                            )}

                            {/* Een groep die niet in één klasgroep past, wordt niet
                                geplaatst — liever geen antwoord dan een stil
                                gesplitst lab. */}
                            {puzzel.onmogelijk.map(g => (
                                <div key={g.naam} className={styles.wizWaarschuwing}>
                                    <AlertTriangle size={13} />
                                    <span>
                                        <strong>{g.naam}</strong>{' '}
                                        {g.reden === 'geen-les' ? (
                                            <>
                                                heeft geen les in de gekozen referentieweken en zit niet
                                                in de puzzel.
                                            </>
                                        ) : g.reden === 'vast-elders' ? (
                                            <>
                                                ligt in een andere periode bij <strong>{g.vast}</strong>{' '}
                                                vast, maar daar zitten niet alle aangevinkte vakken van
                                                de groep. Zet het vinkje “ook in de andere periodes
                                                dezelfde klasgroep” uit, of pas die andere periode aan.
                                            </>
                                        ) : (
                                            <>
                                                past niet in één klasgroep: geen enkele klasgroep uit je
                                                shortlist geeft alle {g.olods.length} aangevinkte
                                                vakken. {dekkingTekst(g)}
                                            </>
                                        )}{' '}
                                        De groep zit niet in de puzzel; wat er nu voor in het traject
                                        staat, blijft staan.
                                    </span>
                                </div>
                            ))}

                            {elders.verdeeld.length > 0 && (
                                <div className={styles.wizWaarschuwing}>
                                    <AlertTriangle size={13} />
                                    <span>
                                        {elders.verdeeld
                                            .map(v => `${v.naam} (${v.klasgroepen.join(', ')})`)
                                            .join(', ')}{' '}
                                        staat in andere periodes zelf al bij meerdere klasgroepen. Daar
                                        valt niets af te dwingen: de wizard kiest hier vrij.
                                    </span>
                                </div>
                            )}

                            {voorstel && (
                                <div className={styles.wizResultaat}>
                                    <div className={styles.wizSamenvatting}>
                                        <span
                                            className={
                                                voorstel.conflicten === 0
                                                    ? styles.wizScoreGoed
                                                    : styles.wizScoreSlecht
                                            }
                                        >
                                            {voorstel.conflicten === 0 ? (
                                                <>
                                                    <Check size={13} strokeWidth={3} /> geen botsingen
                                                </>
                                            ) : (
                                                <>
                                                    <AlertTriangle size={13} /> {voorstel.conflicten}{' '}
                                                    botsende {voorstel.conflicten === 1 ? 'les' : 'lessen'}
                                                </>
                                            )}
                                        </span>
                                        <span>
                                            {voorstel.dagen} {voorstel.dagen === 1 ? 'lesdag' : 'lesdagen'}
                                        </span>
                                        <span>{voorstel.tussenuren} tussenuren per week</span>
                                        <span>
                                            {new Set(voorstel.keuzes.map(k => k.klasgroep)).size}{' '}
                                            klasgroepen
                                        </span>
                                    </div>

                                    <div className={styles.wizRijen}>
                                        {voorstel.keuzes.map(k => {
                                            // Een groep vult meerdere vakken in; het
                                            // "was" ernaast is dan alles waar die
                                            // vakken nu verspreid staan.
                                            const leden = k.leden ?? [k.olodNaam];
                                            const badge = periodeBadge(leden[0]);
                                            const anders = Array.from(
                                                new Set(
                                                    leden
                                                        .map(l => huidig.get(l))
                                                        .filter(
                                                            (x): x is string =>
                                                                !!x && x !== k.klasgroep
                                                        )
                                                )
                                            );
                                            return (
                                                <div key={k.olodNaam} className={styles.wizRij}>
                                                    <span className={styles.wizRijVak}>
                                                        {k.leden && (
                                                            <Link2
                                                                size={11}
                                                                className={styles.wizRijGroepIcoon}
                                                            />
                                                        )}
                                                        {k.olodNaam}
                                                    </span>
                                                    {badge && (
                                                        <span className={styles.wizRijBadge}>{badge}</span>
                                                    )}
                                                    <span className={styles.wizRijKlas}>{k.klasgroep}</span>
                                                    {anders.length > 0 && (
                                                        <span className={styles.wizRijWas}>
                                                            was {anders.join(', ')}
                                                        </span>
                                                    )}
                                                    {k.botsendeLessen > 0 && (
                                                        <span className={styles.wizRijBotst}>
                                                            <AlertTriangle size={12} />
                                                            {k.botsendeLessen} botsende{' '}
                                                            {k.botsendeLessen === 1 ? 'les' : 'lessen'}
                                                        </span>
                                                    )}
                                                    {k.leden && (
                                                        <span className={styles.wizRijLeden}>
                                                            {k.leden.join(' · ')}
                                                        </span>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {voorstel.afgekapt && (
                                        <div className={styles.wizVoetnoot}>
                                            De zoektocht is afgekapt bij haar tijdslimiet: dit is het
                                            beste voorstel dat gevonden werd, niet noodzakelijk het
                                            allerbeste. Duid minder vakken tegelijk aan voor een
                                            volledige zoektocht.
                                        </div>
                                    )}
                                </div>
                            )}
                        </section>
                    </div>

                    {/* De checklist van het geplakte programma. Enkel zichtbaar
                        wanneer er een lijst is: wie er geen gebruikt, hoort er
                        niets van te merken. */}
                    {programma.length > 0 && (
                        <ProgrammaPaneel
                            regels={programmaRegels}
                            gekozen={gekozenVakken}
                            periodeNaam={periodeNaam}
                            onBewerk={() => setPlakOpen(true)}
                            onWis={() => setProgramma([])}
                        />
                    )}
                </div>

                <div className={styles.wizVoet}>
                    {mislukt.length > 0 && (
                        <span
                            className={styles.zoekVoetFout}
                            title={`Niet meegenomen: ${mislukt.join(', ')}`}
                        >
                            <AlertTriangle size={12} /> {mislukt.length}{' '}
                            {mislukt.length === 1 ? 'klasgroep' : 'klasgroepen'} zonder rooster
                        </span>
                    )}
                    {/* Na het overnemen neemt de vraag de voet over: sluiten is
                        vanaf hier een bewuste keuze en niet het gevolg van de
                        knop die je net indrukte. */}
                    {verderVraag ? (
                        <>
                            <span className={styles.wizVoetHint} role="status">
                                Overgenomen in <strong>{periodeNaam}</strong>. Een traject loopt
                                over het hele jaar — nog een periode leggen?
                            </span>
                            {anderePeriodes.map(({ periode, aantal }) => (
                                <button
                                    key={periode.label}
                                    type="button"
                                    className={
                                        periode.label === volgendePeriode?.label
                                            ? styles.koppelVraagJa
                                            : styles.wizVerderKnop
                                    }
                                    onClick={() => verderIn(periode)}
                                    title={
                                        `Puzzel verder in ${periode.label}.\n` +
                                        (aantal === 0
                                            ? 'Daar staat nog niets in het traject.'
                                            : `Daar ${aantal === 1 ? 'staat' : 'staan'} nu ${aantal} ${
                                                  aantal === 1 ? 'vak' : 'vakken'
                                              } in het traject; overnemen vervangt die.`)
                                    }
                                >
                                    <ArrowRight size={13} /> Verder in {periode.kort}
                                    {aantal === 0 && (
                                        <span className={styles.wizVerderLeeg}>leeg</span>
                                    )}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={styles.wizVerderKnop}
                                onClick={onClose}
                                title="De wizard sluiten. Je traject blijft staan zoals het nu is."
                            >
                                Nee, sluiten
                            </button>
                        </>
                    ) : (
                        <>
                            <span className={styles.wizVoetHint}>
                                {voorstel
                                    ? teVervangen > 0
                                        ? `Overnemen vervangt de ${teVervangen} ${
                                              teVervangen === 1 ? 'keuze' : 'keuzes'
                                          } die nu in ${periodeNaam} staan (met ongedaan maken).`
                                        : 'Overnemen zet deze keuzes in het traject.'
                                    : 'Enkel de keuzes van deze periode worden vervangen; wissel hierboven van periode om het jaar stuk voor stuk te leggen.'}
                            </span>
                            <button
                                type="button"
                                className={styles.wizOverneemKnop}
                                onClick={neemOverEnVraag}
                                disabled={!voorstel}
                            >
                                <Check size={14} /> Overnemen in traject
                            </button>
                        </>
                    )}
                </div>
            </div>

            {koppelOpen && (
                <KoppelGroepenDialoog
                    inst={koppelGroepen}
                    onChange={inst => {
                        // Andere groepen, ander voorstel: het bestaande
                        // resultaat is meteen oud nieuws.
                        setVoorstel(null);
                        onKoppelGroepen(inst);
                    }}
                    klasgroepen={klasgroepen}
                    periodeType={periodeType}
                    periodeGrenzen={periodeGrenzen}
                    actiefBereik={actiefBereik}
                    onClose={() => setKoppelOpen(false)}
                />
            )}

            {plakOpen && (
                <PlakProgrammaDialoog
                    huidig={programma}
                    onKlaar={lijst => {
                        setProgramma(lijst);
                        setPlakOpen(false);
                    }}
                    onClose={() => setPlakOpen(false)}
                />
            )}
        </div>,
        document.body
    );
}
