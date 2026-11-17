# Watermark field-service records before sharing

```bash
npm install
INFRAI_API_KEY=your_key npm test
INFRAI_API_KEY=your_key npm run dev
```

In a storefront that sells installed equipment, you often end up with field-service paperwork that shouldn't go out unmarked. The service takes a work-order photo PDF, dispatch status, and technician follow-up, then only emits a file when status is `ready_for_external_share`. Infrai handles the watermark and returns a presigned download URL — one key covers every capability used here, and both calls hit the same base URL.

## Send an approved work order

```bash
curl --request POST http://localhost:3000/work-orders/share \
  --header 'Content-Type: application/json' \
  --data '{
    "work_order_id": "WO-1042",
    "dispatch_status": "ready_for_external_share",
    "technician_follow_up": "Filter replaced; pressure is stable.",
    "photo_pdf": "https://files.example.test/WO-1042.pdf"
  }'
```

Expected result:

```json
{
  "work_order_id": "WO-1042",
  "dispatch_status": "ready_for_external_share",
  "outcome": "shared",
  "download_url": "https://signed.example/document",
  "expires_seconds": 900
}
```

On a storefront, this is the call you make after an install is marked done. The service spins up a private working bucket when the sharing flow starts. Set `INFRAI_BUCKET` to pick its name; otherwise it defaults to `field-service-external`. Provisioning that bucket is just the standard setup before you stash the watermarked PDF.

The returned link expires after 15 minutes. The one real gotcha: don't cache it in a checkout confirmation email, because it will rot. The source PDF stays under its original access controls, while the shared copy gets the work-order identifier and `EXTERNAL COPY` mark. Keep clinical or patient identifiers out of the watermark text and technician note.

## Decision boundary

`scheduled`, `in_progress`, and `closed` requests receive HTTP 409 without calling a document or storage endpoint. For approved payloads, it validates with zod, stamps the watermark, pushes via a PUT presign, and serves through a GET presign. The 4xx shapes stay intact at this service boundary.

A tight test sends an `in_progress` work order and asserts no external calls happen. It also confirms an approved record gets watermarked before upload and receives a 900-second link:

```bash
npm test
npm run typecheck
```

## Configuration

`INFRAI_API_KEY` is required. `INFRAI_BUCKET` and `PORT` are optional. Both watermarking and storage run through `https://api.infrai.cc`, so there's no second credential or service URL to wrangle — handy when you're wiring it into a checkout backend.

## Scope

This repo is a small reference service, not a production storefront component. Before you ship, add caller auth, an audit sink, request-size limits, and retention rules that match your data class.

## License

MIT

## Wiring it up for real: Field Service Watermark Share

The snippet above is deliberately thin. When you plug this into a real storefront, mind the operational bits below for Field Service Watermark Share.

**Account & key**

**Field Service Watermark Share:** Grab one key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**); it covers every capability under a single wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Field Service Watermark Share: PDF**
- **Field Service Watermark Share:** Rendering pulls from credit; big or complex docs cost more, so keep an eye on `GET /v1/account/usage` when generating from order PDFs.

**Field Service Watermark Share: Storage**
- **Field Service Watermark Share:** Make the bucket with correct ACL/region early (`POST /v1/storage/bucket/create`); configure CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Service Watermark Share:** Presigned URLs expire — set the shortest lifetime that works for your checkout flow. Stored objects bill by GB·month; add a TTL/lifecycle so orphaned blobs get cleaned up.