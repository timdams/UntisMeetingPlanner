import { useState } from "react";
import "./App.css";
import { Login } from "./components/Login";
import { PlannerDashboard } from "./components/Planner/PlannerDashboard";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  return (
    <div className="container">
      {!isAuthenticated ? (
        <Login onLoginSuccess={() => setIsAuthenticated(true)} />
      ) : (
        <PlannerDashboard />
      )}
    </div>
  );
}

export default App;
