import assert from "node:assert/strict";
import test from "node:test";
import {
  DispatchNotReadyError,
  shareWorkOrder,
  type DocumentGateway,
} from "../src/share_work_order.js";

test("keeps an in-progress work order internal", async () => {
  let externalCalls = 0;
  const gateway = new Proxy({}, {
    get: () => async () => {
      externalCalls += 1;
      return { url: "https://example.test/document" };
    },
  }) as DocumentGateway;

  await assert.rejects(
    shareWorkOrder({
      work_order_id: "WO-1042",
      dispatch_status: "in_progress",
      technician_follow_up: "Replace filter before release.",
      photo_pdf: "https://files.example.test/WO-1042.pdf",
    }, gateway, "field-service-external"),
    DispatchNotReadyError,
  );
  assert.equal(externalCalls, 0);
});

test("watermarks and shares an approved work order", async () => {
  const events: string[] = [];
  const gateway: DocumentGateway = {
    async createBucket() { events.push("bucket"); },
    async watermarkPdf(_pdf, text) {
      events.push(text);
      return { url: "https://example.test/watermarked" };
    },
    async download() { events.push("download"); return new ArrayBuffer(4); },
    async upload() { events.push("upload"); },
    async presign(_bucket, _key, body) {
      events.push(`presign:${body.op}`);
      return { url: body.op === "get" ? "https://example.test/signed" : "https://example.test/upload" };
    },
  };

  const result = await shareWorkOrder({
    work_order_id: "WO-1042",
    dispatch_status: "ready_for_external_share",
    technician_follow_up: "Filter replaced; pressure is stable.",
    photo_pdf: "https://files.example.test/WO-1042.pdf",
  }, gateway, "field-service-external");

  assert.equal(result.download_url, "https://example.test/signed");
  assert.equal(result.expires_seconds, 900);
  assert.deepEqual(events, [
    "bucket",
    "WORK ORDER WO-1042 | EXTERNAL COPY",
    "download",
    "presign:put",
    "upload",
    "presign:get",
  ]);
});
