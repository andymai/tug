import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { backend } from "./backend";
import { createDownloadsStore } from "./state/downloads";
import "./styles/app.css";

const store = createDownloadsStore(backend);
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App store={store} />
    </StrictMode>,
  );
}
