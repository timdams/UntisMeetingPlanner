import { useState } from "react";
import "./App.css";
import { Login } from "./components/Login";
import { AppChoice } from "./components/AppChoice";
import { PlannerDashboard } from "./components/Planner/PlannerDashboard";
import { TrajectPlanner } from "./components/Traject/TrajectPlanner";

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
      {view === 'meeting' && <PlannerDashboard onBack={() => setView('choice')} />}
      {view === 'traject' && <TrajectPlanner onBack={() => setView('choice')} />}
    </div>
  );
}

export default App;
