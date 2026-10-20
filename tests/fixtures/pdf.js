export function buildMinimalPdf(pageCount = 2) {
  const chunks = [];
  const add = (str) => chunks.push(Buffer.from(str, "latin1"));
  add("%PDF-1.4\n");
  const offsets = [];

  offsets.push(Buffer.concat(chunks).length);
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  const kids = [];
  for (let i = 0; i < pageCount; i += 1) kids.push(`${3 + i} 0 R`);
  offsets.push(Buffer.concat(chunks).length);
  add(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>\nendobj\n`);

  for (let i = 0; i < pageCount; i += 1) {
    offsets.push(Buffer.concat(chunks).length);
    add(`${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources <<>> >>\nendobj\n`);
  }

  const startxref = Buffer.concat(chunks).length;
  add(`xref\n0 ${3 + pageCount}\n0000000000 65535 f \n`);
  for (const off of offsets) {
    add(`${String(off).padStart(10, "0")} 00000 n \n`);
  }
  add(`trailer\n<< /Size ${3 + pageCount} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

export const MINIMAL_PDF_BUFFER = buildMinimalPdf(2);
export const MINIMAL_PDF_BASE64 = MINIMAL_PDF_BUFFER.toString("base64");
