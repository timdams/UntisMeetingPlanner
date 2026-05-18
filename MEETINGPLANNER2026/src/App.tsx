import { useState, useEffect } from "react";
import "./App.css";
import { Login } from "./components/Login";
import { AppChoice } from "./components/AppChoice";
import { PlannerDashboard } from "./components/Planner/PlannerDashboard";
import { TrajectPlanner } from "./components/Traject/TrajectPlanner";
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

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [view, setView] = useState<View>(readStoredView);

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
        <AppChoice onSelect={(choice) => setView(choice)} />
      )}
      {view === 'meeting' && <PlannerDashboard onBack={() => setView('choice')} />}
      {view === 'traject' && <TrajectPlanner onBack={() => setView('choice')} />}
    </div>
  );
}

export default App;
