// Extrai o texto de um DANFE em PDF digital, no navegador. Chame só em evento de usuário.
export async function textoDoPdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const paginas: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 20); p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // agrupa por linha (posição vertical) para manter as colunas da tabela
    const linhas = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5] ?? 0);
      const arr = linhas.get(y) ?? [];
      arr.push({ x: it.transform[4] ?? 0, s: it.str });
      linhas.set(y, arr);
    }
    const ordenadas = [...linhas.entries()].sort((a, b) => b[0] - a[0]);
    paginas.push(
      ordenadas
        .map(([, l]) =>
          l
            .sort((a, b) => a.x - b.x)
            .map((i) => i.s)
            .join(" | "),
        )
        .join("\n"),
    );
  }
  const texto = paginas.join("\n\n").trim();
  if (texto.length < 100) {
    throw new Error(
      "Esse PDF não tem texto (parece foto ou escaneado). Use o PDF digital ou o XML da nota.",
    );
  }
  return texto;
}
