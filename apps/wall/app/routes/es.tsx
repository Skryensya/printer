import { createFileRoute } from "@tanstack/react-router";
import { fetchWallFn } from "~/api";
import { WallApp } from "~/wall-app";
import { dict } from "~/lib/i18n";

export const Route = createFileRoute("/es")({
  head: () => ({
    meta: [
      { title: dict.es.title },
      { name: "description", content: dict.es.description },
    ],
  }),
  loader: () => fetchWallFn(),
  component: EsPage,
});

function EsPage() {
  return <WallApp lang="es" initial={Route.useLoaderData()} />;
}
