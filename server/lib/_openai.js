const DEFAULT_MODEL = process.env.ALTERA_MODEL || "gpt-4o-mini";

export async function createJsonCompletion({ system, messages, maxTokens = 1200 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Altera non e ancora collegata al servizio AI.");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: system }, ...messages]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Servizio AI non disponibile (${response.status}): ${detail.slice(0, 180)}`);
  }

  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content || "{}";
  let content;
  try {
    content = JSON.parse(raw);
  } catch {
    throw new Error("Altera ha restituito una risposta non valida.");
  }

  return {
    content,
    model: payload.model || DEFAULT_MODEL,
    usage: payload.usage || {}
  };
}

