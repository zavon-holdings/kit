export declare const HEADER_SIGNATURE: "X-Zavon-Signature";
export declare const HEADER_TIMESTAMP: "X-Zavon-Timestamp";
export declare const MAX_SKEW_SECONDS: number;
export declare function sign(secret: string, timestamp: number, body: string | Uint8Array): string;
export declare function header(secrets: string[], timestamp: number, body: string | Uint8Array): string;
export declare function verify(
  secrets: string[],
  signatureHeader: string,
  timestampHeader: string,
  body: string | Uint8Array,
  nowSeconds?: number,
): void;
