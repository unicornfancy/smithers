import { redirect } from "next/navigation";

import { requireConfiguredVault } from "@/lib/server/require-setup";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireConfiguredVault();
  redirect("/today");
}
