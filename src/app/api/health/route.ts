export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      ok: true,
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-5.5",
      configured: Boolean(process.env.OPENAI_API_KEY),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
