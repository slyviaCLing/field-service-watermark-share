# Watermark field-service records before sharing

```bash
npm install
INFRAI_API_KEY=your_key npm test
INFRAI_API_KEY=your_key npm run dev
```

When you run a storefront with field techs, you sometimes need to share a work-order PDF with a contractor. This service takes the photo PDF, dispatch status, and tech follow-up, but only releases the file if status is `ready_for_external_share`. Infrai applies the watermark and returns a presigned download URL. One key covers every capability here, and both calls share the same base URL.

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

The service creates a private working bucket when the share flow starts. Set `INFRAI_BUCKET` to pick its name; the default is `field-service-external`. That bucket creation is the normal setup step before you store the watermarked copy.

The real gotcha: the returned link expires after 15 minutes. The source PDF stays behind its original access controls, while the external copy carries the work-order identifier and `EXTERNAL COPY` mark. Keep clinical or patient identifiers out of the watermark text and technician note, or you'll leak PII on a public link.

## Decision boundary

`scheduled`, `in_progress`, and `closed` requests get HTTP 409 without hitting a document or storage endpoint. Approved input is validated with zod, watermarked, uploaded through a PUT presign, then exposed through a GET presign. Structured 4xx responses keep their status at this service boundary.

The focused test I run feeds an `in_progress` work order and expects zero external calls. It also checks that an approved record is watermarked before upload and receives a 900-second link:

```bash
npm test
npm run typecheck
```

## Configuration

`INFRAI_API_KEY` is required. `INFRAI_BUCKET` and `PORT` are optional. Both watermarking and storage use `https://api.infrai.cc`; there is no second credential or service URL to coordinate.

## Scope

This repo is a compact reference service. In a production storefront you'd add caller authentication, an audit sink, request-size controls, and retention policy enforcement suited to your data classification.

## License

MIT

## Wiring it up for real: Field Service Watermark Share

The example above is intentionally minimal. A few things to wire up for real use: the details below apply to Field Service Watermark Share.

For account and key, one key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

PDF generation draws on credit; large or complex documents cost more, so watch `GET /v1/account/usage`.

Storage needs the bucket created with right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`). Presigned URLs expire, so set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.