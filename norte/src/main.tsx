import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider, useAuth } from "./lib/auth";
import { AuthPage } from "./pages/AuthPage";
import { LandingPage } from "./pages/LandingPage";
import { PlansPage } from "./pages/PlansPage";
import { UsageTelemetry } from "./lib/usageTelemetry";
import { getStoredLanguage } from "./lib/i18n";
import { applyTheme, getStoredTheme, ThemeProvider } from "./lib/theme";
import "./styles.css";
import "./workspace.css";
import "./polish.css";
import "./home-artwork.css";
import "./setup-memory-readability.css";
import "./brainstorm-readability.css";
import "./brainstorm-controls.css";
import "./brainstorm-lab.css";
import "./conception-workspace.css";
import "./project-areas.css";
import "./auth.css";
import "./workspace-ui.css";
import "./theme.css";
import "./compact-workspace.css";

applyTheme(getStoredTheme());

function Root() {
  const auth = useAuth();
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => { const change = () => setHash(window.location.hash); window.addEventListener("hashchange", change); return () => window.removeEventListener("hashchange", change); }, []);
  useEffect(() => { document.body.classList.toggle("public-view", auth.status !== "authenticated"); return () => document.body.classList.remove("public-view"); }, [auth.status]);
  const page = auth.status === "authenticated" ? <App /> : auth.status === "anonymous" && ["", "#/", "#"].includes(hash) ? <LandingPage /> : auth.status === "anonymous" && hash === "#/plans" ? <PlansPage language={getStoredLanguage()} /> : <AuthPage />;
  return <><UsageTelemetry />{page}</>;
}

const root = document.getElementById("root");

if (!root) throw new Error("Norte root element was not found.");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider><AuthProvider>
      <Root />
    </AuthProvider></ThemeProvider>
  </StrictMode>
);
