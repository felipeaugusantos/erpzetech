import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIMITE_ANEXO_BYTES,
  erroDoArquivo,
  formatarTamanho,
  mimeDoArquivo,
} from "../src/lib/anexos.ts";

describe("mimeDoArquivo", () => {
  it("aceita JPEG, PNG e PDF", () => {
    assert.equal(mimeDoArquivo({ name: "a.jpg", type: "image/jpeg" }), "image/jpeg");
    assert.equal(mimeDoArquivo({ name: "a.png", type: "image/png" }), "image/png");
    assert.equal(mimeDoArquivo({ name: "a.pdf", type: "application/pdf" }), "application/pdf");
  });
  it("usa a extensão só quando o navegador não informa o formato", () => {
    assert.equal(mimeDoArquivo({ name: "RX.JPEG", type: "" }), "image/jpeg");
    assert.equal(mimeDoArquivo({ name: "laudo.pdf", type: "" }), "application/pdf");
    assert.equal(mimeDoArquivo({ name: "laudo.pdf", type: "application/zip" }), null);
    assert.equal(mimeDoArquivo({ name: "imagem.dcm", type: "application/dicom" }), null);
    assert.equal(mimeDoArquivo({ name: "semextensao", type: "" }), null);
  });
});

describe("formatarTamanho", () => {
  it("mostra B, KB e MB", () => {
    assert.equal(formatarTamanho(500), "500 B");
    assert.equal(formatarTamanho(2048), "2 KB");
    assert.equal(formatarTamanho(5 * 1024 * 1024 + 512 * 1024), "5,5 MB");
  });
});

describe("erroDoArquivo", () => {
  const ok = { name: "ultra.png", size: 1000, type: "image/png" };
  it("arquivo válido passa", () => {
    assert.equal(erroDoArquivo(ok), null);
    assert.equal(erroDoArquivo({ ...ok, size: LIMITE_ANEXO_BYTES }), null);
  });
  it("recusa vazio, grande demais e formato errado", () => {
    assert.match(erroDoArquivo({ ...ok, size: 0 }) ?? "", /vazio/);
    assert.match(erroDoArquivo({ ...ok, size: LIMITE_ANEXO_BYTES + 1 }) ?? "", /15 MB/);
    assert.match(erroDoArquivo({ ...ok, type: "application/zip", name: "a.zip" }) ?? "", /Formato/);
  });
  it("recusa nome grande demais", () => {
    assert.match(erroDoArquivo({ ...ok, name: "a".repeat(121) + ".png" }) ?? "", /Nome/);
  });
});
