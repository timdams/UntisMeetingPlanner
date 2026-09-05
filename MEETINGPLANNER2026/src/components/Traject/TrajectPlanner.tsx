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
import { isActief, type OLODSelectie } from './types';
import { DossierMenu } from './BewaardeTrajecten';
import { ProfielMenu } from './ProfielMenu';
import { BevestigDialog, BewaarDialog, ProfielDialog, type DialogItem } from './TrajectDialogs';
import { UndoToast, useUndo } from './Toast';
import { TrajectSettingsView } from './TrajectSettings';
import { KlasgroepSelector } from './KlasgroepSelector';
import { KlasgroepRooster } from './KlasgroepRooster';
import { StudentOverzicht } from './StudentOverzicht';
import { PeriodeSwitcher } from './PeriodeSwitcher';
import { TrajectPrintView, buildTrajectClipboardText } from './TrajectPrintView';
import { defaultRoosterWeek, periodesVoor } from './academicYear';
import { isSemesterOlod, semesterBereikVoor } from './semesterOlods';
import { profielSamenvatting } from './settingsSummaries';
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
    | { soort: 'laad'; item: BewaardTraject }
    | { soort: 'verwijderBewaard'; item: BewaardTraject }
    // Profielen (instellingssets): bewaren onder een naam, overschakelen naar
    // een ander profiel (wist het traject) en er een weggooien.
    | { soort: 'profielBewaar' }
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

export function TrajectPlanner({ onBack, presetApplied = false }: Props) {
    const {
        settings,
        toggleKlasgroep,
        setSemesterStart,
        setSemesterEind,
        setSemesterPeriode,
        setPeriodeType,
        setPeriodeGrenzen,
        setSemesterOlod,
        replaceSettings,
        setKlasgroepen,
    } = useTrajectSettings();
    const {
        traject,
        toggleBlok,
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

    const handleBulkSetKlasgroep = (sels: OLODSelectie[], klasgroep: string) => {
        if (sels.length === 0) return;
        metUndo(`${vakken(sels.length)} verzet naar ${klasgroep}`, () => setKlasgroepBulk(sels, klasgroep));
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

    /**
     * Schakelt over naar een ander profiel: de instellingen van dat profiel
     * vervangen de huidige, en het studenttraject wordt gewist. Dat wissen is
     * geen bijwerking maar de kern — de OLOD-keuzes verwijzen naar klasgroepen
     * en periodes van de vórige set, en zouden daar als lege of foute selecties
     * blijven staan. Om dezelfde reden laat het werkblad het geopende dossier
     * los: met een leeg traject mag Ctrl+S dat dossier niet overschrijven.
     *
     * Alles samen vormt één herstelpunt (instellingen + traject + dossier +
     * profiel), zodat een verkeerde klik met "Ongedaan maken" volledig terug te
     * draaien is.
     */
    const doeWisselProfiel = (p: Profiel) => {
        const vorigeSettings = settings;
        const vorigTraject = traject;
        const vorigDossier = actiefTraject;
        const vorigProfielId = actiefProfiel?.id ?? null;
        const aantal = traject.length;

        replaceSettings(p.settings);
        reset();
        wisActief();
        zetActiefProfiel(p.id);
        setDialoog(null);
        // Bewust géén sprong naar het werkblad: wie vanuit de instellingen
        // wisselt, wil daar meestal meteen verder kijken of bijstellen.

        meldUndo(
            aantal > 0
                ? `Profiel "${p.naam}" actief — ${aantal} ${aantal === 1 ? 'OLOD' : 'OLODs'} gewist`
                : `Profiel "${p.naam}" actief`,
            () => {
                replaceSettings(vorigeSettings);
                replaceTraject(vorigTraject);
                herstelActiefTraject(vorigDossier);
                zetActiefProfiel(vorigProfielId);
            }
        );
    };

    // Vraagt eerst om bevestiging zodra er iets te verliezen valt: gekozen
    // OLODs, of instellingen die nergens bewaard staan. Valt er niets te
    // verliezen, dan is een dialoog enkel een extra klik.
    const handleKiesProfiel = (p: Profiel) => {
        if (p.id === actiefProfiel?.id) return;
        const heeftWerk = traject.length > 0 || profielNietBewaard;
        if (heeftWerk) setDialoog({ soort: 'profielWissel', profiel: p });
        else doeWisselProfiel(p);
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
                        <strong>Klaargezet door je trajectbegeleider.</strong> De klasgroepen
                        en periode zijn al ingesteld — kies meteen je vakken in het
                        werkblad. Je hoeft niets in de instellingen aan te passen.
                    </div>
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
                        colorOf={colorOf}
                        preview={klasgroepPreview}
                    />
                </div>
            )}
        </div>
        </div>

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

        {dialoog?.soort === 'profielWissel' && (
            <BevestigDialog
                titel={`Overschakelen naar "${dialoog.profiel.naam}"?`}
                bericht={
                    <>
                        Je klasgroepen, periode-indeling en grensdatums worden vervangen door die
                        van <strong>{dialoog.profiel.naam}</strong> ({profielSamenvatting(dialoog.profiel.settings)}).
                        {traject.length > 0 ? (
                            <>
                                {' '}
                                {traject.length === 1
                                    ? 'Het gekozen OLOD wordt'
                                    : `De ${traject.length} gekozen OLODs worden`}{' '}
                                daarbij <strong>gewist</strong> — die keuzes horen bij de
                                klasgroepen en periodes van je huidige set.
                                {nietBewaard &&
                                    ' Je huidige werk is niet bewaard in een dossier.'}
                            </>
                        ) : (
                            ' Je studenttraject is leeg, dus daar gaat niets verloren.'
                        )}
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
                itemsKop={traject.length > 0 ? 'Wordt gewist' : undefined}
                items={traject.length > 0 ? resetItems : undefined}
                bevestigLabel="Overschakelen"
                danger={traject.length > 0}
                onBevestig={() => doeWisselProfiel(dialoog.profiel)}
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
