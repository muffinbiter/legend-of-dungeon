// Legend of Dungeon: OpenAI 중계 함수 (Vercel Serverless Function)
// - OpenAI 키는 Vercel 환경변수 OPENAI_API_KEY 에만 저장된다. 브라우저로는 절대 내려가지 않는다.
// - 브라우저는 X-Access-Code 헤더로 접속 코드(환경변수 ACCESS_CODE)를 보내야 한다.
// - 허용 경로와 모델을 제한해서 키가 다른 용도로 쓰이지 않게 한다.

const ALLOWED_PATHS = ["chat/completions", "moderations"];
const ALLOWED_MODELS = (process.env.ALLOWED_MODELS || "gpt-4o-mini,gpt-4o,omni-moderation-latest")
  .split(",").map(function (m) { return m.trim(); }).filter(Boolean);
const MAX_BODY = 60000; // 글자 수 기준 요청 크기 상한

module.exports = async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const code = req.headers["x-access-code"] || "";
  if (!process.env.ACCESS_CODE || code !== process.env.ACCESS_CODE) {
    res.status(401).json({ error: "invalid access code" }); return;
  }
  if (!process.env.OPENAI_API_KEY) { res.status(500).json({ error: "server key missing" }); return; }

  const path = String(req.query.path || "");
  if (ALLOWED_PATHS.indexOf(path) < 0) { res.status(400).json({ error: "path not allowed" }); return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const raw = JSON.stringify(body);
  if (raw.length > MAX_BODY) { res.status(413).json({ error: "request too large" }); return; }
  if (body.model && ALLOWED_MODELS.indexOf(body.model) < 0) {
    res.status(400).json({ error: "model not allowed: " + body.model }); return;
  }

  const upstream = await fetch("https://api.openai.com/v1/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + process.env.OPENAI_API_KEY },
    body: raw
  });

  res.status(upstream.status);
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.setHeader("Cache-Control", "no-store");

  // 스트리밍 응답(엔딩 에필로그)은 그대로 흘려보낸다
  if (body.stream && upstream.body) {
    const reader = upstream.body.getReader();
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      res.write(Buffer.from(r.value));
    }
    res.end();
    return;
  }
  res.send(Buffer.from(await upstream.arrayBuffer()));
};
