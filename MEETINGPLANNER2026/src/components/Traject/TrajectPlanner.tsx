import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Printer,
    RotateCcw,
    Settings as SettingsIcon,
    LayoutGrid,
    Home,
    Copy,
    Check,
    Info,
    X,
    Save,
    BookOpen,
} from 'lucide-react';
import styles from './Traject.module.css';
import {
    profielVingerafdruk,
    selectieKey,
    uniekeProfielNaam,
    zelfdeNaam,
    trajectVingerafdruk,
    useActiefTraject,
    useBewaardeTrajecten,
    useKleurMap,
    useLastBackup,
    useProfielen,
    useStudentTraject,
    useTrajectSettings,
    type BewaardTraject,
    type Profiel,
} from './hooks';
import { isActief, type Lesblok, type OLODSelectie } from './types';
import { bereikRaakt } from './dateUtils';
import { DossierMenu } from './BewaardeTrajecten';
import { ProfielMenu } from './ProfielMenu';
import {
    BevestigDialog,
    BewaarDialog,
    ProfielDialog,
    ProfielWisselDialog,
    WizardStartDialog,
    type DialogItem,
} from './TrajectDialogs';
import { UndoToast, useUndo } from './Toast';
import { TrajectSettingsView } from './TrajectSettings';
import { KlasgroepSelector } from './KlasgroepSelector';
import { KlasgroepRooster } from './KlasgroepRooster';
import { OlodZoeker } from './OlodZoeker';
import { TrajectWizard } from './TrajectWizard';
import { StudentOverzicht } from './StudentOverzicht';
import { PeriodeSwitcher } from './PeriodeSwitcher';
import { TrajectPrintView, buildTrajectClipboardText } from './TrajectPrintView';
import { defaultRoosterWeek, periodeLabelVoor, periodesVoor } from './academicYear';
import { isSemesterOlod, semesterBereikVoor } from './semesterOlods';
import { profielSamenvatting } from './settingsSummaries';
import { aantalMetProbleem } from './selectieProblemen';
import { selectieStatussen, useTrajectBlokken, type KlasgroepPreview } from './useTrajectBlokken';
import { backupFilename, buildBackup, downloadBackup, parseBackup, type TrajectBackup } from './trajectBackup';

type Tab = 'werkblad' | 'instellingen';

// De handleiding staat als PDF in public/ en wordt mee gedeployed. BASE_URL
// zorgt dat de link ook onder het GitHub Pages-subpad klopt.
const handleidingUrl = `${import.meta.env.BASE_URL}trajectplannerHandleiding.pdf`;

// De dialoog die momenteel openstaat. Alle bevestigingen en het benoemen van
// een traject lopen hierlangs, in plaats van via window.confirm/prompt.
type Dialoog =
    | { soort: 'bewaar' }
    | { soort: 'reset' }
    // De waarschuwing vóór de wizard opengaat: er staan al OLODs, en de wizard
    // vult die aan of schrijft erover. Enkel wanneer het traject niet leeg is.
    | { soort: 'wizardStart' }
    | { soort: 'laad'; item: BewaardTraject }
    | { soort: 'verwijderBewaard'; item: BewaardTraject }
    // Profielen (instellingssets): bewaren onder een naam, overschakelen naar
    // een ander profiel (wist het traject) en er een weggooien.
    | { soort: 'profielBewaar' }
    // Een profiel dat via een deel-link binnenkwam onder een naam bewaren die
    // hier nog vrij is; enkel nodig wanneer de meegestuurde naam al bezet is.
    | { soort: 'profielGedeeld'; naam: string }
    | { soort: 'profielWissel'; profiel: Profiel }
    | { soort: 'profielVerwijder'; profiel: Profiel }
    // De import wacht op het antwoord van de gebruiker: `resolve` sluit de
    // Promise die TrajectSettingsView aan de bestandskiezer hangt.
    | { soort: 'import'; backup: TrajectBackup; resolve: (ok: boolean) => void };

interface Props {
    onBack: () => void;
    // True wanneer de student via een trajectbegeleider-link binnenkwam en de
    // klasgroepen + semesterperiode dus al voor hem zijn klaargezet.
    presetApplied?: boolean;
    // De naam van het profiel waaruit die link gemaakt is — enkel gezet bij een
    // link die vanuit de profielenlijst gedeeld werd. Alleen dán kan de
    // ontvanger de set als profiel op zijn eigen toestel bewaren.
    presetNaam?: string | null;
}

const PANEL_A_MIN = 140;
const PANEL_A_MAX = 420;
const PANEL_C_MIN = 280;
const PANEL_C_MAX = 900;
const PANEL_B_MIN = 320;
const KEY_PANEL_A = 'traject_panelA_width';
const KEY_PANEL_C = 'traject_panelC_width';

function clamp(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, v));
}

interface SplitterProps {
    orientation: 'left' | 'right'; // which side this splitter resizes (left=A, right=C)
    onDelta: (dx: number) => void;
}

function Splitter({ orientation, onDelta }: SplitterProps) {
    const [active, setActive] = useState(false);
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        const target = e.currentTarget;
        target.setPointerCapture(e.pointerId);
        setActive(true);
        let lastX = e.clientX;
        const move = (ev: PointerEvent) => {
            const dx = ev.clientX - lastX;
            lastX = ev.clientX;
            // For the right splitter, dragging right shrinks panel C → invert.
            onDelta(orientation === 'left' ? dx : -dx);
        };
        const up = (ev: PointerEvent) => {
            try { target.releasePointerCapture(ev.pointerId); } catch { /* ignored */ }
            target.removeEventListener('pointermove', move);
            target.removeEventListener('pointerup', up);
            target.removeEventListener('pointercancel', up);
            setActive(false);
        };
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    };
    return (
        <div
            className={`${styles.splitter} ${active ? styles.splitterActive : ''}`}
            onPointerDown={onPointerDown}
            role="separator"
            aria-orientation="vertical"
        />
    );
}

export function TrajectPlanner({ onBack, presetApplied = false, presetNaam = null }: Props) {
    const {
        settings,
        toggleKlasgroep,
        setSemesterStart,
        setSemesterEind,
        setSemesterPeriode,
        setPeriodeType,
        setPeriodeGrenzen,
        setSemesterOlod,
        setKoppelGroepen,
        replaceSettings,
        setKlasgroepen,
    } = useTrajectSettings();
    const {
        traject,
        toggleBlok,
        addBlokken,
        selectieVoor,
        remove,
        removeMany,
        toggleActief,
        setActiefBulk,
        setPeriode,
        verbreedOlodNaarSemester,
        setKlasgroep,
        setKlasgroepBulk,
        reset,
        replaceTraject,
    } = useStudentTraject();
    const { map: kleurmap, ensureColor, colorOf, replaceMap, resetColors } = useKleurMap();
    const { lastBackup, markBackup } = useLastBackup();
    const { bewaard: bewaardeTrajecten, bewaar: bewaarTraject, verwijder: verwijderBewaard } = useBewaardeTrajecten();
    const {
        actief: actiefTraject,
        markeer: markeerActief,
        wis: wisActief,
        herstel: herstelActiefTraject,
    } = useActiefTraject();
    const {
        profielen,
        actiefProfiel,
        bewaarProfiel,
        verwijderProfiel,
        zetActiefProfiel,
        replaceProfielen,
    } = useProfielen();
    const { melding: undoMelding, meld: meldUndo, sluit: sluitUndo, herstel: herstelUndo } = useUndo();

    const [tab, setTab] = useState<Tab>(
        settings.mijnOpleidingKlasgroepen.length === 0 ? 'instellingen' : 'werkblad'
    );
    const [actieveKlasgroep, setActieveKlasgroep] = useState<string | null>(
        settings.mijnOpleidingKlasgroepen[0] ?? null
    );
    const [copied, setCopied] = useState(false);
    const [bewaardFeedback, setBewaardFeedback] = useState(false);
    const [bannerDismissed, setBannerDismissed] = useState(false);
    const [dialoog, setDialoog] = useState<Dialoog | null>(null);

    const [panelAWidth, setPanelAWidth] = useState<number>(() => {
        const raw = localStorage.getItem(KEY_PANEL_A);
        const n = raw ? Number(raw) : NaN;
        return Number.isFinite(n) ? clamp(n, PANEL_A_MIN, PANEL_A_MAX) : 200;
    });
    const [panelCWidth, setPanelCWidth] = useState<number>(() => {
        const raw = localStorage.getItem(KEY_PANEL_C);
        const n = raw ? Number(raw) : NaN;
        return Number.isFinite(n) ? clamp(n, PANEL_C_MIN, PANEL_C_MAX) : 460;
    });
    useEffect(() => { localStorage.setItem(KEY_PANEL_A, String(panelAWidth)); }, [panelAWidth]);
    useEffect(() => { localStorage.setItem(KEY_PANEL_C, String(panelCWidth)); }, [panelCWidth]);

    const workbenchRef = useRef<HTMLDivElement | null>(null);
    const adjustPanelA = (dx: number) => {
        setPanelAWidth(prev => {
            const next = clamp(prev + dx, PANEL_A_MIN, PANEL_A_MAX);
            const total = workbenchRef.current?.clientWidth ?? 0;
            const remaining = total - next - panelCWidth - 12; // 12 = two 6px splitters
            return remaining < PANEL_B_MIN ? prev : next;
        });
    };
    const adjustPanelC = (dx: number) => {
        setPanelCWidth(prev => {
            const next = clamp(prev + dx, PANEL_C_MIN, PANEL_C_MAX);
            const total = workbenchRef.current?.clientWidth ?? 0;
            const remaining = total - panelAWidth - next - 12;
            return remaining < PANEL_B_MIN ? prev : next;
        });
    };

    // Keep active klasgroep valid when the shortlist changes
    if (
        actieveKlasgroep &&
        !settings.mijnOpleidingKlasgroepen.includes(actieveKlasgroep)
    ) {
        setActieveKlasgroep(settings.mijnOpleidingKlasgroepen[0] ?? null);
    }
    if (!actieveKlasgroep && settings.mijnOpleidingKlasgroepen[0]) {
        setActieveKlasgroep(settings.mijnOpleidingKlasgroepen[0]);
    }

    // ===== Wijzigingen aan het traject, met undo =====

    // Elke ingrijpende mutatie bewaart eerst het volledige traject en biedt dat
    // als herstelpunt aan. Bewust géén inverse per actie: een bulkwissel kan
    // selecties laten samensmelten (setKlasgroepBulk), en dat is niet ongedaan
    // te maken door nog eens te verzetten.
    const metUndo = (tekst: string, actie: () => void) => {
        const snapshot = traject;
        actie();
        meldUndo(tekst, () => replaceTraject(snapshot));
    };

    const vakken = (n: number) => `${n} ${n === 1 ? 'vak' : 'vakken'}`;

    const handleRemoveOlod = (sel: OLODSelectie) => {
        metUndo(`${sel.olodNaam} verwijderd uit het traject`, () => remove(sel));
    };

    const handleBulkRemove = (sels: OLODSelectie[]) => {
        if (sels.length === 0) return;
        metUndo(`${vakken(sels.length)} verwijderd uit het traject`, () => removeMany(sels));
    };

    // Eén vak (de)activeren is met dezelfde knop meteen terug te draaien;
    // enkel de bulkactie krijgt daarom een undo-melding.
    const handleBulkSetActief = (sels: OLODSelectie[], actief: boolean) => {
        if (sels.length === 0) return;
        metUndo(`${vakken(sels.length)} ${actief ? 'geactiveerd' : 'gedeactiveerd'}`, () =>
            setActiefBulk(sels, actief)
        );
    };

    // "Alles toevoegen" boven het klasgroeprooster: elk vak dat in de getoonde
    // week op het rooster staat en nog niet gekozen is, komt er in één keer bij
    // — met dezelfde periode per vak als een gewone klik (`bereikVoorOlod`, dus
    // een semestervak krijgt zijn hele semester). Een bulkactie die het traject
    // in één klap kan vullen, dus met undo.
    const handleAddAlleBlokken = (blokken: Lesblok[]) => {
        if (blokken.length === 0) return;
        metUndo(`${vakken(blokken.length)} toegevoegd aan het traject`, () =>
            addBlokken(blokken, bereikVoorOlod)
        );
    };

    const handleBulkSetKlasgroep = (sels: OLODSelectie[], klasgroep: string) => {
        if (sels.length === 0) return;
        metUndo(`${vakken(sels.length)} verzet naar ${klasgroep}`, () => setKlasgroepBulk(sels, klasgroep));
    };

    // Verhuizen vanuit een blokje in het studentoverzicht: altijd één vak,
    // maar soms twee selecties (een semester- naast een modulekeuze bij
    // dezelfde klasgroep), die samen moeten meegaan. Vandaar setKlasgroepBulk
    // in plaats van setKlasgroep, met een melding die het vak benoemt.
    const handleVerhuisOlod = (sels: OLODSelectie[], klasgroep: string) => {
        if (sels.length === 0) return;
        metUndo(`${sels[0].olodNaam} verzet naar ${klasgroep}`, () => setKlasgroepBulk(sels, klasgroep));
    };

    // ===== Globale acties (elk via een dialoog) =====

    const doeReset = () => {
        const aantal = traject.length;
        setDialoog(null);
        metUndo(`Traject gewist (${aantal} ${aantal === 1 ? 'OLOD' : 'OLODs'})`, reset);
    };

    // Bewaart het huidige traject mét zijn instellingen (klasgroepen,
    // periode-indeling, actieve periode) onder een naam in localStorage, en
    // markeert dat item als het geopende dossier.
    const doeBewaar = (naam: string, overschrijfId?: string) => {
        const id = bewaarTraject(naam, settings, traject, overschrijfId);
        markeerActief(id, naam, traject, settings);
        setDialoog(null);
        setBewaardFeedback(true);
        window.setTimeout(() => setBewaardFeedback(false), 1500);
    };

    // Bewaren zonder omweg: is er een dossier open, dan gaat het werk er
    // meteen in; zo niet, dan vraagt de dialoog eerst een naam. Hangt aan de
    // Bewaar-knop in de contextbalk, aan het dossiermenu en aan Ctrl+S.
    const doeSnelBewaar = () => {
        if (traject.length === 0) return;
        if (actiefTraject) doeBewaar(actiefTraject.naam, actiefTraject.id);
        else setDialoog({ soort: 'bewaar' });
    };

    // Ctrl+S / Cmd+S bewaart het dossier in plaats van de pagina op te slaan.
    // De handler leeft in een ref zodat de listener maar een keer aangehaakt
    // wordt en toch altijd met de verse state werkt.
    const snelBewaarRef = useRef(doeSnelBewaar);
    useEffect(() => {
        snelBewaarRef.current = doeSnelBewaar;
    });
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
            e.preventDefault();
            snelBewaarRef.current();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // Vervangt het huidige traject én de instellingen door die van een
    // bewaard traject (zoals een back-up-import, maar zonder kleurmap).
    const doeLaad = (item: BewaardTraject) => {
        if (item.settings) replaceSettings(item.settings);
        replaceTraject(item.traject);
        markeerActief(item.id, item.naam, item.traject, item.settings ?? settings);
        setDialoog(null);
        setTab('werkblad');
    };

    // Een klik op een bewaard traject vraagt eerst om bevestiging zodra er iets
    // te overschrijven valt; staat het werkblad leeg, dan laadt het meteen.
    const handleLaad = (item: BewaardTraject) => {
        const heeftData = traject.length > 0 || settings.mijnOpleidingKlasgroepen.length > 0;
        if (heeftData) setDialoog({ soort: 'laad', item });
        else doeLaad(item);
    };

    const doeVerwijderBewaard = (item: BewaardTraject) => {
        verwijderBewaard(item.id);
        // Het geopende dossier bestaat niet meer; het werk blijft staan, maar
        // hoort nu bij geen enkel bewaard traject.
        if (actiefTraject?.id === item.id) wisActief();
        setDialoog(null);
    };

    // ===== Profielen (bewaarde instellingssets) =====

    // Wijken de huidige instellingen af van het actieve profiel? De actieve
    // periode telt daarin niet mee (zie profielVingerafdruk): van S1 naar S2
    // springen is navigatie, geen wijziging aan de set.
    const profielGewijzigd = useMemo(
        () =>
            actiefProfiel
                ? profielVingerafdruk(actiefProfiel.settings) !== profielVingerafdruk(settings)
                : false,
        [actiefProfiel, settings]
    );

    // De huidige instellingen staan in geen enkel profiel: er is er geen
    // actief, of het wijkt af van wat er op het scherm staat. Een wissel gooit
    // ze dan weg, dus dat verdient een vraag vooraf.
    const profielNietBewaard =
        profielGewijzigd || (!actiefProfiel && settings.mijnOpleidingKlasgroepen.length > 0);

    // Bewaart de huidige instellingen als profiel en maakt dat meteen het
    // actieve profiel — het traject blijft ongemoeid, een profiel draagt er
    // geen.
    const doeBewaarProfiel = (naam: string, overschrijfId?: string) => {
        const id = bewaarProfiel(naam, settings, overschrijfId);
        zetActiefProfiel(id);
        setDialoog(null);
    };

    const doeBijwerkenProfiel = () => {
        if (!actiefProfiel) return;
        doeBewaarProfiel(actiefProfiel.naam, actiefProfiel.id);
    };

    // ===== Gedeeld profiel op dit toestel bewaren =====
    // De instellingen uit de link staan al in `settings` (App verwerkt de preset
    // vóór React rendert), dus "bewaren" is gewoon: die instellingen vastleggen
    // onder de meegestuurde naam. Zonder deze knop blijft een gedeelde set
    // eenmalig — ze zit dan wel in de instellingen, maar in geen enkel profiel.
    const [gedeeldBewaardAls, setGedeeldBewaardAls] = useState<string | null>(null);

    const doeBewaarGedeeldProfiel = (naam: string, overschrijfId?: string) => {
        doeBewaarProfiel(naam, overschrijfId);
        setGedeeldBewaardAls(naam.trim());
    };

    // Is de naam hier nog vrij, dan bewaren we meteen — dat is wat de gebruiker
    // vroeg. Bestaat ze al, dan komt de dialoog tussen met een vrije naam als
    // voorstel: een deel-link mag nooit stilzwijgend een eigen profiel met
    // dezelfde naam overschrijven.
    const handleBewaarGedeeldProfiel = () => {
        if (!presetNaam) return;
        if (profielen.some(p => zelfdeNaam(p.naam, presetNaam))) {
            setDialoog({ soort: 'profielGedeeld', naam: presetNaam });
        } else {
            doeBewaarGedeeldProfiel(presetNaam);
        }
    };

    /**
     * Schakelt over naar een ander profiel: de instellingen van dat profiel
     * vervangen altijd de huidige. Wat er met het **studenttraject** gebeurt,
     * kiest de gebruiker in de dialoog:
     *
     * - `wisTraject`: het werkblad start leeg bij de nieuwe set, en laat het
     *   geopende dossier los — met een leeg traject mag Ctrl+S dat dossier niet
     *   overschrijven. Zinvol wanneer de wissel over een andere student gaat.
     * - behouden: de keuzes blijven staan, dossier incluis. Ze verwijzen dan
     *   naar klasgroepen en periodes van de vórige set; wat niet meer past
     *   krijgt in paneel ③ een waarschuwing (zie selectieProblemen.ts) die
     *   verdwijnt zodra het vak verzet is. Zinvol wanneer dezelfde student
     *   onder een andere indeling bekeken wordt.
     *
     * In beide gevallen vormt alles samen één herstelpunt (instellingen +
     * traject + dossier + profiel), zodat een verkeerde klik met "Ongedaan
     * maken" volledig terug te draaien is.
     */
    const doeWisselProfiel = (p: Profiel, wisTraject: boolean) => {
        const vorigeSettings = settings;
        const vorigTraject = traject;
        const vorigDossier = actiefTraject;
        const vorigProfielId = actiefProfiel?.id ?? null;
        const aantal = traject.length;
        // Wat een behouden traject onder de nieuwe set aan waarschuwingen
        // oplevert — zodat de melding zegt waar de gebruiker moet kijken.
        const problemen = wisTraject ? 0 : aantalMetProbleem(traject, p.settings);

        replaceSettings(p.settings);
        if (wisTraject) {
            reset();
            wisActief();
        }
        zetActiefProfiel(p.id);
        setDialoog(null);
        // Bewust géén sprong naar het werkblad: wie vanuit de instellingen
        // wisselt, wil daar meestal meteen verder kijken of bijstellen.

        const melding = wisTraject
            ? aantal > 0
                ? `Profiel "${p.naam}" actief — ${aantal} ${aantal === 1 ? 'OLOD' : 'OLODs'} gewist`
                : `Profiel "${p.naam}" actief`
            : problemen > 0
              ? `Profiel "${p.naam}" actief — traject behouden, ${vakken(problemen)} ${
                    problemen === 1 ? 'past' : 'passen'
                } niet bij deze set`
              : `Profiel "${p.naam}" actief — traject behouden`;

        meldUndo(melding, () => {
            replaceSettings(vorigeSettings);
            replaceTraject(vorigTraject);
            herstelActiefTraject(vorigDossier);
            zetActiefProfiel(vorigProfielId);
        });
    };

    // Staat er een traject, dan vraagt de dialoog wat ermee moet gebeuren
    // (wissen of behouden) — dat is geen bevestiging maar een keuze. Is het
    // traject leeg, dan valt er enkel aan instellingen iets te verliezen: dan
    // volstaat een bevestiging, en zonder ook dát is een dialoog enkel een
    // extra klik.
    const handleKiesProfiel = (p: Profiel) => {
        if (p.id === actiefProfiel?.id) return;
        const heeftWerk = traject.length > 0 || profielNietBewaard;
        if (heeftWerk) setDialoog({ soort: 'profielWissel', profiel: p });
        else doeWisselProfiel(p, true);
    };

    const doeVerwijderProfiel = (p: Profiel) => {
        verwijderProfiel(p.id);
        setDialoog(null);
    };

    const handlePrint = () => {
        window.print();
    };

    const handleCopy = async () => {
        const text = buildTrajectClipboardText(traject, settings);
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
            } finally {
                document.body.removeChild(ta);
            }
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };

    const handleExport = () => {
        const backup = buildBackup(settings, traject, kleurmap, profielen);
        downloadBackup(backupFilename(), backup);
        markBackup(backup.exportedAt);
    };

    // Leest en valideert het bestand (fouten belanden bij de bestandskiezer in
    // de instellingen) en laat de dialoog het antwoord invullen: de Promise
    // lost pas op wanneer de gebruiker bevestigt of annuleert.
    const handleImport = async (file: File): Promise<boolean> => {
        const text = await file.text();
        const backup = parseBackup(text);
        return new Promise<boolean>(resolve => setDialoog({ soort: 'import', backup, resolve }));
    };

    const doeImport = (backup: TrajectBackup, resolve: (ok: boolean) => void) => {
        replaceSettings(backup.settings);
        replaceTraject(backup.traject);
        replaceMap(backup.kleurmap);
        // Bevat de back-up profielen, dan zet ze de lijst terug zoals ze in de
        // geëxporteerde browser stond, en volgt het actieve profiel de
        // geïmporteerde instellingen. Een oudere back-up (geen `profielen`)
        // laat de bestaande profielen met rust.
        if (backup.profielen) {
            replaceProfielen(backup.profielen);
            const geimporteerd = profielVingerafdruk(backup.settings);
            const match = backup.profielen.find(
                p => profielVingerafdruk(p.settings) === geimporteerd
            );
            zetActiefProfiel(match?.id ?? null);
        }
        // Een geïmporteerde back-up is een ander dossier dan het bewaarde
        // traject waar we aan werkten.
        wisActief();
        setDialoog(null);
        resolve(true);
    };

    // Wat de import met de bewaarde profielen doet. Alleen zinvol bij een
    // back-up die het veld heeft: een oudere laat de profielen ongemoeid en
    // krijgt dus ook geen zin hierover.
    const profielImportTekst = (uitBackup: number): string => {
        const n = (k: number) => `${k} ${k === 1 ? 'profiel' : 'profielen'}`;
        if (profielen.length === 0) return `De back-up brengt ${n(uitBackup)} mee.`;
        if (uitBackup === 0) return `Je ${n(profielen.length)} in deze browser worden daarbij gewist.`;
        return `Je ${n(profielen.length)} in deze browser worden vervangen door ${n(uitBackup)} uit de back-up.`;
    };

    const annuleerDialoog = () => {
        if (dialoog?.soort === 'import') dialoog.resolve(false);
        setDialoog(null);
    };

    // Bewaarstatus: wijkt het werkblad af van het bewaarde dossier, dan staat
    // er werk open. Zonder geopend dossier is alles wat er staat "niet bewaard".
    const vingerafdruk = useMemo(() => trajectVingerafdruk(traject, settings), [traject, settings]);
    const nietBewaard = actiefTraject ? actiefTraject.baseline !== vingerafdruk : traject.length > 0;

    // De vakken die een reset zou wissen, met hun kleur — zo ziet de gebruiker
    // in de dialoog waar het precies over gaat.
    const resetItems = useMemo<DialogItem[]>(
        () =>
            traject
                .slice()
                .sort(
                    (a, b) =>
                        a.olodNaam.localeCompare(b.olodNaam) || a.klasgroep.localeCompare(b.klasgroep)
                )
                .map(s => ({
                    key: selectieKey(s),
                    naam: s.olodNaam,
                    kleur: colorOf(s.olodNaam),
                    meta: isActief(s) ? s.klasgroep : `${s.klasgroep} · uit`,
                })),
        [traject, colorOf]
    );

    // De periodes waar de topbar-snelkeuze tussen wisselt (semesters of modules).
    const periodes = useMemo(
        () => periodesVoor(settings.periodeType, settings.periodeGrenzen),
        [settings.periodeType, settings.periodeGrenzen]
    );
    const actiefBereik = useMemo(
        () => ({ van: settings.semesterStart, tot: settings.semesterEind }),
        [settings.semesterStart, settings.semesterEind]
    );

    // De periode waaraan een klik in het rooster dít vak toevoegt. Normaal is
    // dat gewoon de actieve periode; een semestervak loopt over beide modules
    // en krijgt daarom altijd het volledige semester waar die periode in valt.
    // Dezelfde functie voedt `selectieVoor`, zodat het rooster precies de
    // blokken als gekozen toont die een klik ook weer zou weghalen.
    const bereikVoorOlod = useCallback(
        (olodNaam: string) =>
            settings.periodeType === 'module' && isSemesterOlod(olodNaam, settings.semesterOlods)
                ? semesterBereikVoor(actiefBereik.van, actiefBereik.tot, settings.periodeGrenzen)
                : actiefBereik,
        [settings.periodeType, settings.semesterOlods, settings.periodeGrenzen, actiefBereik]
    );

    // Een vak als semestervak markeren (of de markering weghalen). Bij het
    // markeren verbreden alle bestaande keuzes van dat vak meteen naar hun
    // semester; tag en traject vormen samen één herstelpunt, zodat "ongedaan
    // maken" niet halverwege blijft steken. Keuzes bij verschillende
    // klasgroepen in hetzelfde semester blijven allebei staan — paneel ③ wijst
    // die botsing aan.
    const handleToggleSemesterOlod = (olodNaam: string) => {
        const wordtSemester = !isSemesterOlod(olodNaam, settings.semesterOlods);
        const snapshot = traject;
        setSemesterOlod(olodNaam, wordtSemester);
        if (wordtSemester) verbreedOlodNaarSemester(olodNaam, settings.periodeGrenzen);
        meldUndo(
            wordtSemester
                ? `${olodNaam} is nu een semestervak (loopt over beide modules)`
                : `${olodNaam} is weer een modulevak`,
            () => {
                setSemesterOlod(olodNaam, !wordtSemester);
                if (wordtSemester) replaceTraject(snapshot);
            }
        );
    };

    // Open het rooster op de huidige week als die binnen de actieve periode
    // valt, anders op de eerste lesweek van die periode (niet op een week uit
    // het vorige jaar, wat 404's op de roosterdata gaf). Verandert mee wanneer
    // de gebruiker van periode wisselt.
    const initialWeek = useMemo(
        () => defaultRoosterWeek(new Date(), settings.semesterStart, settings.semesterEind),
        [settings.semesterStart, settings.semesterEind]
    );

    // Jaarrooster per klasgroep in het traject: voedt het overzicht (paneel C)
    // en de controle of elke selectie wel lessen oplevert (paneel A).
    const { blokkenPerKlas, busy: blokkenBusy, error: blokkenError } = useTrajectBlokken(
        traject,
        ensureColor,
        settings.periodeGrenzen
    );
    const statussen = useMemo(() => selectieStatussen(traject, blokkenPerKlas), [traject, blokkenPerKlas]);

    // Wat-als-preview vanuit de klasgroep-kiezer (paneel A): zolang de
    // gebruiker over een andere klasgroep beweegt, toont paneel C waar het vak
    // dan zou vallen.
    const [klasgroepPreview, setKlasgroepPreview] = useState<KlasgroepPreview | null>(null);

    // Staat de OLOD-zoeker open? Ze hangt hier en niet in paneel A, omdat ze
    // dezelfde acties nodig heeft als het rooster (een vak toevoegen met het
    // bereik van dat vak) en over alle klasgroepen van de shortlist kijkt.
    const [zoekerOpen, setZoekerOpen] = useState(false);
    const [wizardOpen, setWizardOpen] = useState(false);

    // Het voorstel van de wizard overnemen. De wizard vult één periode volledig
    // in: alles wat de actieve periode raakt wordt vervangen door haar keuzes,
    // keuzes in andere periodes blijven staan. `bereikRaakt` en niet
    // `bereikOverlapt`, want semester 1 eindigt op de dag dat semester 2 begint
    // — anders zou een S2-keuze sneuvelen bij een wizard in S1. Eén
    // herstelpunt, zodat een voorstel met één klik terug te draaien is.
    // Sluit de wizard niet: zij vraagt na elk overnemen zelf of de andere
    // periodes ook nog gelegd worden, en sluit pas op `onClose`.
    const handleWizardOvernemen = (keuzes: { olodNaam: string; klasgroep: string }[]) => {
        // Een gedeactiveerde keuze is bewust geparkeerd (een scenario dat de
        // gebruiker wil kunnen terughalen); die overleeft de wizard, tenzij het
        // voorstel datzelfde vak invult — anders zou de gedeactiveerde variant
        // de nieuwe keuze verdringen, want selectieKey kent geen `actief`.
        const ingevuld = new Set(keuzes.map(k => k.olodNaam));
        const behouden = traject.filter(
            s =>
                !bereikRaakt(s.van, s.tot, actiefBereik.van, actiefBereik.tot) ||
                (!isActief(s) && !ingevuld.has(s.olodNaam))
        );
        const nieuw = keuzes.map(k => {
            const bereik = bereikVoorOlod(k.olodNaam);
            return { klasgroep: k.klasgroep, olodNaam: k.olodNaam, van: bereik.van, tot: bereik.tot };
        });
        metUndo(`Voorstel overgenomen (${vakken(keuzes.length)})`, () =>
            replaceTraject([...behouden, ...nieuw])
        );
    };

    // De wizard openen. Staat er al iets in het traject, dan gaat daar de
    // waarschuwing aan vooraf: de wizard vertrekt van wat er ligt en vervangt
    // bij elk overnemen de keuzes van de periode waarin ze op dat moment
    // puzzelt. Wie het hele jaar in één zitting wil leggen, wil vaak eerst
    // schoon schip — vandaar de keuze in plaats van een loutere melding.
    const handleWizard = () => {
        if (traject.length === 0) setWizardOpen(true);
        else setDialoog({ soort: 'wizardStart' });
    };

    const doeWizardStart = (wisTraject: boolean) => {
        setDialoog(null);
        if (wisTraject) {
            const aantal = traject.length;
            metUndo(`Traject gewist (${aantal} ${aantal === 1 ? 'OLOD' : 'OLODs'})`, reset);
        }
        setWizardOpen(true);
    };

    return (
      <>
        <div className={styles.screenRoot}>
        <div className={styles.page}>
            {/* Rij 1 — appbalk: waar ben ik, waar kan ik heen, en de acties die
                zelden nodig zijn of gevaarlijk zijn (overloopmenu). Bewust
                gescheiden van rij 2: die draagt de *toestand* waarin het
                werkblad staat, niet de commando's. */}
            <div className={styles.appbar}>
                {/* Terug naar de modulekeuze is zelden nodig; een huisje met
                    tooltip volstaat en scheelt de balk een tekstknop. */}
                <button
                    className={styles.iconBtn}
                    onClick={onBack}
                    title="Terug naar het hoofdmenu — kies een andere tool"
                    aria-label="Terug naar het hoofdmenu"
                >
                    <Home size={15} />
                </button>
                <div className={styles.topbarTitle}>Trajectplanner</div>

                <div className={styles.topbarSpacer} />

                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${tab === 'werkblad' ? styles.tabActive : ''}`}
                        onClick={() => setTab('werkblad')}
                    >
                        <LayoutGrid size={14} /> Werkblad
                    </button>
                    <button
                        className={`${styles.tab} ${tab === 'instellingen' ? styles.tabActive : ''}`}
                        onClick={() => setTab('instellingen')}
                    >
                        <SettingsIcon size={14} /> Instellingen
                    </button>
                </div>

                <a
                    className={`${styles.iconBtn} ${styles.toolbarLink}`}
                    href={handleidingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Handleiding van de trajectplanner (PDF) openen in een nieuw tabblad"
                    aria-label="Handleiding"
                >
                    <BookOpen size={15} />
                </a>
            </div>

            {/* Rij 2 — contextbalk: waarvoor plan ik, in welke periode, en aan
                welk dossier werk ik. Alleen in het werkblad, want dit stuurt
                paneel B en C; het instellingenscherm heeft zijn eigen kopbalk.
                Elke groep draagt een uitgeschreven label — "S1 S2" alleen is
                voor wie de tool een paar keer per jaar gebruikt een raadsel. */}
            {tab === 'werkblad' && (
                <div className={styles.contextbar}>
                    {/* Eerste groep: de instellingenset waarin gewerkt wordt.
                        Let op het onderscheid met het dossier verderop in deze
                        balk: een *profiel* draagt alleen instellingen
                        (klasgroepen, periode-indeling, grensdatums,
                        semestervakken) en is herbruikbaar over studenten heen,
                        een *dossier* is één student (traject + zijn
                        instellingen). */}
                    <div className={styles.ctxGroep}>
                        <span className={styles.ctxLabel}>Profiel</span>
                        <ProfielMenu
                            profielen={profielen}
                            actief={actiefProfiel}
                            gewijzigd={profielGewijzigd}
                            onKies={handleKiesProfiel}
                            onBewaarAls={() => setDialoog({ soort: 'profielBewaar' })}
                            onBijwerken={doeBijwerkenProfiel}
                            onVerwijder={p => setDialoog({ soort: 'profielVerwijder', profiel: p })}
                        />
                    </div>

                    <div className={styles.ctxScheiding} />

                    <div className={styles.ctxGroep}>
                        <span className={styles.ctxLabel}>Periode</span>
                        <PeriodeSwitcher
                            compact
                            periodes={periodes}
                            actieveStart={settings.semesterStart}
                            actieveEind={settings.semesterEind}
                            onKies={p => setSemesterPeriode(p.start, p.eind)}
                        />
                    </div>

                    <div className={styles.ctxScheiding} />

                    <div className={styles.ctxGroep}>
                        <span className={styles.ctxLabel}>Dossier</span>
                        <DossierMenu
                            items={bewaardeTrajecten}
                            actieveNaam={actiefTraject?.naam ?? null}
                            nietBewaard={nietBewaard}
                            kanBewaren={traject.length > 0}
                            onBewaar={doeSnelBewaar}
                            onBewaarAls={() => setDialoog({ soort: 'bewaar' })}
                            onLaad={handleLaad}
                            onVerwijder={item => setDialoog({ soort: 'verwijderBewaard', item })}
                        />
                        {/* Staat er altijd, ook wanneer alles bewaard is: zo
                            springen de knoppen ernaast niet heen en weer bij
                            elke wijziging. De oranje rand komt er pas bij zodra
                            er werk openstaat. */}
                        <button
                            className={`${styles.ctxBewaarBtn} ${
                                nietBewaard ? styles.ctxBewaarBtnOpen : ''
                            }`}
                            onClick={doeSnelBewaar}
                            disabled={traject.length === 0 || (!nietBewaard && !bewaardFeedback)}
                            title={
                                traject.length === 0
                                    ? 'Er zijn nog geen vakken gekozen om te bewaren'
                                    : !nietBewaard
                                      ? 'Alles is bewaard'
                                      : actiefTraject
                                        ? `Wijzigingen bewaren in "${actiefTraject.naam}" (Ctrl+S)`
                                        : 'Dit dossier een naam geven en bewaren in deze browser (Ctrl+S)'
                            }
                        >
                            {bewaardFeedback ? <Check size={13} /> : <Save size={13} />}
                            {bewaardFeedback ? 'Bewaard!' : 'Bewaar'}
                        </button>

                        {/* Afdrukken en kopiëren zaten in het overloopmenu van de
                            appbalk, maar ze horen bij het samenstellen zelf: zo
                            levert de trajectbegeleider het dossier af.
                            Icoonknoppen, want beide iconen lezen zonder tekst. */}
                        <button
                            className={styles.ctxIconBtn}
                            onClick={handlePrint}
                            title="Het studenttraject afdrukken of als PDF bewaren"
                            aria-label="Print / PDF"
                        >
                            <Printer size={15} />
                        </button>
                        <button
                            className={styles.ctxIconBtn}
                            onClick={handleCopy}
                            disabled={traject.length === 0}
                            title="Kopieer het studenttraject (zoals het wordt afgedrukt) naar het klembord"
                            aria-label="Kopieer naar klembord"
                        >
                            {copied ? <Check size={15} /> : <Copy size={15} />}
                        </button>
                    </div>

                    <div className={styles.topbarSpacer} />

                    {/* Reset hoort in het zicht — scenario's uitproberen is deel
                        van het werk — maar niet naast de opbouwende knoppen.
                        Vandaar het uiteinde van de balk, en met tekst erbij: het
                        pijltje-icoon alleen leest als "ongedaan maken". */}
                    <button
                        className={styles.ctxResetBtn}
                        onClick={() => setDialoog({ soort: 'reset' })}
                        disabled={traject.length === 0}
                        title="Wist alle gekozen OLODs; je instellingen, profielen en bewaarde dossiers blijven staan"
                    >
                        <RotateCcw size={14} /> Reset
                    </button>
                </div>
            )}

            {presetApplied && !bannerDismissed && (
                <div className={styles.presetBanner}>
                    <Info size={18} />
                    <div className={styles.presetBannerText}>
                        {gedeeldBewaardAls ? (
                            <>
                                <strong>"{gedeeldBewaardAls}" staat nu bij je profielen.</strong> Je
                                vindt het terug in de balk bovenaan het werkblad en bij
                                Instellingen → Profielen — ook de volgende keer dat je deze tool
                                opent, zonder de link.
                            </>
                        ) : (
                            <>
                                <strong>Klaargezet door je trajectbegeleider.</strong> De klasgroepen
                                en periode zijn al ingesteld — kies meteen je vakken in het
                                werkblad. Je hoeft niets in de instellingen aan te passen.
                                {presetNaam && (
                                    <>
                                        {' '}
                                        Deze instellingen komen uit het profiel{' '}
                                        <strong>"{presetNaam}"</strong>; bewaar het op dit toestel om
                                        er later opnieuw naartoe te kunnen wisselen.
                                    </>
                                )}
                            </>
                        )}
                    </div>
                    {presetNaam && !gedeeldBewaardAls && (
                        <button
                            className={styles.presetBannerBtn}
                            onClick={handleBewaarGedeeldProfiel}
                            title={`De instellingen van "${presetNaam}" als profiel in deze browser bewaren`}
                        >
                            <Save size={14} /> Bewaar op dit toestel
                        </button>
                    )}
                    <button
                        className={styles.presetBannerClose}
                        onClick={() => setBannerDismissed(true)}
                        aria-label="Melding sluiten"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {tab === 'instellingen' ? (
                <TrajectSettingsView
                    settings={settings}
                    profielen={profielen}
                    actiefProfiel={actiefProfiel}
                    profielGewijzigd={profielGewijzigd}
                    onKiesProfiel={handleKiesProfiel}
                    onBewaarProfiel={() => setDialoog({ soort: 'profielBewaar' })}
                    onBijwerkenProfiel={doeBijwerkenProfiel}
                    onVerwijderProfiel={p => setDialoog({ soort: 'profielVerwijder', profiel: p })}
                    onToggleKlasgroep={toggleKlasgroep}
                    onSetKlasgroepen={setKlasgroepen}
                    onSemesterStartChange={setSemesterStart}
                    onSemesterEindChange={setSemesterEind}
                    onSemesterPeriodeChange={setSemesterPeriode}
                    onPeriodeTypeChange={setPeriodeType}
                    onPeriodeGrenzenChange={setPeriodeGrenzen}
                    onExport={handleExport}
                    onImport={handleImport}
                    onResetColors={resetColors}
                    aantalKleuren={Object.keys(kleurmap).length}
                    lastBackup={lastBackup}
                    heeftTraject={traject.length > 0}
                    onDone={() => setTab('werkblad')}
                />
            ) : (
                <div
                    ref={workbenchRef}
                    className={styles.workbench}
                    style={{
                        gridTemplateColumns: `${panelAWidth}px 6px minmax(${PANEL_B_MIN}px, 1fr) 6px ${panelCWidth}px`,
                    }}
                >
                    <KlasgroepSelector
                        klasgroepen={settings.mijnOpleidingKlasgroepen}
                        actief={actieveKlasgroep}
                        onSelect={setActieveKlasgroep}
                        traject={traject}
                        blokkenPerKlas={blokkenPerKlas}
                        colorOf={colorOf}
                        onRemoveOlod={handleRemoveOlod}
                        onSetPeriode={setPeriode}
                        onSetKlasgroep={setKlasgroep}
                        onBulkSetKlasgroep={handleBulkSetKlasgroep}
                        onBulkRemove={handleBulkRemove}
                        onToggleActief={toggleActief}
                        onBulkSetActief={handleBulkSetActief}
                        onPreview={setKlasgroepPreview}
                        statussen={statussen}
                        actiefBereik={actiefBereik}
                        periodeType={settings.periodeType}
                        periodeGrenzen={settings.periodeGrenzen}
                        semesterOlods={settings.semesterOlods}
                        onToggleSemesterOlod={handleToggleSemesterOlod}
                        koppelGroepen={settings.koppelGroepen}
                        onZoekOlod={() => setZoekerOpen(true)}
                        onWizard={handleWizard}
                    />
                    <Splitter orientation="left" onDelta={adjustPanelA} />
                    <KlasgroepRooster
                        klasgroep={actieveKlasgroep}
                        initialWeek={initialWeek}
                        mijnOpleidingKlasgroepen={settings.mijnOpleidingKlasgroepen}
                        actiefBereik={actiefBereik}
                        periodeGrenzen={settings.periodeGrenzen}
                        periodeType={settings.periodeType}
                        semesterOlods={settings.semesterOlods}
                        onToggleSemesterOlod={handleToggleSemesterOlod}
                        selectieVoor={(k, o, d) => selectieVoor(k, o, d, bereikVoorOlod(o))}
                        colorOf={colorOf}
                        ensureColor={ensureColor}
                        onToggleBlok={b => toggleBlok(b, bereikVoorOlod(b.olodNaam))}
                        onAddAlleBlokken={handleAddAlleBlokken}
                    />
                    <Splitter orientation="right" onDelta={adjustPanelC} />
                    <StudentOverzicht
                        traject={traject}
                        blokkenPerKlas={blokkenPerKlas}
                        busy={blokkenBusy}
                        error={blokkenError}
                        actiefBereik={actiefBereik}
                        periodeType={settings.periodeType}
                        periodeGrenzen={settings.periodeGrenzen}
                        shortlist={settings.mijnOpleidingKlasgroepen}
                        colorOf={colorOf}
                        onVerhuis={handleVerhuisOlod}
                        preview={klasgroepPreview}
                    />
                </div>
            )}
        </div>
        </div>

        {/* De OLOD-zoeker: een vak opzoeken over de hele shortlist heen en
            meteen kiezen bij welke klasgroep het gevolgd wordt. Ze gebruikt
            dezelfde toggle als een klik in het rooster, dus met hetzelfde
            bereik per vak (`bereikVoorOlod`). */}
        {zoekerOpen && (
            <OlodZoeker
                klasgroepen={settings.mijnOpleidingKlasgroepen}
                actiefBereik={actiefBereik}
                periodeGrenzen={settings.periodeGrenzen}
                traject={traject}
                blokkenPerKlas={blokkenPerKlas}
                bereikVoorOlod={bereikVoorOlod}
                selectieVoor={(k, o, d) => selectieVoor(k, o, d, bereikVoorOlod(o))}
                colorOf={colorOf}
                ensureColor={ensureColor}
                onToggleBlok={b => toggleBlok(b, bereikVoorOlod(b.olodNaam))}
                onClose={() => setZoekerOpen(false)}
            />
        )}

        {/* De wizard: vakken aanduiden en er een rooster bij laten zoeken. Ze
            puzzelt op referentieweken en vult daarmee de actieve periode. */}
        {wizardOpen && (
            <TrajectWizard
                klasgroepen={settings.mijnOpleidingKlasgroepen}
                actiefBereik={actiefBereik}
                periodeGrenzen={settings.periodeGrenzen}
                periodeType={settings.periodeType}
                traject={traject}
                koppelGroepen={settings.koppelGroepen}
                onKoppelGroepen={setKoppelGroepen}
                bereikVoorOlod={bereikVoorOlod}
                onOvernemen={handleWizardOvernemen}
                onKiesPeriode={p => setSemesterPeriode(p.start, p.eind)}
                onClose={() => setWizardOpen(false)}
            />
        )}

        {dialoog?.soort === 'bewaar' && (
            <BewaarDialog
                voorstel={actiefTraject?.naam ?? `Traject ${bewaardeTrajecten.length + 1}`}
                bewaarde={bewaardeTrajecten}
                aantalOlods={traject.length}
                onBewaar={doeBewaar}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'reset' && (
            <BevestigDialog
                titel="Traject wissen?"
                bericht={
                    <>
                        Alle {traject.length} gekozen {traject.length === 1 ? 'OLOD' : 'OLODs'} verdwijnen
                        uit het studenttraject. Je klasgroepen, periode-instellingen en bewaarde
                        trajecten blijven staan.
                    </>
                }
                itemsKop="Verdwijnt uit het traject"
                items={resetItems}
                bevestigLabel="Traject wissen"
                danger
                onBevestig={doeReset}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'wizardStart' && (
            <WizardStartDialog
                aantalOlods={traject.length}
                aantalInPeriode={
                    traject.filter(s =>
                        bereikRaakt(s.van, s.tot, actiefBereik.van, actiefBereik.tot)
                    ).length
                }
                periodeLabel={periodeLabelVoor(actiefBereik.van, actiefBereik.tot, settings.periodeGrenzen).label}
                items={resetItems}
                nietBewaardDossier={
                    nietBewaard ? 'Je huidige werk is niet bewaard in een dossier.' : undefined
                }
                onStart={doeWizardStart}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'laad' && (
            <BevestigDialog
                titel={`"${dialoog.item.naam}" laden?`}
                bericht={
                    <>
                        Dit vervangt je huidige traject ({traject.length}{' '}
                        {traject.length === 1 ? 'OLOD' : 'OLODs'}) en je instellingen (klasgroepen en
                        periode) door die van <strong>{dialoog.item.naam}</strong> (
                        {dialoog.item.traject.length}{' '}
                        {dialoog.item.traject.length === 1 ? 'OLOD' : 'OLODs'}).
                        {nietBewaard && ' Je huidige werk is niet bewaard.'}
                    </>
                }
                bevestigLabel="Laden"
                danger={nietBewaard}
                onBevestig={() => doeLaad(dialoog.item)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'verwijderBewaard' && (
            <BevestigDialog
                titel="Bewaard traject verwijderen?"
                bericht={
                    <>
                        <strong>{dialoog.item.naam}</strong> ({dialoog.item.traject.length}{' '}
                        {dialoog.item.traject.length === 1 ? 'OLOD' : 'OLODs'}) wordt uit deze browser
                        verwijderd. Dit kan niet ongedaan gemaakt worden. Je huidige werkblad verandert
                        niet.
                    </>
                }
                bevestigLabel="Verwijderen"
                danger
                onBevestig={() => doeVerwijderBewaard(dialoog.item)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'profielBewaar' && (
            <ProfielDialog
                voorstel={actiefProfiel?.naam ?? `Profiel ${profielen.length + 1}`}
                profielen={profielen}
                samenvatting={profielSamenvatting(settings)}
                onBewaar={doeBewaarProfiel}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'profielGedeeld' && (
            <ProfielDialog
                titel="Gedeeld profiel bewaren"
                voorstel={uniekeProfielNaam(dialoog.naam, profielen)}
                profielen={profielen}
                samenvatting={profielSamenvatting(settings)}
                intro={
                    <>
                        Je hebt al een profiel met de naam <strong>"{dialoog.naam}"</strong> in deze
                        browser. Kies een andere naam om het gedeelde profiel (
                        {profielSamenvatting(settings)}) ernaast te bewaren, of neem de bestaande
                        naam over om dat profiel te vervangen.
                    </>
                }
                onBewaar={doeBewaarGedeeldProfiel}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {/* Met een traject op het werkblad is een profielwissel een keuze
            (meenemen of wissen), zonder traject enkel nog een bevestiging over
            instellingen die nergens bewaard staan. */}
        {dialoog?.soort === 'profielWissel' && traject.length > 0 && (
            <ProfielWisselDialog
                naam={dialoog.profiel.naam}
                samenvatting={profielSamenvatting(dialoog.profiel.settings)}
                aantalOlods={traject.length}
                aantalProblemen={aantalMetProbleem(traject, dialoog.profiel.settings)}
                items={resetItems}
                nietBewaardDossier={
                    nietBewaard ? 'Je huidige werk is niet bewaard in een dossier.' : undefined
                }
                nietBewaardProfiel={
                    profielNietBewaard
                        ? actiefProfiel
                            ? `De wijzigingen aan "${actiefProfiel.naam}" zijn niet bewaard.`
                            : 'Je huidige instellingen staan in geen enkel profiel.'
                        : undefined
                }
                onWissel={wis => doeWisselProfiel(dialoog.profiel, wis)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'profielWissel' && traject.length === 0 && (
            <BevestigDialog
                titel={`Overschakelen naar "${dialoog.profiel.naam}"?`}
                bericht={
                    <>
                        Je klasgroepen, periode-indeling en grensdatums worden vervangen door die
                        van <strong>{dialoog.profiel.naam}</strong> ({profielSamenvatting(dialoog.profiel.settings)}).
                        {' Je studenttraject is leeg, dus daar gaat niets verloren.'}
                        {profielNietBewaard && (
                            <>
                                {' '}
                                {actiefProfiel
                                    ? `De wijzigingen aan "${actiefProfiel.naam}" zijn niet bewaard.`
                                    : 'Je huidige instellingen staan in geen enkel profiel.'}
                            </>
                        )}{' '}
                        Bewaarde dossiers en profielen blijven staan.
                    </>
                }
                bevestigLabel="Overschakelen"
                onBevestig={() => doeWisselProfiel(dialoog.profiel, true)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'profielVerwijder' && (
            <BevestigDialog
                titel="Profiel verwijderen?"
                bericht={
                    <>
                        <strong>{dialoog.profiel.naam}</strong> (
                        {profielSamenvatting(dialoog.profiel.settings)}) wordt uit deze browser
                        verwijderd. Dit kan niet ongedaan gemaakt worden. Je huidige instellingen en
                        je traject veranderen niet.
                    </>
                }
                bevestigLabel="Verwijderen"
                danger
                onBevestig={() => doeVerwijderProfiel(dialoog.profiel)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        {dialoog?.soort === 'import' && (
            <BevestigDialog
                titel="Back-up importeren?"
                bericht={
                    <>
                        {traject.length > 0 || settings.mijnOpleidingKlasgroepen.length > 0 ? (
                            <>
                                De back-up bevat {dialoog.backup.traject.length}{' '}
                                {dialoog.backup.traject.length === 1 ? 'OLOD' : 'OLODs'} en overschrijft je
                                huidige instellingen, traject ({traject.length}{' '}
                                {traject.length === 1 ? 'OLOD' : 'OLODs'}) en kleuren.
                            </>
                        ) : (
                            <>
                                De back-up bevat {dialoog.backup.traject.length}{' '}
                                {dialoog.backup.traject.length === 1 ? 'OLOD' : 'OLODs'} en wordt in dit
                                werkblad geladen.
                            </>
                        )}
                        {/* Enkel bij een back-up van na de profielen: die zet ook
                            de profielenlijst terug, en dat is niet te zien aan de
                            OLOD-telling hierboven. */}
                        {dialoog.backup.profielen && (
                            <> {profielImportTekst(dialoog.backup.profielen.length)}</>
                        )}
                    </>
                }
                bevestigLabel="Importeren"
                danger={traject.length > 0}
                onBevestig={() => doeImport(dialoog.backup, dialoog.resolve)}
                onAnnuleer={annuleerDialoog}
            />
        )}

        <UndoToast melding={undoMelding} onHerstel={herstelUndo} onSluit={sluitUndo} />
        <TrajectPrintView traject={traject} settings={settings} />
      </>
    );
}
