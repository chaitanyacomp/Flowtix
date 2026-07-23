/**
 * XHR FormData upload with real upload progress (fetch cannot report upload %).
 */

export type XhrUploadProgress = {
  loaded: number;
  total: number;
  percentOfUpload: number;
};

export type XhrUploadResult = {
  ok: boolean;
  status: number;
  json: unknown;
};

export type XhrUploadOptions = {
  url: string;
  formData: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal | null;
  onUploadProgress?: (p: XhrUploadProgress) => void;
};

export function xhrFormDataUpload(opts: XhrUploadOptions): Promise<XhrUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", opts.url, true);
    const headers = opts.headers || {};
    for (const [k, v] of Object.entries(headers)) {
      if (v != null && v !== "") xhr.setRequestHeader(k, v);
    }

    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
        return;
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    xhr.upload.onprogress = (ev) => {
      if (!opts.onUploadProgress) return;
      const total = ev.lengthComputable ? ev.total : 0;
      const loaded = ev.loaded;
      const percentOfUpload =
        total > 0 ? Math.round((loaded / total) * 100) : 0;
      opts.onUploadProgress({ loaded, total, percentOfUpload });
    };

    xhr.onerror = () => {
      reject(new Error("Network error while uploading the Tally XML file."));
    };

    xhr.onload = () => {
      let json: unknown = {};
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        json = { error: { message: xhr.responseText || `HTTP ${xhr.status}` } };
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
    };

    xhr.send(opts.formData);
  });
}
