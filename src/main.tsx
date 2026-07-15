import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./App.css";
import Workspace from "./Workspace";
createRoot(document.getElementById("root")!).render(<StrictMode><Workspace/></StrictMode>);
