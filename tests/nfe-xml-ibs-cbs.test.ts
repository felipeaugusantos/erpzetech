import assert from "node:assert/strict";
import { test } from "node:test";
import { ibsCbsDaNota, ibsCbsDoItem } from "../src/lib/nfe-xml.ts";

// O Node não tem DOMParser; este mini leitor de XML basta para a parte da API que o código usa
// (getElementsByTagName em ordem de documento, textContent). Sem atributos e sem namespaces.
type No = { tag: string; filhos: No[]; texto: string };

function ler(xml: string): No {
  const raiz: No = { tag: "#raiz", filhos: [], texto: "" };
  const pilha = [raiz];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9]+)[^>]*>|([^<]+)/g)) {
    const topo = pilha[pilha.length - 1]!;
    if (m[3] !== undefined) {
      topo.texto += m[3].trim();
    } else if (m[1] === "/") {
      pilha.pop();
    } else {
      const n: No = { tag: m[2]!, filhos: [], texto: "" };
      topo.filhos.push(n);
      pilha.push(n);
    }
  }
  return raiz.filhos[0]!;
}

function comoElemento(n: No): Element {
  const todos = (no: No): No[] => no.filhos.flatMap((f) => [f, ...todos(f)]);
  const el = {
    getElementsByTagName: (tag: string) =>
      todos(n)
        .filter((x) => x.tag === tag)
        .map(comoElemento),
    get textContent() {
      return n.texto;
    },
  };
  return el as unknown as Element;
}

const imposto = (conteudo: string) => comoElemento(ler(`<imposto>${conteudo}</imposto>`));

test("ibsCbsDoItem lê CST, classificação e valores do grupo gIBSCBS", () => {
  const el = imposto(`
    <IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib>
      <gIBSCBS><vBC>1000.00</vBC>
        <gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>1.00</vIBSUF></gIBSUF>
        <gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun>
        <vIBS>1.00</vIBS>
        <gCBS><pCBS>0.9000</pCBS><vCBS>9.00</vCBS></gCBS>
      </gIBSCBS>
    </IBSCBS>`);
  assert.deepEqual(ibsCbsDoItem(el), {
    cst: "000",
    cclasstrib: "000001",
    base: 1000,
    ibs_uf: 1,
    ibs_mun: 0,
    ibs: 1,
    cbs: 9,
  });
});

test("ibsCbsDoItem: sem IBSCBS devolve null (nota anterior à reforma)", () => {
  assert.equal(ibsCbsDoItem(imposto("<ICMS><ICMS00><vBC>10</vBC></ICMS00></ICMS>")), null);
  assert.equal(ibsCbsDoItem(null), null);
});

test("ibsCbsDoItem: CST sem grupo de valores fica com valores zerados", () => {
  const r = ibsCbsDoItem(imposto("<IBSCBS><CST>410</CST><cClassTrib>410004</cClassTrib></IBSCBS>"));
  assert.deepEqual(r, {
    cst: "410",
    cclasstrib: "410004",
    base: 0,
    ibs_uf: 0,
    ibs_mun: 0,
    ibs: 0,
    cbs: 0,
  });
});

test("ibsCbsDoItem não confunde o IBS/CBS transferido (CST 800) com tributo destacado", () => {
  const r = ibsCbsDoItem(
    imposto(`<IBSCBS><CST>800</CST><cClassTrib>800001</cClassTrib>
      <gTransfCred><vIBS>50.00</vIBS><vCBS>70.00</vCBS></gTransfCred></IBSCBS>`),
  );
  assert.equal(r!.ibs, 0);
  assert.equal(r!.cbs, 0);
  assert.equal(r!.cst, "800");
});

test("ibsCbsDoItem ignora os campos de tributação regular, que têm outros nomes", () => {
  const r = ibsCbsDoItem(
    imposto(`<IBSCBS><CST>550</CST><cClassTrib>550001</cClassTrib>
      <gIBSCBS><vBC>200.00</vBC>
        <gIBSUF><pIBSUF>0.0000</pIBSUF><vIBSUF>0.00</vIBSUF></gIBSUF>
        <gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun>
        <vIBS>0.00</vIBS><gCBS><pCBS>0.0000</pCBS><vCBS>0.00</vCBS></gCBS>
        <gTribRegular><CSTReg>000</CSTReg><cClassTribReg>000001</cClassTribReg>
          <vTribRegIBSUF>0.20</vTribRegIBSUF><vTribRegCBS>1.80</vTribRegCBS></gTribRegular>
      </gIBSCBS></IBSCBS>`),
  );
  assert.equal(r!.cst, "550");
  assert.equal(r!.cclasstrib, "550001");
  assert.equal(r!.ibs, 0);
  assert.equal(r!.cbs, 0);
  assert.equal(r!.base, 200);
});

test("ibsCbsDaNota lê o total IBSCBSTot com o crédito presumido separado", () => {
  const inf = comoElemento(
    ler(`<infNFe><total><ICMSTot><vBC>1</vBC></ICMSTot>
      <IBSCBSTot><vBCIBSCBS>1000.00</vBCIBSCBS>
        <gIBS><gIBSUF><vDif>0</vDif><vDevTrib>0</vDevTrib><vIBSUF>1.00</vIBSUF></gIBSUF>
              <gIBSMun><vDif>0</vDif><vDevTrib>0</vDevTrib><vIBSMun>0.50</vIBSMun></gIBSMun>
              <vIBS>1.50</vIBS><vCredPres>0.25</vCredPres><vCredPresCondSus>0</vCredPresCondSus></gIBS>
        <gCBS><vDif>0</vDif><vDevTrib>0</vDevTrib><vCBS>9.00</vCBS><vCredPres>0.75</vCredPres><vCredPresCondSus>0</vCredPresCondSus></gCBS>
      </IBSCBSTot></total></infNFe>`),
  );
  assert.deepEqual(ibsCbsDaNota(inf), {
    base: 1000,
    ibs_uf: 1,
    ibs_mun: 0.5,
    ibs: 1.5,
    cbs: 9,
    cred_pres_ibs: 0.25,
    cred_pres_cbs: 0.75,
  });
});

test("ibsCbsDaNota: sem IBSCBSTot devolve null", () => {
  assert.equal(
    ibsCbsDaNota(
      comoElemento(ler("<infNFe><total><ICMSTot><vNF>1</vNF></ICMSTot></total></infNFe>")),
    ),
    null,
  );
  assert.equal(ibsCbsDaNota(null), null);
});
