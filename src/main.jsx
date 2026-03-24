import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import JobTracker from "../tracker.jsx";

// Stub window.storage so the app works without a native storage API
if (!window.storage) {
  window.storage = {
    get: async (key) => {
      const value = localStorage.getItem(key);
      return value ? { value } : null;
    },
    set: async (key, value) => {
      localStorage.setItem(key, value);
    },
  };
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <JobTracker />
  </StrictMode>
);
