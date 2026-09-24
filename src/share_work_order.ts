import { z } from "zod";

export const shareRequestSchema = z.object({
  work_order_id: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  dispatch_status: z.enum(["scheduled", "in_progress", "ready_for_external_share", "closed"]),
  technician_follow_up: z.string().min(1).max(500),
  photo_pdf: z.string().url(),
}).strict();

export type ShareRequest = z.infer<typeof shareRequestSchema>;
export type ShareResult = {
  work_order_id: string;
  dispatch_status: ShareRequest["dispatch_status"];
  outcome: "shared";
  download_url: string;
  expires_seconds: number;
};

export interface DocumentGateway {
  createBucket(name: string): Promise<void>;
  watermarkPdf(pdf: string, text: string, idempotencyKey: string): Promise<{ url: string }>;
  presign(bucket: string, key: string, body: {
    op: "get" | "put";
    expires_seconds?: number;
    content_type?: string;
    response_disposition?: string;
    idempotency_key?: string;
  }): Promise<{ url: string }>;
  download(url: string): Promise<ArrayBuffer>;
  upload(url: string, pdf: ArrayBuffer): Promise<void>;
}

export class DispatchNotReadyError extends Error {}

export async function shareWorkOrder(
  input: ShareRequest,
  gateway: DocumentGateway,
  bucket: string,
): Promise<ShareResult> {
  if (input.dispatch_status !== "ready_for_external_share") {
    throw new DispatchNotReadyError("Work order is not approved for external sharing");
  }

  const objectKey = `work-orders/${input.work_order_id}/external.pdf`;
  const operationId = `work-order:${input.work_order_id}:external-v1`;
  await gateway.createBucket(bucket);
  const watermarked = await gateway.watermarkPdf(
    input.photo_pdf,
    `WORK ORDER ${input.work_order_id} | EXTERNAL COPY`,
    `${operationId}:watermark`,
  );
  const document = await gateway.download(watermarked.url);
  const upload = await gateway.presign(bucket, objectKey, {
    op: "put",
    content_type: "application/pdf",
    idempotency_key: `${operationId}:put`,
  });
  await gateway.upload(upload.url, document);

  const expiresSeconds = 900;
  const download = await gateway.presign(bucket, objectKey, {
    op: "get",
    expires_seconds: expiresSeconds,
    response_disposition: `attachment; filename="work-order-${input.work_order_id}.pdf"`,
    idempotency_key: `${operationId}:get`,
  });

  return {
    work_order_id: input.work_order_id,
    dispatch_status: input.dispatch_status,
    outcome: "shared",
    download_url: download.url,
    expires_seconds: expiresSeconds,
  };
}
