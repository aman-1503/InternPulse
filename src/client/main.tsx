import React from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
