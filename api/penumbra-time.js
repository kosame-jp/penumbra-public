export default function handler(request, response) {
  void request;
  const serverUtcMs = Date.now();
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Date", new Date(serverUtcMs).toUTCString());
  response.status(200).json({
    serverUtcIso: new Date(serverUtcMs).toISOString(),
    serverUtcMs,
  });
}
