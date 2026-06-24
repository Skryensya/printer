import { createFileRoute } from "@tanstack/react-router";
import { fetchWallFn } from "~/api";
import { WallApp } from "~/wall-app";
import { dict } from "~/lib/i18n";

export const Route = createFileRoute("/en")({
  head: () => ({
    meta: [
      { title: dict.en.title },
      { name: "description", content: dict.en.description },
    ],
  }),
  loader: () => fetchWallFn(),
  component: EnPage,
});

function EnPage() {
  return <WallApp lang="en" initial={Route.useLoaderData()} />;
}
