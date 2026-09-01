import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpHttp } from "../src/http-handler.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleMcpHttp(req, res);
}
