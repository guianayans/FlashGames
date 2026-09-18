import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { RemoteControlProvider } from "./remoteControl/RemoteControlContext";
import { RegisterServiceWorker } from "./components/RegisterServiceWorker";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* Acima do <App/> (que tem as rotas) de proposito — a conexao do
            controle remoto (ver RemoteControlContext) precisa sobreviver
            trocar de Biblioteca pra Player e vice-versa, nao pode remontar
            a cada navegacao. */}
        <RemoteControlProvider>
          <RegisterServiceWorker />
          <App />
        </RemoteControlProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
