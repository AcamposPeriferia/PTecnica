import { getEvaluations } from "@/application/evaluations";
import { Dashboard } from "@/components/dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const evaluations = await getEvaluations();
  return <Dashboard evaluations={evaluations} />;
}
