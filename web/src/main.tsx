import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Models from "./pages/Models";
import Builds from "./pages/Builds";
import Studio from "./pages/Studio";
import "./styles.css";

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "models", element: <Models /> },
      { path: "builds", element: <Builds /> },
      { path: "studio", element: <Studio /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><RouterProvider router={router} /></React.StrictMode>,
);
