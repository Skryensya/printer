import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { pickLang } from "~/lib/i18n";

// Server-side language negotiation: read the visitor's Accept-Language and pick
// es/en. Spanish is the default. The browser sends Accept-Language on the
// server-function request too, so this also works on client navigations.
const detectLangFn = createServerFn({ method: "GET" }).handler(() =>
  pickLang(getRequestHeader("accept-language")),
);

// `/` is just a doorway — it forwards to the localized page so every real view
// has a stable, shareable locale URL (/es, /en).
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const lang = await detectLangFn();
    throw redirect({ to: lang === "en" ? "/en" : "/es" });
  },
});
