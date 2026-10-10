/**
 * Minimal PDF writer for test fixtures. Produces real, parseable PDF 1.4 files with one text
 * line per entry, so ingestion tests exercise the production parser on genuine PDF bytes rather
 * than on a mocked parse result. Test-only: never used to handle uploaded documents.
 */
export type FixturePage = string[];

function escapePdfText(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildPdf(pages: FixturePage[], options: { title?: string } = {}): Uint8Array {
	const objects: string[] = [];
	const add = (body: string) => {
		objects.push(body);
		return objects.length;
	};
	const catalogId = add("");
	const pagesId = add("");
	const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
	const pageIds: number[] = [];
	for (const lines of pages) {
		const ops = ["BT", "/F1 11 Tf", "14 TL", "56 760 Td"];
		for (const line of lines) ops.push(`(${escapePdfText(line)}) Tj T*`);
		ops.push("ET");
		const stream = ops.join("\n");
		const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
		pageIds.push(
			add(
				`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
			),
		);
	}
	objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
	objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
	const infoId = options.title ? add(`<< /Title (${escapePdfText(options.title)}) >>`) : undefined;

	let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
	const offsets: number[] = [];
	objects.forEach((body, index) => {
		offsets.push(Buffer.byteLength(out, "latin1"));
		out += `${index + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = Buffer.byteLength(out, "latin1");
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R${infoId ? ` /Info ${infoId} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
	return new Uint8Array(Buffer.from(out, "latin1"));
}
