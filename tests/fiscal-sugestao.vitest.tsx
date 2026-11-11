import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { SugestaoFiscal } from "../src/components/app/SugestaoFiscal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const regra = {
  id: "r1",
  versao: 3,
  origem: "global",
  ncmPrefixo: "2309",
  perfilNome: "Revenda tributada",
};
const resposta = (perfil: Record<string, string | number>) => ({
  data: { status: "regra", regra, candidatas: [], perfil },
  error: null,
});

let renderer: ReactTestRenderer | undefined;
let qc: QueryClient;
const aplicar = vi.fn();
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};
const tree = (p: Partial<React.ComponentProps<typeof SugestaoFiscal>> = {}) => (
  <QueryClientProvider client={qc}>
    <SugestaoFiscal
      ncm="2309.10.00"
      tenantId="empresa-a"
      cstAtual=""
      cClassTribAtual=""
      onAplicarIbsCbs={aplicar}
      {...p}
    />
  </QueryClientProvider>
);
async function abrir(p: Partial<React.ComponentProps<typeof SugestaoFiscal>> = {}) {
  await act(async () => {
    renderer = create(tree(p));
  });
  await flush();
}
async function atualizar(p: Partial<React.ComponentProps<typeof SugestaoFiscal>>) {
  await act(async () => {
    renderer?.update(tree(p));
  });
  await flush();
}
const texto = () => JSON.stringify(renderer?.toJSON());
const botoes = () => renderer?.root.findAllByType("button") ?? [];
const botao = (rotulo: string) => botoes().find((b) => b.children.includes(rotulo));

beforeEach(() => {
  rpc.mockReset();
  aplicar.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
  qc.clear();
});

describe("Sugestão fiscal no cadastro de produto", () => {
  it("não aparece sem NCM e só avisa com o NCM incompleto, sem consultar", async () => {
    await abrir({ ncm: "" });
    expect(renderer?.toJSON()).toBeNull();
    await atualizar({ ncm: "2309" });
    expect(texto()).toContain("Digite os 8 dígitos do NCM");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("consulta só os dígitos, mostra regra, perfil e valores e não aplica nada sozinha", async () => {
    rpc.mockResolvedValue(
      resposta({ cfop: "5102", aliqIcms: 18, cstIbsCbs: "410", cclasstrib: "410004" }),
    );
    await abrir();
    expect(rpc).toHaveBeenCalledWith("fiscal_sugerir", { p_ncm: "23091000", p_operacao: "venda" });
    const t = texto();
    expect(t).toContain("Regra global");
    expect(t).toContain("Revenda tributada");
    expect(t).toContain("5102");
    expect(t).toContain("18%");
    expect(t).toContain("não substitui a validação do contador");
    expect(aplicar).not.toHaveBeenCalled();
  });

  it("diz qual UF foi considerada (a da empresa) e avisa quando a empresa não tem UF", async () => {
    rpc.mockResolvedValue({
      data: { status: "regra", regra, candidatas: [], perfil: { cfop: "5102" }, ufDestino: "SP" },
      error: null,
    });
    await abrir();
    expect(texto()).toContain("Considerando venda dentro de SP");
    rpc.mockResolvedValue({
      data: { status: "regra", regra, candidatas: [], perfil: { cfop: "5102" }, ufDestino: null },
      error: null,
    });
    await atualizar({ ncm: "3004.10.00" });
    expect(texto()).toContain("A empresa não tem UF cadastrada");
  });

  it("resposta sem a UF (de antes da migração) não mostra a linha de UF", async () => {
    rpc.mockResolvedValue(resposta({ cfop: "5102" }));
    await abrir();
    expect(texto()).not.toContain("Considerando venda dentro de");
    expect(texto()).not.toContain("não tem UF cadastrada");
  });

  it("aplicar é um clique e leva o CST e o cClassTrib sugeridos", async () => {
    rpc.mockResolvedValue(resposta({ cstIbsCbs: "410", cclasstrib: "410004" }));
    await abrir();
    await act(async () => {
      botao("Usar sugestão (IBS/CBS)")?.props.onClick();
    });
    expect(aplicar).toHaveBeenCalledTimes(1);
    expect(aplicar).toHaveBeenCalledWith("410", "410004");
  });

  it("tributação integral é aplicada como padrão (em branco) e some o botão quando já está igual", async () => {
    rpc.mockResolvedValue(resposta({ cstIbsCbs: "000", cclasstrib: "000001" }));
    await abrir({ cstAtual: "410", cClassTribAtual: "410004" });
    await act(async () => {
      botao("Usar sugestão (IBS/CBS)")?.props.onClick();
    });
    expect(aplicar).toHaveBeenCalledWith("", "");
    await atualizar({ cstAtual: "", cClassTribAtual: "" });
    expect(botao("Usar sugestão (IBS/CBS)")).toBeUndefined();
    expect(texto()).toContain("já é a da sugestão");
  });

  it("combinação que a emissão recusaria não pode ser aplicada e mostra o motivo", async () => {
    rpc.mockResolvedValue(resposta({ cstIbsCbs: "510", cclasstrib: "510001" }));
    await abrir();
    expect(botao("Usar sugestão (IBS/CBS)")).toBeUndefined();
    expect(texto()).toContain("não pode ser aplicado");
    expect(texto()).toContain("ainda não é calculado");
  });

  it("perfil sem IBS/CBS não tem botão", async () => {
    rpc.mockResolvedValue(resposta({ cfop: "5102" }));
    await abrir();
    expect(botoes().length).toBe(0);
    expect(texto()).toContain("não define a tributação IBS/CBS");
  });

  it("empate lista as regras e não escolhe sozinha", async () => {
    rpc.mockResolvedValue({
      data: {
        status: "empate",
        regra: null,
        perfil: {},
        candidatas: [
          {
            ...regra,
            id: "a",
            perfilNome: "Perfil A",
            perfil: { cstIbsCbs: "410", cclasstrib: "410004" },
          },
          {
            ...regra,
            id: "b",
            perfilNome: "Perfil B",
            origem: "empresa",
            perfil: { cfop: "5405" },
          },
        ],
      },
      error: null,
    });
    await abrir();
    const t = texto();
    expect(t).toContain("mais de uma regra");
    expect(t).toContain("Perfil A");
    expect(t).toContain("Perfil B");
    expect(t).toContain("Sobrescrita da empresa");
    expect(aplicar).not.toHaveBeenCalled();
    await act(async () => {
      botao("Usar esta (IBS/CBS)")?.props.onClick();
    });
    expect(aplicar).toHaveBeenCalledWith("410", "410004");
  });

  it("sem regra na base, só avisa", async () => {
    rpc.mockResolvedValue({
      data: { status: "sem_regra", regra: null, candidatas: [], perfil: {} },
      error: null,
    });
    await abrir();
    expect(texto()).toContain("não tem regra para este NCM");
    expect(botoes().length).toBe(0);
  });

  it("falha ou resposta estranha não atrapalha o cadastro", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "função não existe" } });
    await abrir();
    expect(texto()).toContain("indisponível agora");
    await atualizar({ ncm: "3004.10.00" });
    rpc.mockResolvedValue({ data: { status: "qualquer" }, error: null });
    await atualizar({ ncm: "3005.10.00" });
    expect(texto()).toContain("indisponível agora");
  });

  it("a empresa está na chave: outra empresa não reaproveita a sugestão em cache", async () => {
    rpc.mockResolvedValue(resposta({ cfop: "5102" }));
    await abrir({ tenantId: "empresa-a" });
    expect(rpc).toHaveBeenCalledTimes(1);
    await atualizar({ tenantId: "empresa-b" });
    expect(rpc).toHaveBeenCalledTimes(2);
    await atualizar({ tenantId: "empresa-a" });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("sem empresa carregada ainda, não consulta", async () => {
    await abrir({ tenantId: undefined });
    expect(rpc).not.toHaveBeenCalled();
  });
});
