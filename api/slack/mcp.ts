import type { IncomingMessage, ServerResponse } from "node:http";
import { handleSlackMcpHttp } from "../../src/http-handler.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleSlackMcpHttp(req, res);
}
