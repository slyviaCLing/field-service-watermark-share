import { createServer } from "node:http";
import { InfraiClient, InfraiError } from "./infrai_client.js";
import {
  DispatchNotReadyError,
  shareRequestSchema,
  shareWorkOrder,
} from "./share_work_order.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

const bucket = process.env.INFRAI_BUCKET ?? "field-service-external";
const port = Number(process.env.PORT ?? 3000);
const infrai = new InfraiClient(apiKey);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/work-orders/share") {
    response.writeHead(404).end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = shareRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      response.writeHead(400).end(JSON.stringify({ error: "Invalid request", issues: parsed.error.issues }));
      return;
    }
    const result = await shareWorkOrder(parsed.data, infrai, bucket);
    response.writeHead(201).end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "Request body must be JSON" }));
    } else if (error instanceof DispatchNotReadyError) {
      response.writeHead(409).end(JSON.stringify({ error: error.message }));
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.message, code: error.code }));
    } else {
      response.writeHead(502).end(JSON.stringify({ error: "Document sharing did not complete" }));
    }
  }
});

server.listen(port, () => console.log(`Field-service share endpoint listening on http://localhost:${port}`));
