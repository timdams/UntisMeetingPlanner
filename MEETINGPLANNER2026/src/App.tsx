import { useState } from "react";
import "./App.css";
import { Login } from "./components/Login";
import { AppChoice } from "./components/AppChoice";
import { PlannerDashboard } from "./components/Planner/PlannerDashboard";

type View = 'choice' | 'meeting' | 'traject';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [view, setView] = useState<View>('choice');

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
      {view === 'meeting' && <PlannerDashboard />}
      {view === 'traject' && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Traject Planner</h2>
          <p>Deze functie wordt later toegevoegd.</p>
          <button onClick={() => setView('choice')}>Terug</button>
        </div>
      )}
    </div>
  );
}

export default App;
