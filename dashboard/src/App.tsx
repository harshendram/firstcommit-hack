import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { CommandCenter } from "./pages/CommandCenter";
import { PatientSimulator } from "./pages/PatientSimulator";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CommandCenter />} />
        <Route path="/patient" element={<PatientSimulator />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
