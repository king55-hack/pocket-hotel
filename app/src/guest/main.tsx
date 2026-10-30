import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GuestApp } from "./GuestApp";
import "../styles.css";
import "./guest.css";

// The guest page is a plain web page: no sign-in, no saved data, no offline copy of its own.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GuestApp />
  </StrictMode>,
);
