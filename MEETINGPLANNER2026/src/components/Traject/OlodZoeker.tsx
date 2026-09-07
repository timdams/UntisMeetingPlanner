import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, ChevronRight, Loader2, Search, X } from 'lucide-react';
import type { Lesblok, OLODSelectie, StudentTraject } from './types';
import { isActief } from './types';
import { actievePeriode, allePeriodes, type PeriodeGrenzen } from './academicYear';
import { effectieveBlokken, overlapt } from './conflicts';
import {
    bereikOverlapt,
    formatDateBE,
    fridayEndOf,
    mondayOf,
    parseIsoDate,
    periodeBereik,
} from './dateUtils';
import { usePeriodeRoosters } from './useTrajectBlokken';
import { vakkenUitRoosters, type VakInRoosters } from './trajectVoorstel';
import { OlodKlasgroepDialoog, type KiezerKandidaat } from './OlodKlasgroepDialoog';
import styles from './Traject.module.css';

interface Props {
    // De shortlist: enkel deze klasgroepen worden doorzocht, net als overal
    // elders in het werkblad.
    klasgroepen: string[];
    // De actieve periode — het bereik dat doorzocht wordt.
    actiefBereik: { van: string; tot: string };
    periodeGrenzen: PeriodeGrenzen;
    traject: StudentTraject;
    // Jaarrooster van de klasgroepen in het traject: nodig om te zien of een
    // kandidaat in die week met de rest van het traject zou botsen.
    blokkenPerKlas: Record<string, Lesblok[]>;
    // De periode waarin een keuze van dít vak zou vallen (een semestervak
    // krijgt zijn hele semester) — enkel om ze in de kiezer te benoemen.
    bereikVoorOlod: (olodNaam: string) => { van: string; tot: string };
    // De selectie die een klik zou weghalen, of null. Zelfde functie als in
    // paneel B, dus met hetzelfde bereik per vak.
    selectieVoor: (klasgroep: string, olodNaam: string, datum: Date) => OLODSelectie | null;
    colorOf: (olodNaam: string) => string;
    ensureColor: (olodNaam: string) => void;
    // Zet dit lesblok in (of uit) het traject — dezelfde toggle als een klik in
    // het klasgroeprooster.
    onToggleBlok: (blok: Lesblok) => void;
    onClose: () => void;
}

// Zoeken zonder gedoe met hoofdletters of accenten: "Sciences" vindt ook
// "Sciënces", en elk woord van de zoekterm mag ergens in de naam zitten.
function normaliseer(s: string): string {
    return s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/**
 * De week die de kiezer voor dit vak toont: die waarin de meeste klasgroepen
 * het geven (bij gelijkspel de vroegste). De kiezer vergelijkt één week, en
 * een klasgroep die dat vak die week toevallig niet heeft (feestdag, latere
 * start) zou anders uit de vergelijking vallen.
 */
function besteWeek(blokken: Lesblok[]): Date | null {
    const perWeek = new Map<number, Set<string>>();
    for (const b of blokken) {
        const ma = mondayOf(b.start).getTime();
        const set = perWeek.get(ma);
        if (set) set.add(b.klasgroep);
        else perWeek.set(ma, new Set([b.klasgroep]));
    }
    let beste: { ma: number; aantal: number } | null = null;
    for (const [ma, set] of perWeek) {
        if (!beste || set.size > beste.aantal || (set.size === beste.aantal && ma < beste.ma)) {
            beste = { ma, aantal: set.size };
        }
    }
    return beste ? new Date(beste.ma) : null;
}

/**
 * Modale OLOD-zoeker: doorzoekt alle vakken die de shortlist in de actieve
 * periode geeft, zonder dat de gebruiker eerst de juiste klasgroep en week
 * moet vinden. Een klik op een resultaat opent de gedeelde klasgroep-kiezer
 * ({@link OlodKlasgroepDialoog}) met, per klasgroep die het vak geeft, het
 * weekrooster waarin het valt; de keuze daar zet het vak bij díe klasgroep in
 * het traject en brengt de gebruiker terug in de lijst, zodat meerdere vakken
 * na elkaar opgezocht kunnen worden.
 */
export function OlodZoeker({
    klasgroepen,
    actiefBereik,
    periodeGrenzen,
    traject,
    blokkenPerKlas,
    bereikVoorOlod,
    selectieVoor,
    colorOf,
    ensureColor,
    onToggleBlok,
    onClose,
}: Props) {
    const { perKlas, klaar, totaal, mislukt } = usePeriodeRoosters(klasgroepen, actiefBereik);
    const laadt = klaar < totaal;

    const [zoek, setZoek] = useState('');
    const [actiefIdx, setActiefIdx] = useState(0);
    // Het vak waarvoor de klasgroep-kiezer openstaat (null = enkel de lijst).
    // Bewust de naam en niet het vak zelf: komt er nog een klasgroep binnen
    // terwijl de kiezer openstaat, dan telt die meteen mee.
    const [gekozenNaam, setGekozenNaam] = useState<string | null>(null);

    const veldRef = useRef<HTMLInputElement | null>(null);
    const lijstRef = useRef<HTMLDivElement | null>(null);

    // Alle vakken die de shortlist in deze periode geeft — dezelfde index als
    // de wizard gebruikt. Hangt enkel aan de opgehaalde roosters, niet aan het
    // traject: doorzoeken hoeft niet te herrekenen telkens er een vak bijkomt.
    const vakken = useMemo(() => vakkenUitRoosters(perKlas), [perKlas]);

    const gekozenVak = useMemo(
        () => (gekozenNaam ? (vakken.find(v => v.olodNaam === gekozenNaam) ?? null) : null),
        [gekozenNaam, vakken]
    );

    // Esc sluit de zoeker — behalve wanneer de kiezer erbovenop staat, want die
    // vangt Esc zelf op en mag niet samen met de zoeker verdwijnen.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && !gekozenVak) onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, gekozenVak]);

    // Terug uit de kiezer: de cursor hoort weer in het zoekveld te staan, klaar
    // voor het volgende vak.
    useEffect(() => {
        if (!gekozenVak) veldRef.current?.focus();
    }, [gekozenVak]);

    // Waar staat elk vak al in het traject? Per OLOD-naam de klasgroepen waar
    // het gekozen is, enkel voor selecties die de actieve periode raken — dat
    // is de periode die de lijst doorzoekt.
    const gekozenBij = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const sel of traject) {
            if (!bereikOverlapt(sel.van, sel.tot, actiefBereik.van, actiefBereik.tot)) continue;
            const label = isActief(sel) ? sel.klasgroep : `${sel.klasgroep} (uit)`;
            const bestaand = map.get(sel.olodNaam);
            if (bestaand) {
                if (!bestaand.includes(label)) bestaand.push(label);
            } else {
                map.set(sel.olodNaam, [label]);
            }
        }
        return map;
    }, [traject, actiefBereik]);

    const termen = useMemo(
        () => normaliseer(zoek.trim()).split(/\s+/).filter(Boolean),
        [zoek]
    );

    const resultaten = useMemo(() => {
        if (termen.length === 0) return vakken;
        const treffers = vakken.filter(v => {
            const naam = normaliseer(v.olodNaam);
            return termen.every(t => naam.includes(t));
        });
        // Wie vooraan in de naam matcht staat bovenaan; de rest blijft
        // alfabetisch (vakken is al gesorteerd, en sort is stabiel).
        return treffers.sort(
            (a, b) =>
                normaliseer(a.olodNaam).indexOf(termen[0]) -
                normaliseer(b.olodNaam).indexOf(termen[0])
        );
    }, [vakken, termen]);

    // Het gemarkeerde resultaat springt terug naar boven bij een nieuwe
    // zoekterm en blijft binnen de lijst wanneer die korter wordt.
    useEffect(() => {
        setActiefIdx(0);
    }, [zoek]);
    useEffect(() => {
        setActiefIdx(i => (i < resultaten.length ? i : Math.max(0, resultaten.length - 1)));
    }, [resultaten.length]);
    useEffect(() => {
        const rij = lijstRef.current?.children[actiefIdx] as HTMLElement | undefined;
        rij?.scrollIntoView({ block: 'nearest' });
    }, [actiefIdx, resultaten.length]);

    // Een vak openen betekent zijn kleur vastleggen: de kiezer markeert het
    // ermee in de mini-weekroosters. Bewust pas hier en niet voor de hele
    // lijst — anders krijgt elk vak van de opleiding een kleur in de kleurmap.
    const openVak = (vak: VakInRoosters) => {
        ensureColor(vak.olodNaam);
        setGekozenNaam(vak.olodNaam);
    };

    const week = useMemo(
        () => (gekozenVak ? besteWeek(gekozenVak.blokken) : null),
        [gekozenVak]
    );

    // Het traject zoals het er nu bij ligt: de tegenpartij voor de botsingen
    // die elke kandidaatkaart vermeldt.
    const effectieve = useMemo(() => {
        const { van, tot } = periodeBereik(actiefBereik.van, actiefBereik.tot);
        return effectieveBlokken(traject, blokkenPerKlas, van, tot);
    }, [traject, blokkenPerKlas, actiefBereik]);

    const kandidaten = useMemo<KiezerKandidaat[]>(() => {
        if (!gekozenVak || !week) return [];
        const olodNaam = gekozenVak.olodNaam;
        const weekEind = fridayEndOf(week);
        const inWeek = (b: Lesblok) =>
            b.start.getTime() >= week.getTime() && b.start.getTime() <= weekEind.getTime();
        const restWeek = effectieve.filter(inWeek);
        const out: KiezerKandidaat[] = [];
        for (const kg of gekozenVak.klasgroepen) {
            const all = (perKlas[kg] ?? []).filter(inWeek);
            const match = all
                .filter(b => b.olodNaam === olodNaam)
                .sort((a, b) => a.start.getTime() - b.start.getTime());
            if (match.length === 0) continue;
            const gekozen = selectieVoor(kg, olodNaam, match[0].start) !== null;
            // Lessen van hetzelfde vak bij deze klasgroep zijn geen tegenpartij:
            // dat zijn net de lessen die de keuze zou toevoegen.
            const anderen = restWeek.filter(b => !(b.klasgroep === kg && b.olodNaam === olodNaam));
            out.push({
                klasgroep: kg,
                huidig: false,
                allBlokken: all,
                matchBlokken: match,
                gekozen,
                botsend: match.filter(mb => anderen.some(ab => overlapt(mb, ab))),
                actie: gekozen
                    ? 'Klik om uit je traject te halen'
                    : 'Klik om deze klasgroep te kiezen',
            });
        }
        return out;
    }, [gekozenVak, week, perKlas, effectieve, selectieVoor]);

    // Klasgroepen die dit vak in de periode wel geven, maar niet in de getoonde
    // week (latere start, feestdag, blokweek). Ze vallen uit de vergelijking,
    // dus de kiezer benoemt ze — anders lijkt het alsof ze het vak niet geven.
    const nietInWeek = useMemo(
        () =>
            gekozenVak
                ? gekozenVak.klasgroepen.filter(kg => !kandidaten.some(k => k.klasgroep === kg))
                : [],
        [gekozenVak, kandidaten]
    );

    // Kiezen zet het vak bij die klasgroep in het traject en brengt je terug in
    // de lijst, klaar voor het volgende vak. Een klik op een al gekozen kaart
    // haalt het er weer uit en houdt de kiezer open, zodat je meteen een andere
    // klasgroep kan aanduiden — zelfde gedrag als in paneel B.
    const kiesKlasgroep = (kandidaat: KiezerKandidaat) => {
        onToggleBlok(kandidaat.matchBlokken[0]);
        if (!kandidaat.gekozen) setGekozenNaam(null);
    };

    // Een periode in woorden: "S1 · 15/09/2025 – 31/01/2026". Voor de kopbalk
    // is dat de actieve periode; voor een vak de periode waarvoor een keuze
    // ervan zou gelden — bij een semestervak in modulemodus is dat meer dan de
    // actieve periode, en dat hoort de gebruiker te zien vóór hij kiest.
    const bereikLabel = (bereik: { van: string; tot: string }): string => {
        const datums = `${formatDateBE(parseIsoDate(bereik.van))} – ${formatDateBE(
            parseIsoDate(bereik.tot)
        )}`;
        const p = actievePeriode(allePeriodes(periodeGrenzen), bereik.van, bereik.tot);
        return p ? `${p.kort} · ${datums}` : datums;
    };

    const onVeldKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiefIdx(i => Math.min(i + 1, resultaten.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiefIdx(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const vak = resultaten[actiefIdx];
            if (vak) openVak(vak);
        }
    };

    return (
        <>
            {createPortal(
                <div className={styles.zoomBackdrop} onClick={onClose}>
                    <div
                        className={styles.zoekDialog}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Zoek een OLOD"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className={styles.zoomHeaderBar}>
                            <Search size={16} />
                            <span className={styles.zoomTitle}>Zoek een OLOD</span>
                            <span className={styles.zoomSubtitle}>
                                {bereikLabel(actiefBereik)} · {klasgroepen.length}{' '}
                                {klasgroepen.length === 1 ? 'klasgroep' : 'klasgroepen'}
                            </span>
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

                        <div className={styles.zoekVeldRij}>
                            <Search size={14} className={styles.zoekVeldIcon} />
                            <input
                                ref={veldRef}
                                autoFocus
                                type="text"
                                className={styles.zoekVeld}
                                value={zoek}
                                onChange={e => setZoek(e.target.value)}
                                onKeyDown={onVeldKey}
                                placeholder="Typ een deel van de naam van het vak…"
                                aria-label="Zoekterm"
                            />
                            {zoek && (
                                <button
                                    type="button"
                                    className={styles.zoekWis}
                                    onClick={() => {
                                        setZoek('');
                                        veldRef.current?.focus();
                                    }}
                                    title="Zoekterm wissen"
                                    aria-label="Zoekterm wissen"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <div className={styles.zoekLijst} ref={lijstRef}>
                            {resultaten.map((vak, i) => {
                                const staatIn = gekozenBij.get(vak.olodNaam);
                                return (
                                    <button
                                        key={vak.olodNaam}
                                        type="button"
                                        className={`${styles.zoekRij} ${
                                            i === actiefIdx ? styles.zoekRijActief : ''
                                        }`}
                                        onMouseEnter={() => setActiefIdx(i)}
                                        onClick={() => openVak(vak)}
                                        title={`Bij welke klasgroep wil je ${vak.olodNaam} volgen?`}
                                    >
                                        <span className={styles.zoekRijNaam}>{vak.olodNaam}</span>
                                        {staatIn && (
                                            <span className={styles.zoekRijGekozen}>
                                                <Check size={12} strokeWidth={3} />
                                                {staatIn.join(', ')}
                                            </span>
                                        )}
                                        <span className={styles.zoekRijMeta}>
                                            {vak.klasgroepen.length}{' '}
                                            {vak.klasgroepen.length === 1
                                                ? 'klasgroep'
                                                : 'klasgroepen'}{' '}
                                            · {vak.lessen}{' '}
                                            {vak.lessen === 1 ? 'les' : 'lessen'}
                                        </span>
                                        <ChevronRight size={14} className={styles.zoekRijPijl} />
                                    </button>
                                );
                            })}
                            {resultaten.length === 0 && (
                                <div className={styles.kiesEmpty}>
                                    {laadt ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" /> Roosters
                                            laden…
                                        </>
                                    ) : klasgroepen.length === 0 ? (
                                        'Je hebt nog geen klasgroepen gemarkeerd — doe dat eerst bij Instellingen.'
                                    ) : vakken.length === 0 ? (
                                        'Geen enkele klasgroep uit je shortlist geeft les in deze periode.'
                                    ) : (
                                        `Geen vak met "${zoek.trim()}" in de naam.`
                                    )}
                                </div>
                            )}
                        </div>

                        <div className={styles.zoekVoet}>
                            {laadt ? (
                                <span className={styles.zoekVoetLaadt}>
                                    <Loader2 size={12} className="animate-spin" /> {klaar} van{' '}
                                    {totaal} klasgroepen doorzocht…
                                </span>
                            ) : (
                                <span>
                                    {resultaten.length === vakken.length
                                        ? `${vakken.length} ${
                                              vakken.length === 1 ? 'vak' : 'vakken'
                                          } in deze periode`
                                        : `${resultaten.length} van ${vakken.length} vakken`}
                                </span>
                            )}
                            {mislukt.length > 0 && (
                                <span
                                    className={styles.zoekVoetFout}
                                    title={`Niet doorzocht: ${mislukt.join(', ')}`}
                                >
                                    <AlertTriangle size={12} /> {mislukt.length}{' '}
                                    {mislukt.length === 1 ? 'klasgroep' : 'klasgroepen'} zonder
                                    rooster
                                </span>
                            )}
                            <span className={styles.zoekVoetHint}>↑↓ bladeren · Enter openen</span>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {gekozenVak && week && (
                <OlodKlasgroepDialoog
                    olodNaam={gekozenVak.olodNaam}
                    weekMonday={week}
                    kandidaten={kandidaten}
                    loading={false}
                    aantalShortlist={klasgroepen.length}
                    hint={
                        <>
                            Klik op de klasgroep waarbij je dit vak wil volgen — het komt dan bij
                            die klasgroep in je traject, voor{' '}
                            <strong>{bereikLabel(bereikVoorOlod(gekozenVak.olodNaam))}</strong>. De getoonde week
                            is er één uit die periode, als vergelijkingspunt.
                            {nietInWeek.length > 0 && (
                                <>
                                    {' '}
                                    <strong>{nietInWeek.join(', ')}</strong>{' '}
                                    {nietInWeek.length === 1 ? 'geeft' : 'geven'} dit vak wel in
                                    deze periode, maar niet in deze week.
                                </>
                            )}
                        </>
                    }
                    colorOf={colorOf}
                    onKies={kiesKlasgroep}
                    onClose={() => setGekozenNaam(null)}
                />
            )}
        </>
    );
}
