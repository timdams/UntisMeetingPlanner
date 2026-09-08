import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Link2, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import {
    GEEN_KOPPELING,
    koppelSamen,
    metGroep,
    stelGroepenVoor,
    voorstelNaam,
    zelfdeLeden,
    zonderGroep,
    type KoppelInstellingen,
    type Koppelgroep,
} from './koppelGroepen';
import { actievePeriode, periodesVoor, type PeriodeGrenzen, type PeriodeType } from './academicYear';
import { usePeriodeRoosters } from './useTrajectBlokken';
import { vakkenUitRoosters } from './trajectVoorstel';
import styles from './Traject.module.css';

interface Props {
    inst: KoppelInstellingen;
    onChange: (inst: KoppelInstellingen) => void;
    // De shortlist: enkel de vakken van deze klasgroepen komen in de lijst.
    klasgroepen: string[];
    periodeType: PeriodeType;
    periodeGrenzen: PeriodeGrenzen;
    // De periode waarin de wizard staat; ook de periode waarvan de vakken
    // standaard getoond worden, zodat de roosters al in het geheugen zitten.
    actiefBereik: { van: string; tot: string };
    onClose: () => void;
}

/** Een koppeling die op bevestiging wacht. */
interface Bezig {
    // De vakken die erbij komen.
    olods: string[];
    // De groepsnaam: bij een nieuwe groep een voorstel dat de gebruiker mag
    // overtypen, bij een bestaande groep haar naam.
    naam: string;
    bestaand: boolean;
    // De vakken waar ze mee samengezet worden — enkel om de vraag te stellen.
    metOlods: string[];
}

/**
 * Het "geavanceerd"-venster van de wizard: welke vakken horen samen bij één
 * klasgroep?
 *
 * Bewust achter een knopje. Voor de meeste opleidingen is er niets te koppelen,
 * en dan hoort dit scherm niet in de weg te staan. Wie het opent, ziet altijd
 * zwart op wit welke groepen afgedwongen worden: het rekenwerk leest enkel deze
 * lijst, nooit de namen zelf (zie koppelGroepen.ts).
 *
 * Koppelen doe je **met de hand**: klik een vak aan, klik dan het vak waar het
 * bij hoort (of een bestaande groep), en bevestig de vraag. Bewust klikken en
 * niet slepen — een HTML5-sleep vertrekt in Chromium niet vanaf een `<button>`,
 * en een lijst van enkele tientallen vakken sleept sowieso slecht wanneer ze
 * moet meescrollen. De knop die groepen uit de namen voorstelt staat eronder
 * als hulpmiddel, niet als de weg: die naamafspraak geldt lang niet overal.
 *
 * De vakkenlijst komt uit één periode — standaard die van de wizard. Een
 * opleiding met labs in verschillende jaren of modules kiest hierboven een
 * andere periode; enkel die ene wordt dan opgehaald, in plaats van het hele
 * academiejaar leeg te trekken.
 */
export function KoppelGroepenDialoog({
    inst,
    onChange,
    klasgroepen,
    periodeType,
    periodeGrenzen,
    actiefBereik,
    onClose,
}: Props) {
    const [scanBereik, setScanBereik] = useState(actiefBereik);
    const { perKlas, klaar, totaal } = usePeriodeRoosters(klasgroepen, scanBereik);
    const laadt = klaar < totaal;

    // Wat er op bevestiging wacht, welk vak aangeklikt is om te koppelen, en
    // waarop de vakkenlijst gefilterd staat.
    const [bezig, setBezig] = useState<Bezig | null>(null);
    const [gekozenVak, setGekozenVak] = useState<string | null>(null);
    const [filter, setFilter] = useState('');

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // Eerst de vraag wegklikken, dan pas het venster: anders verdwijnt
            // met één Esc meer dan de gebruiker bedoelt.
            if (bezig) setBezig(null);
            else if (gekozenVak) setGekozenVak(null);
            else onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, bezig, gekozenVak]);

    const periodes = useMemo(
        () => periodesVoor(periodeType, periodeGrenzen),
        [periodeType, periodeGrenzen]
    );
    const scanPeriode = useMemo(
        () => actievePeriode(periodes, scanBereik.van, scanBereik.tot),
        [periodes, scanBereik]
    );

    const vakken = useMemo(() => vakkenUitRoosters(perKlas), [perKlas]);
    const voorstellen = useMemo(() => stelGroepenVoor(vakken.map(v => v.olodNaam)), [vakken]);
    const groepVan = useMemo(() => {
        const map = new Map<string, string>();
        for (const g of inst.groepen) for (const o of g.olods) map.set(o, g.naam);
        return map;
    }, [inst.groepen]);

    const zichtbareVakken = useMemo(() => {
        const q = filter.trim().toLowerCase();
        return q ? vakken.filter(v => v.olodNaam.toLowerCase().includes(q)) : vakken;
    }, [vakken, filter]);

    // ===== Koppelen =====

    // Twee vakken samenbrengen. Zit er al één in een groep, dan groeit die groep
    // aan in plaats van dat er een tweede naast ontstaat.
    const vraagKoppeling = (bron: string, doel: string) => {
        if (!bron || !doel || bron === doel) return;
        const groepDoel = groepVan.get(doel);
        const groepBron = groepVan.get(bron);
        if (groepDoel && groepDoel === groepBron) return; // zitten al samen
        if (groepDoel) {
            setBezig({ olods: [bron], naam: groepDoel, bestaand: true, metOlods: [doel] });
        } else if (groepBron) {
            setBezig({ olods: [doel], naam: groepBron, bestaand: true, metOlods: [bron] });
        } else {
            setBezig({
                olods: [bron, doel],
                naam: voorstelNaam([bron, doel]),
                bestaand: false,
                metOlods: [],
            });
        }
        setGekozenVak(null);
    };

    /** Een aangeklikt vak bij een bestaande groep zetten. */
    const vraagBijGroep = (olod: string, groep: Koppelgroep) => {
        if (groep.olods.includes(olod)) return;
        setBezig({ olods: [olod], naam: groep.naam, bestaand: true, metOlods: groep.olods });
        setGekozenVak(null);
    };

    const bevestig = () => {
        if (!bezig || !bezig.naam.trim()) return;
        const volgend = koppelSamen(inst, bezig.naam, [...bezig.olods, ...bezig.metOlods]);
        // De eerste groep die iemand aanmaakt, zet de koppeling meteen aan —
        // anders duidt hij iets aan dat vervolgens niets doet. Wie ze daarna
        // bewust uitzet, houdt die keuze.
        onChange(inst.groepen.length === 0 ? { ...volgend, actief: true } : volgend);
        setBezig(null);
    };

    // De hele koppeling in twee klikken: eerst het ene vak, dan het andere.
    const klikVak = (olod: string) => {
        if (gekozenVak === null || gekozenVak === olod) {
            setGekozenVak(gekozenVak === olod ? null : olod);
            return;
        }
        // Zitten ze al in dezelfde groep, dan valt er niets te vragen: die klik
        // verlegt gewoon de keuze naar dit vak, in plaats van niets te doen.
        const groep = groepVan.get(olod);
        if (groep !== undefined && groep === groepVan.get(gekozenVak)) setGekozenVak(olod);
        else vraagKoppeling(gekozenVak, olod);
    };

    const verwijderLid = (groep: Koppelgroep, olod: string) => {
        const olods = groep.olods.filter(o => o !== olod);
        // Onder de twee vakken houdt een groep op te bestaan; dat expliciet doen
        // leest duidelijker dan het aan het normaliseren over te laten.
        onChange(
            olods.length < 2 ? zonderGroep(inst, groep.naam) : metGroep(inst, { ...groep, olods })
        );
    };

    // Wat een voorstel uit de namen zou doen: niets (staat er al), aanvullen, of
    // een nieuwe groep. Aanvullen en niet vervangen, want een andere periode
    // geeft soms maar een deel van dezelfde groep.
    const staatVan = (voorstel: Koppelgroep) => {
        const bestaand = inst.groepen.find(g => g.naam === voorstel.naam);
        if (!bestaand) return { soort: 'nieuw' as const, samen: voorstel };
        const samen: Koppelgroep = {
            naam: bestaand.naam,
            olods: Array.from(new Set([...bestaand.olods, ...voorstel.olods])),
        };
        return zelfdeLeden(bestaand, samen)
            ? { soort: 'aanwezig' as const, samen }
            : { soort: 'aanvullen' as const, samen };
    };

    const neemVoorstel = (samen: Koppelgroep) => {
        const volgend = koppelSamen(inst, samen.naam, samen.olods);
        onChange(inst.groepen.length === 0 ? { ...volgend, actief: true } : volgend);
    };

    const aantalGroepen = inst.groepen.length;

    return createPortal(
        <div className={styles.koppelBackdrop}>
            <div
                className={styles.koppelDialog}
                role="dialog"
                aria-modal="true"
                aria-label="Vakken die samen horen"
            >
                <div className={styles.zoomHeaderBar}>
                    <Link2 size={16} />
                    <span className={styles.zoomTitle}>Vakken die samen horen</span>
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

                {/* De vraag staat vastgeprikt onder de kop: waar je ook stond
                    toen je losliet, ze is altijd in beeld. */}
                {bezig && (
                    <div className={styles.koppelVraag} role="alertdialog" aria-live="polite">
                        <span className={styles.koppelVraagTekst}>
                            {bezig.bestaand ? (
                                <>
                                    <strong>{bezig.olods.join(', ')}</strong> toevoegen aan{' '}
                                    <strong>{bezig.naam}</strong>?
                                </>
                            ) : (
                                <>
                                    Horen <strong>{bezig.olods[0]}</strong> en{' '}
                                    <strong>{bezig.olods[1]}</strong> samen bij één klasgroep?
                                </>
                            )}
                        </span>
                        {!bezig.bestaand && (
                            <label className={styles.koppelVraagNaam}>
                                Naam
                                <input
                                    type="text"
                                    value={bezig.naam}
                                    autoFocus
                                    placeholder="bv. Sales"
                                    onChange={e =>
                                        setBezig(b => (b ? { ...b, naam: e.target.value } : b))
                                    }
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') bevestig();
                                    }}
                                />
                            </label>
                        )}
                        <button
                            type="button"
                            className={styles.koppelVraagJa}
                            onClick={bevestig}
                            disabled={!bezig.naam.trim()}
                            title={
                                bezig.naam.trim()
                                    ? 'Deze vakken horen samen'
                                    : 'Geef de groep eerst een naam'
                            }
                        >
                            <Check size={13} /> {bezig.bestaand ? 'Toevoegen' : 'Ja, samen'}
                        </button>
                        <button
                            type="button"
                            className={styles.koppelVraagNee}
                            onClick={() => setBezig(null)}
                        >
                            Annuleren
                        </button>
                    </div>
                )}

                <div className={styles.koppelBody}>
                    <p className={styles.koppelIntro}>
                        Sommige opleidingen geven een groepje vakken als één geheel — een lab dat
                        je in zijn geheel bij één klasgroep volgt. Duid je zo'n groep hier aan, dan
                        houdt de wizard ze samen: botst er iets met een ander vak, dan wijkt dat
                        andere vak. Volgt de student maar een deel van de groep (een vrijstelling),
                        dan geldt de regel enkel voor wat aangevinkt staat.
                    </p>

                    <label className={styles.koppelSchakelaar}>
                        <input
                            type="checkbox"
                            checked={inst.actief}
                            onChange={e => onChange({ ...inst, actief: e.target.checked })}
                        />
                        <span>
                            <strong>Vakken uit een groep altijd in dezelfde klasgroep</strong>
                            <span className={styles.koppelSchakelaarHint}>
                                Staat dit uit, dan blijven je groepen bewaard maar houdt de wizard
                                er geen rekening mee.
                            </span>
                        </span>
                    </label>

                    <label className={styles.koppelSchakelaar}>
                        <input
                            type="checkbox"
                            checked={inst.overPeriodes}
                            disabled={!inst.actief}
                            onChange={e => onChange({ ...inst, overPeriodes: e.target.checked })}
                        />
                        <span>
                            <strong>Ook in de andere periodes van het jaar dezelfde klasgroep</strong>
                            <span className={styles.koppelSchakelaarHint}>
                                Staat het lab in een andere periode al bij een klasgroep, dan kiest
                                de wizard hier diezelfde. Zonder dit vinkje mag elke periode haar
                                eigen klasgroep hebben.
                            </span>
                        </span>
                    </label>

                    <section className={styles.koppelSectie}>
                        <div className={styles.koppelSectieKop}>
                            Jouw groepen
                            <span className={styles.wizSectieHint}>
                                {aantalGroepen === 0
                                    ? 'nog geen'
                                    : `${aantalGroepen} ${aantalGroepen === 1 ? 'groep' : 'groepen'}`}
                            </span>
                        </div>
                        {aantalGroepen === 0 ? (
                            <div className={styles.koppelLeeg}>
                                Nog geen groepen. Klik hieronder twee vakken na elkaar aan — of
                                laat dit gerust leeg: de wizard werkt dan precies zoals voordien.
                            </div>
                        ) : (
                            <div className={styles.koppelGroepen}>
                                {inst.groepen.map(groep => {
                                    // Staat er een vak klaar dat hier nog niet in
                                    // zit, dan is deze kaart een doelwit: ze licht
                                    // op en vangt de tweede klik.
                                    const mag =
                                        gekozenVak !== null && !groep.olods.includes(gekozenVak);
                                    return (
                                        <div
                                            key={groep.naam}
                                            className={`${styles.koppelGroep} ${
                                                mag ? styles.koppelGroepDoel : ''
                                            }`}
                                            onClick={() => {
                                                if (mag && gekozenVak) {
                                                    vraagBijGroep(gekozenVak, groep);
                                                }
                                            }}
                                            {...(mag
                                                ? {
                                                      role: 'button',
                                                      tabIndex: 0,
                                                      onKeyDown: (e: React.KeyboardEvent) => {
                                                          if (e.key !== 'Enter' && e.key !== ' ') {
                                                              return;
                                                          }
                                                          e.preventDefault();
                                                          if (gekozenVak) {
                                                              vraagBijGroep(gekozenVak, groep);
                                                          }
                                                      },
                                                  }
                                                : {})}
                                        >
                                            <div className={styles.koppelGroepKop}>
                                                <span className={styles.koppelGroepNaam}>
                                                    {groep.naam}
                                                </span>
                                                <span className={styles.koppelGroepAantal}>
                                                    {groep.olods.length} vakken
                                                </span>
                                                {mag && (
                                                    <span className={styles.koppelGroepDoelHint}>
                                                        klik om {gekozenVak} hier bij te zetten
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    className={styles.koppelWeg}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        onChange(zonderGroep(inst, groep.naam));
                                                    }}
                                                    title={`Groep ${groep.naam} verwijderen`}
                                                    aria-label={`Groep ${groep.naam} verwijderen`}
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                            <div className={styles.koppelLeden}>
                                                {groep.olods.map(olod => (
                                                    <span key={olod} className={styles.koppelLid}>
                                                        {olod}
                                                        <button
                                                            type="button"
                                                            className={styles.koppelLidWeg}
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                verwijderLid(groep, olod);
                                                            }}
                                                            title={`${olod} hoort niet bij deze groep`}
                                                            aria-label={`${olod} uit de groep halen`}
                                                        >
                                                            <X size={11} />
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    <section className={styles.koppelSectie}>
                        <div className={styles.koppelSectieKop}>
                            Vakken koppelen
                            <span className={styles.wizSectieHint}>
                                uit {scanPeriode ? scanPeriode.kort : 'deze periode'}
                            </span>
                            <div className={styles.koppelPeriodes}>
                                {periodes.map(p => {
                                    const aan =
                                        p.start === scanBereik.van && p.eind === scanBereik.tot;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            className={`${styles.wizWeekChip} ${
                                                aan ? styles.wizWeekChipAan : ''
                                            }`}
                                            onClick={() =>
                                                setScanBereik({ van: p.start, tot: p.eind })
                                            }
                                            aria-pressed={aan}
                                            title={`Toon de vakken van ${p.label}`}
                                        >
                                            {p.kort}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className={styles.wizVoetnoot}>
                            {gekozenVak ? (
                                <>
                                    <strong>{gekozenVak}</strong> staat klaar — klik nu het vak
                                    waar het bij hoort, of een groep hierboven. Nog eens op
                                    hetzelfde vak klikken laat het weer los.
                                </>
                            ) : (
                                <>
                                    Koppelen doe je in twee klikken: <strong>klik een vak aan</strong>
                                    , en klik daarna het vak waar het bij hoort — of een groep
                                    hierboven om het daaraan toe te voegen. Je krijgt telkens eerst
                                    de vraag of ze samen horen. Zitten de labs van een ander jaar in
                                    een andere periode, kies die dan hierboven.
                                </>
                            )}
                        </div>

                        {laadt ? (
                            <div className={styles.kiesEmpty}>
                                <Loader2 size={14} className="animate-spin" /> Roosters laden… (
                                {klaar}/{totaal})
                            </div>
                        ) : vakken.length === 0 ? (
                            <div className={styles.koppelLeeg}>
                                Geen enkele klasgroep uit je shortlist geeft les in deze periode.
                            </div>
                        ) : (
                            <>
                                <label className={styles.koppelZoek}>
                                    <Search size={13} />
                                    <input
                                        type="text"
                                        value={filter}
                                        placeholder="Zoek een vak…"
                                        onChange={e => setFilter(e.target.value)}
                                    />
                                    {filter && (
                                        <button
                                            type="button"
                                            className={styles.koppelZoekWis}
                                            onClick={() => setFilter('')}
                                            aria-label="Zoekterm wissen"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </label>
                                <div className={styles.koppelVakken}>
                                    {zichtbareVakken.map(vak => {
                                        const groep = groepVan.get(vak.olodNaam);
                                        const aan = gekozenVak === vak.olodNaam;
                                        return (
                                            <button
                                                key={vak.olodNaam}
                                                type="button"
                                                className={`${styles.koppelVak} ${
                                                    aan ? styles.koppelVakAan : ''
                                                }`}
                                                onClick={() => klikVak(vak.olodNaam)}
                                                aria-pressed={aan}
                                                title={
                                                    `${vak.klasgroepen.join(', ')}` +
                                                    (groep ? `\nZit in de groep ${groep}.` : '') +
                                                    (aan
                                                        ? '\nKlik nu het vak waar het bij hoort — of klik nog eens om los te laten.'
                                                        : gekozenVak
                                                          ? `\nKlik om samen te zetten met ${gekozenVak}.`
                                                          : '\nKlik aan, en klik daarna het vak waar het bij hoort.')
                                                }
                                            >
                                                {vak.olodNaam}
                                                {groep && (
                                                    <span className={styles.koppelVakGroep}>
                                                        <Link2 size={10} />
                                                        {groep}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                    {zichtbareVakken.length === 0 && (
                                        <span className={styles.koppelLeeg}>
                                            Geen vak met “{filter}” in deze periode.
                                        </span>
                                    )}
                                </div>
                            </>
                        )}

                        {/* Hulpmiddel, geen weg: sommige opleidingen zetten de
                            labnaam vooraan met een dubbele punt erachter. Waar dat
                            zo is, scheelt het veel slepen. */}
                        {!laadt && voorstellen.length > 0 && (
                            <div className={styles.koppelSuggestie}>
                                <span className={styles.koppelSuggestieKop}>
                                    Namen die op een groep wijzen
                                </span>
                                <span className={styles.wizVoetnoot}>
                                    Deze vakken beginnen hetzelfde, met een dubbele punt erachter —
                                    zoals de vakken die met <em>Sales:</em> beginnen. Klik om de
                                    groep in één keer over te nemen; jij beslist of ze klopt.
                                </span>
                                <div className={styles.wizChips}>
                                    {voorstellen.map(voorstel => {
                                        const staat = staatVan(voorstel);
                                        const erbij =
                                            staat.soort === 'aanvullen'
                                                ? staat.samen.olods.length -
                                                  (inst.groepen.find(g => g.naam === voorstel.naam)
                                                      ?.olods.length ?? 0)
                                                : 0;
                                        return (
                                            <button
                                                key={voorstel.naam}
                                                type="button"
                                                className={`${styles.wizChip} ${
                                                    staat.soort === 'aanwezig'
                                                        ? styles.koppelChipAl
                                                        : ''
                                                }`}
                                                disabled={staat.soort === 'aanwezig'}
                                                onClick={() => neemVoorstel(staat.samen)}
                                                title={voorstel.olods.join('\n')}
                                            >
                                                {staat.soort === 'aanwezig' ? (
                                                    <Check size={11} strokeWidth={3} />
                                                ) : (
                                                    <Plus size={11} strokeWidth={3} />
                                                )}
                                                {voorstel.naam}
                                                <span className={styles.wizChipAantal}>
                                                    {staat.soort === 'aanvullen'
                                                        ? `+${erbij}`
                                                        : voorstel.olods.length}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                <div className={styles.wizVoet}>
                    {aantalGroepen > 0 && (
                        <button
                            type="button"
                            className={styles.koppelWisAlles}
                            onClick={() => onChange(GEEN_KOPPELING)}
                        >
                            Alles wissen
                        </button>
                    )}
                    <span className={styles.wizVoetHint}>
                        Deze groepen worden samen met je profiel bewaard.
                    </span>
                    <button type="button" className={styles.wizOverneemKnop} onClick={onClose}>
                        <Check size={14} /> Klaar
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
}
