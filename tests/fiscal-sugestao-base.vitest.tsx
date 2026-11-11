import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LinhaSugestaoBase, PainelSugestaoBase } from "../src/components/app/SugestaoBaseFiscal";
import type { ResumoLote } from "../src/lib/fiscal-lote";
import type { SugestaoFiscal } from "../src/lib/fiscal-sugestao";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
});
async function montar(el: React.ReactElement) {
  await act(async () => {
    renderer = create(el);
  });
}
// texto visível: o renderizador separa "versão 3" em pedaços; aqui eles são juntados como o usuário os lê
const juntar = (no: unknown): string => {
  if (typeof no === "string") return no;
  if (Array.isArray(no)) return no.map(juntar).join("");
  if (no && typeof no === "object" && "children" in no)
    return juntar((no as { children: unknown }).children);
  return "";
};
const texto = () => juntar(renderer?.toJSON());
const botoes = () => renderer?.root.findAllByType("button") ?? [];
const botao = (rotulo: string) => botoes().find((b) => juntar(b.children).includes(rotulo));

const resumo: ResumoLote = {
  consultados: 6,
  comRegra: 3,
  semRegra: 1,
  empate: 1,
  ncmInvalido: 1,
  comMudanca: 2,
  semMudanca: 1,
  campos: 5,
};
const painel = (p: Partial<React.ComponentProps<typeof PainelSugestaoBase>> = {}) => (
  <PainelSugestaoBase
    regime="simples"
    ncmsNaLista={4}
    modo="faltantes"
    onModo={vi.fn()}
    consultando={false}
    erro={null}
    resumo={null}
    onConsultar={vi.fn()}
    onAplicar={vi.fn()}
    {...p}
  />
);

describe("PainelSugestaoBase", () => {
  it("explica que nada é gravado e que PIS, COFINS e IBS/CBS não são aplicados aqui", async () => {
    await montar(painel());
    const t = texto();
    expect(t).toContain("Nada é gravado agora");
    expect(t).toContain("só o botão Salvar grava");
    expect(t).toContain("PIS, COFINS, redução de base, MVA e IBS/CBS não são aplicados");
  });

  it("o texto muda com o regime: CSOSN no Simples, CST do ICMS no regime normal", async () => {
    await montar(painel({ regime: "simples" }));
    expect(texto()).toContain("CSOSN");
    await act(async () => {
      renderer?.update(painel({ regime: "normal" }));
    });
    expect(texto()).toContain("CST do ICMS");
  });

  it("botão mostra a quantidade de NCMs e consulta; sem NCM completo fica desligado", async () => {
    const onConsultar = vi.fn();
    await montar(painel({ ncmsNaLista: 1, onConsultar }));
    expect(botao("Consultar a base (1 NCM)")).toBeDefined();
    await act(async () => {
      botao("Consultar a base")?.props.onClick();
    });
    expect(onConsultar).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer?.update(painel({ ncmsNaLista: 0 }));
    });
    expect(botao("Nenhum NCM completo na lista")?.props.disabled).toBe(true);
    await act(async () => {
      renderer?.update(painel({ consultando: true }));
    });
    expect(botao("Consultando")?.props.disabled).toBe(true);
  });

  it("os dois modos de aplicar", async () => {
    const onModo = vi.fn();
    await montar(painel({ onModo }));
    const radios =
      renderer?.root.findAllByType("input").filter((i) => i.props.type === "radio") ?? [];
    expect(radios.map((r) => r.props.checked)).toEqual([true, false]);
    await act(async () => {
      radios[1]?.props.onChange();
    });
    expect(onModo).toHaveBeenCalledWith("substituir");
  });

  it("mostra o resumo da consulta e só deixa aplicar quando há mudança", async () => {
    const onAplicar = vi.fn();
    await montar(painel({ resumo, onAplicar }));
    const t = texto();
    expect(t).toContain("3 com regra");
    expect(t).toContain("1 sem regra");
    expect(t).toContain("1 com empate");
    expect(t).toContain("1 com NCM inválido");
    expect(t).toContain("5 campo(s)");
    expect(t).toContain("escolha a regra no cadastro do produto");
    await act(async () => {
      botao("Aplicar na lista (2)")?.props.onClick();
    });
    expect(onAplicar).toHaveBeenCalledTimes(1);
    await act(async () => {
      renderer?.update(painel({ resumo: { ...resumo, comMudanca: 0, campos: 0 }, onAplicar }));
    });
    expect(botao("Aplicar na lista (0)")?.props.disabled).toBe(true);
  });

  it("mostra a UF da empresa usada na consulta, ou avisa que ela não tem UF", async () => {
    await montar(painel({ resumo, uf: "SP" }));
    expect(texto()).toContain("vendas dentro de SP (a UF da empresa)");
    await act(async () => {
      renderer?.update(painel({ resumo, uf: null }));
    });
    expect(texto()).toContain("A empresa não tem UF cadastrada");
    await act(async () => {
      renderer?.update(painel({ resumo }));
    });
    expect(texto()).not.toContain("UF da empresa");
    expect(texto()).not.toContain("não tem UF cadastrada");
  });

  it("erro da consulta aparece", async () => {
    await montar(painel({ erro: "função não existe" }));
    expect(texto()).toContain("função não existe");
  });
});

const regraBase = {
  id: "r1",
  versao: 3,
  origem: "global" as const,
  ncmPrefixo: "2309",
  perfilNome: "Substituição tributária",
};
const sugestao = (perfil: Record<string, string | number>): SugestaoFiscal => ({
  status: "regra",
  regra: regraBase,
  perfil,
});
const vazio = { cfop: null, cst_csosn: null, aliquota_icms: 0, origem_mercadoria: null };

describe("LinhaSugestaoBase", () => {
  it("não mostra nada sem consulta, sem regra ou com NCM inválido", async () => {
    await montar(
      <LinhaSugestaoBase sugestao={undefined} regime="simples" produto={vazio} onUsar={vi.fn()} />,
    );
    expect(renderer?.toJSON()).toBeNull();
    for (const s of [{ status: "sem_regra" }, { status: "ncm_invalido" }] as SugestaoFiscal[]) {
      await act(async () => {
        renderer?.update(
          <LinhaSugestaoBase sugestao={s} regime="simples" produto={vazio} onUsar={vi.fn()} />,
        );
      });
      expect(renderer?.toJSON()).toBeNull();
    }
  });

  it("empate manda escolher no cadastro do produto", async () => {
    await montar(
      <LinhaSugestaoBase
        sugestao={{ status: "empate", candidatas: [] }}
        regime="simples"
        produto={vazio}
        onUsar={vi.fn()}
      />,
    );
    expect(texto()).toContain("Escolha no cadastro do produto");
  });

  it("mostra origem, perfil, versão e os valores do regime; usar leva as edições", async () => {
    const onUsar = vi.fn();
    await montar(
      <LinhaSugestaoBase
        sugestao={sugestao({
          cfop: "5405",
          csosn: "500",
          cstIcms: "60",
          aliqIcms: 18,
          origem: "0",
        })}
        regime="simples"
        produto={{ ...vazio, cfop: "5102" }}
        onUsar={onUsar}
      />,
    );
    const t = texto();
    expect(t).toContain("Regra global");
    expect(t).toContain("Substituição tributária");
    expect(t).toContain("versão 3");
    expect(t).toContain("CFOP 5405");
    expect(t).toContain("CSOSN 500");
    expect(t).not.toContain("CST 60");
    expect(t).toContain("ICMS 18%");
    await act(async () => {
      botao("Usar a sugestão")?.props.onClick();
    });
    expect(onUsar).toHaveBeenCalledWith({
      cfop: "5405",
      cst_csosn: "500",
      aliquota_icms: 18,
      origem_mercadoria: "0",
    });
  });

  it("regime normal mostra CST", async () => {
    await montar(
      <LinhaSugestaoBase
        sugestao={sugestao({ cstIcms: "60", csosn: "500" })}
        regime="normal"
        produto={vazio}
        onUsar={vi.fn()}
      />,
    );
    expect(texto()).toContain("CST 60");
    expect(texto()).not.toContain("CSOSN 500");
  });

  it("produto já igual à base não oferece o botão", async () => {
    await montar(
      <LinhaSugestaoBase
        sugestao={sugestao({ cfop: "5405", csosn: "500" })}
        regime="simples"
        produto={{ ...vazio, cfop: "5405", cst_csosn: "500" }}
        onUsar={vi.fn()}
      />,
    );
    expect(botao("Usar a sugestão")).toBeUndefined();
    expect(texto()).toContain("já igual à base");
  });

  it("valor que a emissão não sabe formatar vira aviso e não é oferecido", async () => {
    await montar(
      <LinhaSugestaoBase
        sugestao={sugestao({ cstIcms: "20" })}
        regime="normal"
        produto={vazio}
        onUsar={vi.fn()}
      />,
    );
    expect(texto()).toContain("CST do ICMS 20 ainda não é emitido corretamente");
    expect(botao("Usar a sugestão")).toBeUndefined();
  });

  it("sobrescrita da empresa aparece como tal", async () => {
    await montar(
      <LinhaSugestaoBase
        sugestao={{
          status: "regra",
          regra: { ...regraBase, origem: "empresa" },
          perfil: { cfop: "5101" },
        }}
        regime="simples"
        produto={vazio}
        onUsar={vi.fn()}
      />,
    );
    expect(texto()).toContain("Sobrescrita da empresa");
  });
});
