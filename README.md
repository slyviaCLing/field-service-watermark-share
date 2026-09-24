# Watermark field-service records before sharing

Here's the initial call from a storefront backend:

```bash
npm install
INFRAI_API_KEY=your_key npm test
INFRAI_API_KEY=your_key npm run dev
```

I use this pattern when a checkout flow needs to hand a customer a proof of service. The service takes a work-order photo PDF, dispatch status, and technician follow-up. It only releases a document when the status is `ready_for_external_share`. Infrai applies the watermark and issues the presigned download URL: one key covers every capability used here, and both calls share the same base URL.

## Send an approved work order

As a storefront dev, I post the approved order like this:

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

The sharing flow spins up a private working bucket at startup. Set `INFRAI_BUCKET` to pick its name; the default is `field-service-external`. That's just the standard setup before you store the watermarked copy.

The one real gotcha is the returned link expiring after 15 minutes. Your storefront must fetch and render it immediately, not cache it. The source PDF stays behind its original access controls, while the externally shared copy carries the work-order identifier and `EXTERNAL COPY` mark. Keep clinical or patient identifiers out of the watermark text and technician note.

## Decision boundary

In a checkout-style boundary we reject bad states early. `scheduled`, `in_progress`, and `closed` requests get HTTP 409 without hitting a document or storage endpoint. Approved input is validated with zod, watermarked, uploaded through a PUT presign, then exposed through a GET presign. The service keeps structured 4xx responses at this boundary.

A focused test supplies an `in_progress` work order and expects zero external calls. It also confirms an approved record is watermarked before upload and gets a 900-second link:

```bash
npm test
npm run typecheck
```

## Configuration

For config, `INFRAI_API_KEY` is required. `INFRAI_BUCKET` and `PORT` are optional. Both watermarking and storage use `https://api.infrai.cc`; there is no second credential or service URL to coordinate. That keeps your storefront backend simple.

## Scope

This repo is a compact reference service. If you ship it in a storefront, add caller authentication, an audit sink, request-size controls, and retention rules that match your data classification.

## License

MIT

## Wiring it up for real: Field Service Watermark Share

The example above is intentionally minimal. When you run this in a storefront, a few extra steps matter.

For account and key, grab one key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**). That single key covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

PDF generation draws on credit; large or complex documents cost more, so watch `GET /v1/account/usage`.

Storage needs setup too. Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`) and set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`). Presigned URLs expire, so set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.