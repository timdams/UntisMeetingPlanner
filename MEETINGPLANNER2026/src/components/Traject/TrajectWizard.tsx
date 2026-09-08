import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Link2, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import type { Lesblok, StudentTraject } from './types';
import { isActief } from './types';
import {
    actievePeriode,
    allePeriodes,
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
import { KoppelGroepenDialoog } from './KoppelGroepenDialoog';
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
    // De voorgestelde keuzes overnemen in het traject.
    onOvernemen: (keuzes: { olodNaam: string; klasgroep: string }[]) => void;
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

    useEffect(() => {
        // Staat het geavanceerde venster open, dan sluit Esc enkel dát venster
        // (die dialoog luistert zelf mee) en niet de hele wizard eronder.
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !koppelOpen) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, koppelOpen]);

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

    // Eénmalig klaarzetten zodra de roosters binnen zijn: de weken uit
    // standaardWeken en de vakken die al in het traject staan. Daarna is het
    // van de gebruiker — latere renders mogen zijn keuzes niet overschrijven.
    const klaargezet = useRef(false);
    useEffect(() => {
        if (klaargezet.current || laadt || vakken.length === 0) return;
        klaargezet.current = true;
        setWeekKeuze(standaardWeken(weken).map(d => d.getTime()));
        const namen = vakken.map(v => v.olodNaam).filter(n => huidig.has(n));
        if (namen.length > 0) setGekozenVakken(new Set(namen));
    }, [laadt, vakken, weken, huidig]);

    // Elke wijziging aan de invoer maakt een bestaand voorstel oud nieuws.
    const wijzig = (actie: () => void) => {
        setVoorstel(null);
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

    const neemOver = () => {
        if (!voorstel) return;
        onOvernemen([...alsKeuzes(voorstel), ...behouden]);
    };

    const periodeLabel = useMemo(() => {
        const datums = `${formatDateBE(parseIsoDate(actiefBereik.van))} – ${formatDateBE(
            parseIsoDate(actiefBereik.tot)
        )}`;
        const p = actievePeriode(allePeriodes(periodeGrenzen), actiefBereik.van, actiefBereik.tot);
        return p ? `${p.kort} · ${datums}` : datums;
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
                className={styles.wizDialog}
                role="dialog"
                aria-modal="true"
                aria-label="Wizard: stel een rooster voor"
            >
                <div className={styles.zoomHeaderBar}>
                    <Wand2 size={16} />
                    <span className={styles.zoomTitle}>Stel een rooster voor</span>
                    <span className={styles.zoomSubtitle}>{periodeLabel}</span>
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
                            {/* Achter een knopje: de meeste opleidingen hebben
                                niets te koppelen en hoeven dit nooit te zien. */}
                            <button
                                type="button"
                                className={styles.wizKopActie}
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
                    <span className={styles.wizVoetHint}>
                        {voorstel
                            ? teVervangen > 0
                                ? `Overnemen vervangt de ${teVervangen} ${
                                      teVervangen === 1 ? 'keuze' : 'keuzes'
                                  } die nu in deze periode staan (met ongedaan maken).`
                                : 'Overnemen zet deze keuzes in het traject.'
                            : 'De keuzes in andere periodes blijven altijd staan.'}
                    </span>
                    <button
                        type="button"
                        className={styles.wizOverneemKnop}
                        onClick={neemOver}
                        disabled={!voorstel}
                    >
                        <Check size={14} /> Overnemen in traject
                    </button>
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
        </div>,
        document.body
    );
}
