import { useState, useEffect } from "react";
import "./App.css";
import { Login } from "./components/Login";
import { AppChoice } from "./components/AppChoice";
import { PlannerDashboard } from "./components/Planner/PlannerDashboard";
import { TrajectPlanner } from "./components/Traject/TrajectPlanner";
import { applyTrajectSettingsPreset, runTrajectMigrations } from "./components/Traject/hooks";
import { clearTrajectPresetFromUrl, readTrajectPresetFromUrl } from "./components/Traject/trajectShare";
import { untisService } from "./services/UntisService";

type View = 'choice' | 'meeting' | 'traject';

const VIEW_KEY = 'untis_current_view';

function readStoredView(): View {
  try {
    const v = sessionStorage.getItem(VIEW_KEY);
    if (v === 'meeting' || v === 'traject' || v === 'choice') return v;
  } catch { /* ignore */ }
  return 'choice';
}

// Eenmalige opkuis van opgeslagen traject-data (o.a. de klasgroep-shortlist van
// het vorige academiejaar wissen). Moet vóór de preset draaien, zodat een verse
// trajectbegeleider-link de klasgroepen van het nieuwe jaar wél mag invullen.
runTrajectMigrations();

// Een trajectbegeleider kan een student een link sturen met de klasgroep-shortlist
// en semesterperiode al ingevuld. Verbruik die preset één keer bij het laden van
// de module — vóór React rendert — zodat de instellingen-hook de juiste waarden
// meteen inleest en de student rechtstreeks in het werkblad belandt.
const INITIAL_PRESET = readTrajectPresetFromUrl();
if (INITIAL_PRESET) {
  applyTrajectSettingsPreset(INITIAL_PRESET);
  clearTrajectPresetFromUrl();
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [view, setView] = useState<View>(() => (INITIAL_PRESET ? 'traject' : readStoredView()));
  // null = nog aan het controleren, true/false = resultaat van de rechtencheck.
  const [meetingAvailable, setMeetingAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    untisService.restoreSession()
      .then(ok => { if (!cancelled && ok) setIsAuthenticated(true); })
      .finally(() => { if (!cancelled) setIsRestoring(false); });
    return () => { cancelled = true; };
  }, []);

  // Na login: controleer of dit account de Meeting Planner mag gebruiken.
  // Studentaccounts hebben geen rechten op de TEACHER-roosterfilter (403 FORBIDDEN);
  // voor hen wordt de Meeting Planner als onbeschikbaar getoond en blijft enkel
  // de Traject Planner bruikbaar.
  useEffect(() => {
    if (!isAuthenticated) { setMeetingAvailable(null); return; }
    let cancelled = false;
    untisService.checkMeetingPlannerAccess()
      .then(ok => { if (!cancelled) setMeetingAvailable(ok); })
      .catch(() => { if (!cancelled) setMeetingAvailable(true); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Een student kan nog 'meeting' uit een vorige sessie hebben staan — stuur terug.
  useEffect(() => {
    if (meetingAvailable === false && view === 'meeting') setView('choice');
  }, [meetingAvailable, view]);

  const handleLogout = () => {
    untisService.logout();
    setIsAuthenticated(false);
    setMeetingAvailable(null);
    setView('choice');
  };

  if (isRestoring) {
    return <div className="container" />;
  }

  if (!isAuthenticated) {
    return (
      <div className="container">
        <Login onLoginSuccess={() => setIsAuthenticated(true)} />
      </div>
    );
  }

  return (
    <div className="container">
      {view === 'choice' && (
        <AppChoice
          meetingAvailable={meetingAvailable}
          onSelect={(choice) => setView(choice)}
          onLogout={handleLogout}
        />
      )}
      {view === 'meeting' && meetingAvailable !== false && <PlannerDashboard onBack={() => setView('choice')} />}
      {view === 'traject' && (
        <TrajectPlanner onBack={() => setView('choice')} presetApplied={INITIAL_PRESET !== null} />
      )}
    </div>
  );
}

export default App;
