import { createServer } from "node:http";
import { handleMcpHttp } from "./http-handler.js";

const port = Number(process.env.PORT ?? 8787);
createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "runpod-gtm-data" }));
    return;
  }
  if (req.url !== "/mcp") {
    res.writeHead(404); res.end("Not found"); return;
  }
  await handleMcpHttp(req, res);
}).listen(port, () => process.stderr.write(`GTM Data MCP listening on http://127.0.0.1:${port}/mcp\n`));
