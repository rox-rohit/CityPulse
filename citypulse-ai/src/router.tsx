import { createBrowserRouter } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import DigitalTwin from "./pages/DigitalTwin";
import Traffic from "./pages/Traffic";
import Environment from "./pages/Environment";
import CivicIssues from "./pages/CivicIssues";
import ScenarioLab from "./pages/ScenarioLab";
import AIAnalyst from "./pages/AIAnalyst";
import Methodology from "./pages/Methodology";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <LandingPage />,
  },
  {
    path: "/digital-twin",
    element: <DigitalTwin />,
  },
  {
    path: "/traffic",
    element: <Traffic />,
  },
  {
    path: "/environment",
    element: <Environment />,
  },
  {
    path: "/civic-issues",
    element: <CivicIssues />,
  },
  {
    path: "/scenario-lab",
    element: <ScenarioLab />,
  },
  {
    path: "/ai-analyst",
    element: <AIAnalyst />,
  },
  {
    path: "/methodology",
    element: <Methodology />,
  },
]);