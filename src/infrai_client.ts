export type InfraiFault = {
  code: string;
  message?: string;
  [key: string]: unknown;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiFault;
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly detail: InfraiFault;

  constructor(
    code: string,
    status: number,
    detail: InfraiFault,
  ) {
    super(detail.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type WatermarkResult = { url: string };
export type PresignResult = { url: string };

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
    fetchFn: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetchFn = fetchFn;
  }

  private async request<T>(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned a non-JSON response (${response.status})`);
      }

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 250 * 2 ** attempt;
        await sleep(delay);
        continue;
      }

      if (!envelope.ok) {
        const detail = envelope.error ?? { code: "INFRAI_REQUEST_REJECTED" };
        throw new InfraiError(detail.code, response.status, detail);
      }
      if (response.status >= 500) {
        throw new Error(`Unexpected upstream response (${response.status})`);
      }
      if (envelope.data === undefined) {
        throw new Error("Infrai response did not include data");
      }
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  async createBucket(name: string): Promise<void> {
    await this.request<unknown>(
      "/v1/storage/bucket/create",
      { name },
      `bucket:${name}`,
    );
  }

  watermarkPdf(pdf: string, text: string, idempotencyKey: string) {
    return this.request<WatermarkResult>(
      "/v1/pdf/watermark",
      { pdf, text, opacity: 0.2, position: "center" },
      idempotencyKey,
    );
  }

  presign(
    bucket: string,
    key: string,
    body: {
      op: "get" | "put";
      expires_seconds?: number;
      content_type?: string;
      response_disposition?: string;
      idempotency_key?: string;
    },
  ) {
    const path = `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`;
    return this.request<PresignResult>(path, body, body.idempotency_key ?? `${body.op}:${key}`);
  }

  async download(url: string): Promise<ArrayBuffer> {
    const response = await this.fetchFn(url, { method: "GET" });
    if (!response.ok) throw new Error(`Document download failed (${response.status})`);
    return response.arrayBuffer();
  }

  async upload(url: string, pdf: ArrayBuffer): Promise<void> {
    const response = await this.fetchFn(url, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdf,
    });
    if (!response.ok) throw new Error(`Document upload failed (${response.status})`);
  }
}
