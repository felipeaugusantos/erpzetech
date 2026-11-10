import React, { createContext, useContext } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const mutacao = () => ({ isPending: false, mutate: vi.fn() });
  return {
    sessao: { data: null as unknown, isLoading: false },
    perfis: { data: [] as unknown[] },
    minhas: {} as Record<string, unknown>,
    globais: {} as Record<string, unknown>,
    salvar: mutacao(),
    encerrar: mutacao(),
    ocultar: mutacao(),
    reexibir: mutacao(),
    mutacao,
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));
vi.mock("@/hooks/useSessionData", () => ({ useSessionData: () => h.sessao }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/fiscal-empresa-dados", () => ({
  LIMITE_PAGINA_FISCAL: 100,
  usePerfisFiscais: () => h.perfis,
  useMinhasRegrasFiscais: () => h.minhas,
  useRegrasGlobaisFiscais: () => h.globais,
  useSalvarRegraFiscal: () => h.salvar,
  useEncerrarRegraFiscal: () => h.encerrar,
  useOcultarRegraFiscal: () => h.ocultar,
  useReexibirRegraFiscal: () => h.reexibir,
}));

// Versões simples dos componentes de interface: o renderizador de testes não suporta portais do Radix.
type Filhos = { children?: React.ReactNode };
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: Filhos) => <div>{children}</div>,
  TabsList: ({ children }: Filhos) => <div>{children}</div>,
  TabsTrigger: ({ children }: Filhos) => <button>{children}</button>,
  TabsContent: ({ children }: Filhos) => <div>{children}</div>,
}));
vi.mock("@/components/ui/dialog", () => {
  const Caixa = ({ children }: Filhos) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: Filhos & { open: boolean }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Caixa,
    DialogHeader: Caixa,
    DialogFooter: Caixa,
    DialogTitle: Caixa,
    DialogDescription: Caixa,
  };
});
vi.mock("@/components/ui/alert-dialog", () => {
  const Caixa = ({ children }: Filhos) => <div>{children}</div>;
  return {
    AlertDialog: ({ open, children }: Filhos & { open: boolean }) =>
      open ? <div>{children}</div> : null,
    AlertDialogContent: Caixa,
    AlertDialogHeader: Caixa,
    AlertDialogFooter: Caixa,
    AlertDialogTitle: Caixa,
    AlertDialogDescription: Caixa,
    AlertDialogCancel: ({ children }: Filhos) => <button>{children}</button>,
    AlertDialogAction: ({
      children,
      onClick,
    }: Filhos & { onClick: (e: { preventDefault: () => void }) => void }) => (
      <button onClick={() => onClick({ preventDefault: () => undefined })}>{children}</button>
    ),
  };
});
const SelectCtx = createContext<(v: string) => void>(() => undefined);
vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, children }: Filhos & { onValueChange: (v: string) => void }) => (
    <SelectCtx.Provider value={onValueChange}>{children}</SelectCtx.Provider>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: Filhos) => <div>{children}</div>,
  SelectItem: ({ value, children }: Filhos & { value: string }) => {
    const mudar = useContext(SelectCtx);
    return (
      <button data-valor={value} onClick={() => mudar(value)}>
        {children}
      </button>
    );
  },
}));

import { Route } from "../src/routes/_authenticated/fiscal-regras";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const minha = {
  id: "m1",
  ncmPrefixo: "23091000",
  cest: null,
  operacao: "venda",
  regime: null,
  ufDestino: null,
  vigenciaInicio: "2027-01-01",
  vigenciaFim: null,
  versao: 2,
  ativa: true,
  status: "vigente",
  observacao: null,
  criadoEm: "2027-01-01T00:00:00Z",
  perfilId: "p-emp",
  perfilNome: "Meu perfil",
  perfilOrigem: "empresa",
  perfil: { cfop: "5101", aliqIcms: 12 },
};
const global = {
  id: "g1",
  ncmPrefixo: "2309",
  cest: null,
  operacao: null,
  regime: null,
  ufDestino: null,
  vigenciaInicio: "2020-01-01",
  vigenciaFim: null,
  versao: 1,
  ativa: true,
  status: "vigente",
  observacao: null,
  oculta: false,
  motivoOculta: null,
  perfilNome: "Revenda tributada",
  perfil: { cfop: "5102", cstIcms: "00" },
};
const lista = (itens: unknown[]) => ({
  isPending: false,
  isError: false,
  data: { total: itens.length, itens },
});

let renderer: ReactTestRenderer | undefined;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};
async function abrir() {
  const Pagina = Route.options.component as React.ComponentType;
  await act(async () => {
    renderer = create(<Pagina />);
  });
  await flush();
}
const texto = () => JSON.stringify(renderer?.toJSON());
const botao = (rotulo: string) =>
  renderer?.root.findAllByType("button").find((b) => b.children.includes(rotulo));
const campo = (id: string) => renderer?.root.findAllByType("input").find((i) => i.props.id === id);
async function clicar(rotulo: string) {
  const b = botao(rotulo);
  if (!b) throw new Error(`Botão "${rotulo}" não encontrado`);
  await act(async () => {
    b.props.onClick();
  });
}
async function clicarUltimo(rotulo: string) {
  const todos =
    renderer?.root.findAllByType("button").filter((b) => b.children.includes(rotulo)) ?? [];
  const b = todos[todos.length - 1];
  if (!b) throw new Error(`Botão "${rotulo}" não encontrado`);
  await act(async () => {
    b.props.onClick({ preventDefault: () => undefined });
  });
}
const radios = () =>
  renderer?.root.findAllByType("input").filter((i) => i.props.type === "radio") ?? [];
async function escolher(valor: string) {
  const b = renderer?.root.findAllByType("button").find((x) => x.props["data-valor"] === valor);
  if (!b) throw new Error(`Opção ${valor} não encontrada`);
  await act(async () => {
    b.props.onClick();
  });
}
async function digitar(id: string, valor: string) {
  const c = campo(id);
  if (!c) throw new Error(`Campo ${id} não encontrado`);
  await act(async () => {
    c.props.onChange({ target: { value: valor } });
  });
}

beforeEach(() => {
  h.sessao = { data: { roles: ["administrador"], profile: { tenant_id: "t1" } }, isLoading: false };
  h.perfis = {
    data: [
      { id: "p-glob", nome: "Revenda tributada", origem: "global", perfil: { cfop: "5102" } },
      { id: "p-emp", nome: "Meu perfil", origem: "empresa", perfil: { cfop: "5101" } },
    ],
  };
  h.minhas = lista([minha]);
  h.globais = lista([global]);
  for (const m of [h.salvar, h.encerrar, h.ocultar, h.reexibir]) m.mutate.mockReset();
});
afterEach(async () => {
  await act(async () => {
    renderer?.unmount();
  });
  renderer = undefined;
});

describe("Regras fiscais da empresa", () => {
  it("quem não é administrador nem gestor só vê o aviso, sem lista", async () => {
    h.sessao = { data: { roles: ["vendedor"], profile: { tenant_id: "t1" } }, isLoading: false };
    await abrir();
    expect(texto()).toContain("Só a administração mexe nas regras fiscais");
    expect(texto()).not.toContain("Meu perfil");
  });

  it("gestor vê as regras da empresa e da base, com critérios, perfil e situação", async () => {
    h.sessao = { data: { roles: ["gestor"], profile: { tenant_id: "t1" } }, isLoading: false };
    await abrir();
    const t = texto();
    expect(t).toContain("23091000");
    expect(t).toContain("Meu perfil");
    expect(t).toContain("da empresa");
    expect(t).toContain("CFOP 5101 · ICMS 12%");
    expect(t).toContain("01/01/2027");
    expect(t).toContain("Revenda tributada");
    expect(t).toContain("da base");
    expect(t).toContain("sugestões");
  });

  it("lista vazia explica o que fazer; erro do banco aparece sem quebrar a tela", async () => {
    h.minhas = lista([]);
    h.globais = { isPending: false, isError: true, error: new Error("função não existe") };
    await abrir();
    expect(texto()).toContain("ainda não tem regras próprias");
    expect(texto()).toContain("função não existe");
  });

  it("ocultar exige motivo e só chama o banco com o motivo limpo", async () => {
    await abrir();
    await clicar("Ocultar");
    expect(texto()).toContain("Ocultar regra da base");
    await clicarUltimo("Ocultar");
    expect(texto()).toContain("Informe o motivo");
    expect(h.ocultar.mutate).not.toHaveBeenCalled();
    await digitar("rf-motivo", "  Não se aplica ao meu negócio  ");
    await clicarUltimo("Ocultar");
    expect(h.ocultar.mutate).toHaveBeenCalledTimes(1);
    expect(h.ocultar.mutate.mock.calls[0]?.[0]).toEqual({
      regraId: "g1",
      motivo: "Não se aplica ao meu negócio",
    });
  });

  it("regra oculta mostra o motivo e dá para voltar a usar", async () => {
    h.globais = lista([{ ...global, oculta: true, motivoOculta: "Não se aplica ao meu negócio" }]);
    await abrir();
    expect(texto()).toContain("Oculta");
    expect(texto()).toContain("Não se aplica ao meu negócio");
    expect(botao("Ocultar")).toBeUndefined();
    await clicar("Voltar a usar");
    expect(h.reexibir.mutate).toHaveBeenCalledTimes(1);
    expect(h.reexibir.mutate.mock.calls[0]?.[0]).toBe("g1");
  });

  it("encerrar leva a regra da empresa e a data escolhida", async () => {
    await abrir();
    await clicar("Encerrar");
    expect(texto()).toContain("Último dia de vigência");
    await digitar("rf-fim-enc", "2027-12-31");
    await clicarUltimo("Encerrar");
    expect(h.encerrar.mutate).toHaveBeenCalledTimes(1);
    expect(h.encerrar.mutate.mock.calls[0]?.[0]).toEqual({ regraId: "m1", fim: "2027-12-31" });
  });

  it("regra que não está em vigor não oferece nova versão nem encerrar", async () => {
    h.minhas = lista([{ ...minha, status: "encerrada", vigenciaFim: "2027-06-30" }]);
    await abrir();
    expect(botao("Nova versão")).toBeUndefined();
    expect(botao("Encerrar")).toBeUndefined();
  });

  it("nova regra: formulário vazio mostra os erros e não chama o banco", async () => {
    await abrir();
    await clicar("Nova regra");
    expect(texto()).toContain("Nova regra da empresa");
    await clicar("Salvar");
    expect(texto()).toContain("Escolha o perfil da regra");
    expect(texto()).toContain("NCM deve ter");
    expect(h.salvar.mutate).not.toHaveBeenCalled();
  });

  it("nova regra com perfil existente envia só o id do perfil", async () => {
    await abrir();
    await clicar("Nova regra");
    await digitar("rf-ncm", "2309");
    await escolher("p-glob");
    await clicar("Salvar");
    expect(h.salvar.mutate).toHaveBeenCalledTimes(1);
    const dados = h.salvar.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(dados["ncm"]).toBe("2309");
    expect(dados["perfil_id"]).toBe("p-glob");
    expect(dados["perfil"]).toBeUndefined();
    expect(dados["operacao"]).toBeNull();
  });

  it("nova regra com perfil próprio envia o nome e os valores", async () => {
    await abrir();
    await clicar("Nova regra");
    await digitar("rf-ncm", "3004");
    await act(async () => {
      radios()[1]?.props.onChange();
    });
    expect(texto()).toContain("Nome do perfil");
    await digitar("rf-nome", "Isento da casa");
    await digitar("rf-cfop", "5102");
    await digitar("rf-aliqIcms", "0");
    await clicar("Salvar");
    const dados = h.salvar.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(dados["perfil_id"]).toBeUndefined();
    expect(dados["perfil"]).toMatchObject({ nome: "Isento da casa", cfop: "5102", aliq_icms: 0 });
  });

  it("nova versão trava os critérios e exige início depois da versão atual", async () => {
    await abrir();
    await clicar("Nova versão");
    expect(texto()).toContain("Nova versão — NCM 23091000");
    expect(campo("rf-ncm")?.props.disabled).toBe(true);
    await digitar("rf-inicio", "2026-12-31");
    await clicar("Salvar");
    expect(texto()).toContain("depois de 01/01/2027");
    expect(h.salvar.mutate).not.toHaveBeenCalled();
    await digitar("rf-inicio", "2027-06-01");
    await clicar("Salvar");
    const dados = h.salvar.mutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(dados["ncm"]).toBe("23091000");
    expect(dados["perfil_id"]).toBe("p-emp");
    expect(dados["vigencia_inicio"]).toBe("2027-06-01");
  });

  it("erro devolvido pelo banco aparece no formulário aberto", async () => {
    await abrir();
    await clicar("Nova regra");
    await digitar("rf-ncm", "2309");
    await escolher("p-glob");
    await clicar("Salvar");
    const opcoes = h.salvar.mutate.mock.calls[0]?.[1] as { onError: (e: Error) => void };
    await act(async () => {
      opcoes.onError(new Error("Já existe um perfil seu chamado X com outros valores"));
    });
    expect(texto()).toContain("Já existe um perfil seu chamado X com outros valores");
  });
});
