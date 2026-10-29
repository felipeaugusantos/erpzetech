import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSessionData } from "@/hooks/useSessionData";
import { interpretarBusca } from "@/lib/busca-pdv";
import { trocarOperador as trocarOperadorLogin } from "@/lib/login-cliente";
import { brl, num } from "@/lib/format";
import {
  CREDENCIADORA_SIMULADA,
  MOTIVO_RECUSA_SIMULADA,
  gerarRespostaSimulada,
} from "@/lib/tef-simulado";
import { formasPagamento, hojeISO, labelForma, somaDias } from "@/lib/financeiro";
import type { FormaPagamento } from "@/lib/financeiro";
import { autorizarGestor, sugerirProdutos } from "@/lib/frente-caixa.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FrenteClientes, type ClienteFrente } from "@/components/app/FrenteClientes";
import { CupomFiscal, type CupomDados } from "@/components/app/CupomFiscal";
import { EmitirNfce } from "@/components/app/EmitirNfce";
import { avisoDepoisDoUso } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/frente-caixa")({
  head: () => ({
    meta: [
      { title: "Frente de caixa — EZRA ERP" },
      {
        name: "description",
        content:
          "Frente de caixa em tela cheia, operada pelo teclado, com caixa por operador e senha do gestor.",
      },
      { property: "og:title", content: "Frente de caixa — EZRA ERP" },
      {
        property: "og:description",
        content: "Venda rápida pelo teclado com sugestão de produtos por IA.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // ?pet=<atendimento>: "Retirar e cobrar" da agenda do pet shop abre o caixa com os serviços já na venda.
  // ?pacote=<modelo>&para=<pet>&validade=30|60|90: venda de pacote de banhos para um pet.
  // ?lava=<ordem>: "Entregar e cobrar" do pátio do lava rápido abre o caixa com os serviços da ordem.
  // ?plano=<plano>&veiculo=<veículo>: venda de plano de lavagens para um veículo.
  validateSearch: (
    s: Record<string, unknown>,
  ): {
    pet?: string;
    pacote?: string;
    para?: string;
    validade?: number;
    lava?: string;
    plano?: string;
    veiculo?: string;
  } => {
    const out: {
      pet?: string;
      pacote?: string;
      para?: string;
      validade?: number;
      lava?: string;
      plano?: string;
      veiculo?: string;
    } = {};
    if (typeof s["plano"] === "string" && s["plano"]) out.plano = s["plano"];
    if (typeof s["veiculo"] === "string" && s["veiculo"]) out.veiculo = s["veiculo"];
    if (typeof s["pet"] === "string" && s["pet"]) out.pet = s["pet"];
    if (typeof s["lava"] === "string" && s["lava"]) out.lava = s["lava"];
    if (typeof s["pacote"] === "string" && s["pacote"]) out.pacote = s["pacote"];
    if (typeof s["para"] === "string" && s["para"]) out.para = s["para"];
    const v = Number(s["validade"]);
    if ([30, 60, 90].includes(v)) out.validade = v;
    return out;
  },
  component: FrenteCaixa,
});

/** Atendimento do pet shop que esta venda vai cobrar. */
type PetCobranca = {
  id: string;
  pet: string;
  tutor: string;
  /** só os serviços que serão cobrados agora (os que saem de um pacote não entram na venda) */
  servicos: { produto_id: string; descricao: string; preco: number }[];
  /** algum serviço do atendimento sai de um pacote do pet */
  usarPacote: boolean;
};
/** Venda de um pacote de banhos para um pet. */
type PacoteVenda = {
  modeloId: string;
  petId: string;
  validade: number;
  pet: string;
  tutor: string;
  produto_id: string;
  descricao: string;
  preco: number;
};
/** Ordem do lava rápido que esta venda vai cobrar (já pronta no pátio). */
type LavaCobranca = {
  id: string;
  veiculo: string;
  cliente: string;
  servicos: { produto_id: string; descricao: string; preco: number }[];
};
/** Venda de um plano de lavagens para um veículo. */
type PlanoVenda = {
  planoId: string;
  veiculoId: string;
  veiculo: string;
  cliente: string;
  produto_id: string;
  descricao: string;
  preco: number;
};
/** O que a venda do caixa precisa registrar no pet shop e no lava rápido depois de concluída. */
type VinculoPet =
  | { tipo: "atendimento"; agendamentoId: string; usarPacote: boolean }
  | { tipo: "pacote"; modeloId: string; petId: string; validade: number }
  | { tipo: "lava"; ordemId: string }
  | { tipo: "plano"; planoId: string; veiculoId: string };
/** Venda já feita cujo vínculo com o atendimento ainda não foi confirmado (a conexão caiu depois da venda). */
const CHAVE_PET_PENDENTE = "fc-pet-vinculo-pendente";

/** Vínculo da venda com o pet shop que ainda não foi confirmado (conexão caiu) ou foi recusado pelo banco (com o erro). */
type PendenciaPet = { id: string; v: VinculoPet; chave: string; em: string; erro?: string };

function lerPendenciasPet(): PendenciaPet[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(CHAVE_PET_PENDENTE) ?? "[]");
    const lista = Array.isArray(raw) ? raw : [raw];
    return lista.flatMap((x): PendenciaPet[] => {
      const p = x as Record<string, unknown> | null;
      if (!p || typeof p["chave"] !== "string") return [];
      // formato antigo (antes dos pacotes): { agendamentoId, chave } — convertido, nunca descartado
      const v =
        (p["v"] as VinculoPet | undefined) ??
        (typeof p["agendamentoId"] === "string"
          ? ({
              tipo: "atendimento",
              agendamentoId: p["agendamentoId"],
              usarPacote: false,
            } as VinculoPet)
          : null);
      if (!v) return [];
      return [
        {
          id: typeof p["id"] === "string" ? p["id"] : crypto.randomUUID(),
          v,
          chave: p["chave"],
          em: typeof p["em"] === "string" ? p["em"] : new Date().toISOString(),
          ...(typeof p["erro"] === "string" ? { erro: p["erro"] } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}

function gravarPendenciasPet(lista: PendenciaPet[]) {
  try {
    if (lista.length) localStorage.setItem(CHAVE_PET_PENDENTE, JSON.stringify(lista));
    else localStorage.removeItem(CHAVE_PET_PENDENTE);
  } catch {
    /* sem armazenamento: o aviso na tela é o que resta */
  }
}

type Linha = {
  produto_id: string;
  descricao: string;
  unidade: string;
  preco: number;
  quantidade: number;
};
type AcaoGestor = "cancelar_venda" | "desconto" | "sangria";
const rotuloAcao: Record<AcaoGestor, string> = {
  cancelar_venda: "Cancelar venda",
  desconto: "Desconto acima do limite",
  sangria: "Sangria",
};
const parseNum = (v: string) => {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
};

function FrenteCaixa() {
  const qc = useQueryClient();
  const { data: session } = useSessionData();
  const buscaRef = useRef<HTMLInputElement>(null);
  const autorizar = useServerFn(autorizarGestor);
  const sugerir = useServerFn(sugerirProdutos);

  const [busca, setBusca] = useState("");
  const [qtd, setQtd] = useState("1");
  const [sel, setSel] = useState(0);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [desconto, setDesconto] = useState("0");
  const [forma, setForma] = useState<FormaPagamento>("dinheiro");
  const [parcelas, setParcelas] = useState("1");
  const [recebido, setRecebido] = useState("");
  const [modal, setModal] = useState<
    | null
    | "pagamento"
    | "ia"
    | "desconto"
    | "movimento"
    | "vendas"
    | "abrir"
    | "fechar"
    | "operador"
    | "espera"
    | "cliente"
    | "cupom"
    | "nfce"
  >(null);
  const [cliente, setCliente] = useState<ClienteFrente | null>(null);
  const [petCobranca, setPetCobranca] = useState<PetCobranca | null>(null);
  const [pacoteVenda, setPacoteVenda] = useState<PacoteVenda | null>(null);
  const [lavaCobranca, setLavaCobranca] = useState<LavaCobranca | null>(null);
  const [planoVenda, setPlanoVenda] = useState<PlanoVenda | null>(null);
  const {
    lava: lavaParam,
    plano: planoParam,
    veiculo: veiculoParam,
    pet: petParam,
    pacote: pacoteParam,
    para: paraParam,
    validade: validadeParam,
  } = Route.useSearch();
  const navegar = useNavigate();
  const [cupom, setCupom] = useState<CupomDados | null>(null);
  /** Pedido da venda que acabou de fechar (ou escolhido na lista de vendas) para emitir a NFC-e. */
  const [pedidoNfce, setPedidoNfce] = useState<string | null>(null);
  const [pedidoCupom, setPedidoCupom] = useState<string | null>(null);
  const [gestor, setGestor] = useState<null | {
    acao: AcaoGestor;
    executar: (aut: string) => void;
  }>(null);
  const [gEmail, setGEmail] = useState("");
  const [gSenha, setGSenha] = useState("");
  const [autDesconto, setAutDesconto] = useState<string | null>(null);
  const [textoIa, setTextoIa] = useState("");
  const [sugestoes, setSugestoes] = useState<{
    itens: (Linha & { motivo: string; marcado: boolean })[];
    observacao: string;
  } | null>(null);
  const [mov, setMov] = useState({
    tipo: "suprimento" as "sangria" | "suprimento",
    valor: "",
    descricao: "",
  });
  const [valorCaixa, setValorCaixa] = useState("");
  const [opEmail, setOpEmail] = useState("");
  const [opSenha, setOpSenha] = useState("");
  const petCarregado = useRef<string | null>(null);
  useEffect(() => {
    if (!petParam || petCarregado.current === petParam) return;
    petCarregado.current = petParam;
    void (async () => {
      const { data: ag, error } = await supabase
        .from("pet_agendamentos")
        .select("id, situacao, pet_id, cliente_id")
        .eq("id", petParam)
        .maybeSingle();
      if (error || !ag) {
        toast.error("Atendimento do pet shop não encontrado");
        return;
      }
      if (ag.situacao !== "pronto") {
        toast.error("Só dá para cobrar atendimento pronto na agenda");
        void navegar({ to: "/frente-caixa", search: {} });
        return;
      }
      const [itens, pet, cli] = await Promise.all([
        supabase
          .from("pet_agendamento_itens")
          .select("id, servico_id, preco_aplicado")
          .eq("agendamento_id", ag.id),
        supabase.from("pets").select("nome").eq("id", ag.pet_id).maybeSingle(),
        supabase
          .from("clientes")
          .select("id, nome, cpf, cnpj, telefone")
          .eq("id", ag.cliente_id)
          .maybeSingle(),
      ]);
      const ids = (itens.data ?? []).map((i) => i.servico_id);
      const servs = ids.length
        ? await supabase.from("pet_servicos").select("id, nome, produto_id").in("id", ids)
        : { data: [] };
      // banhos que saem de um pacote do pet não entram na venda
      const cob = await supabase.rpc("pet_agenda_cobertura", { p_agendamento_id: ag.id });
      const cobertos = new Set(
        ((cob.data ?? []) as unknown as { item_id: string }[]).map((c) => c.item_id),
      );
      const servicos = (itens.data ?? []).flatMap((i) => {
        if (cobertos.has(i.id)) return [];
        const sv = (servs.data ?? []).find((x) => x.id === i.servico_id);
        return sv
          ? [{ produto_id: sv.produto_id, descricao: sv.nome, preco: Number(i.preco_aplicado) }]
          : [];
      });
      if (!(itens.data ?? []).length) {
        toast.error("O atendimento não tem serviços para cobrar");
        return;
      }
      setPetCobranca({
        id: ag.id,
        pet: pet.data?.nome ?? "Pet",
        tutor: cli.data?.nome ?? "",
        servicos,
        usarPacote: cobertos.size > 0,
      });
      if (cobertos.size > 0)
        toast.info("Há banho coberto por pacote: ele sai do pacote e não entra na venda");
      setLinhas(
        servicos.map((x) => ({
          produto_id: x.produto_id,
          descricao: `${x.descricao} — ${pet.data?.nome ?? "pet"}`,
          unidade: "UN",
          preco: x.preco,
          quantidade: 1,
        })),
      );
      if (cli.data) setCliente(cli.data);
    })();
  }, [petParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const lavaCarregada = useRef<string | null>(null);
  useEffect(() => {
    if (!lavaParam || lavaCarregada.current === lavaParam) return;
    lavaCarregada.current = lavaParam;
    void (async () => {
      const { data: ordem, error } = await supabase
        .from("lr_ordens")
        .select("id, situacao, veiculo_id, cliente_id")
        .eq("id", lavaParam)
        .maybeSingle();
      if (error || !ordem) {
        toast.error("Ordem do lava rápido não encontrada");
        return;
      }
      if (ordem.situacao !== "pronto") {
        toast.error("Só dá para cobrar ordem pronta no pátio");
        void navegar({ to: "/frente-caixa", search: {} });
        return;
      }
      const [itens, veic, cli] = await Promise.all([
        supabase
          .from("lr_ordem_itens")
          .select("servico_id, preco_aplicado")
          .eq("ordem_id", ordem.id)
          // o que o plano ou o brinde cobre não passa pelo caixa
          .is("cobertura", null),
        supabase
          .from("lr_veiculos")
          .select("identificacao")
          .eq("id", ordem.veiculo_id)
          .maybeSingle(),
        supabase
          .from("clientes")
          .select("id, nome, cpf, cnpj, telefone")
          .eq("id", ordem.cliente_id)
          .maybeSingle(),
      ]);
      const ids = (itens.data ?? []).map((i) => i.servico_id);
      const servs = ids.length
        ? await supabase.from("lr_servicos").select("id, nome, produto_id").in("id", ids)
        : { data: [] };
      const servicos = (itens.data ?? []).flatMap((i) => {
        const sv = (servs.data ?? []).find((x) => x.id === i.servico_id);
        return sv
          ? [{ produto_id: sv.produto_id, descricao: sv.nome, preco: Number(i.preco_aplicado) }]
          : [];
      });
      if (!servicos.length) {
        toast.error("A ordem não tem serviços para cobrar");
        return;
      }
      const placa = veic.data?.identificacao ?? "veículo";
      setLavaCobranca({
        id: ordem.id,
        veiculo: placa,
        cliente: cli.data?.nome ?? "",
        servicos,
      });
      setLinhas(
        servicos.map((x) => ({
          produto_id: x.produto_id,
          descricao: `${x.descricao} — ${placa}`,
          unidade: "UN",
          preco: x.preco,
          quantidade: 1,
        })),
      );
      if (cli.data) setCliente(cli.data);
    })();
  }, [lavaParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const planoCarregado = useRef<string | null>(null);
  useEffect(() => {
    if (!planoParam || !veiculoParam) return;
    const chave = `${planoParam}:${veiculoParam}`;
    if (planoCarregado.current === chave) return;
    planoCarregado.current = chave;
    void (async () => {
      const [plano, veic] = await Promise.all([
        supabase
          .from("lr_planos")
          .select("id, nome, preco, produto_id, ativo, tipo")
          .eq("id", planoParam)
          .maybeSingle(),
        supabase
          .from("lr_veiculos")
          .select("id, identificacao, tipo, cliente_id")
          .eq("id", veiculoParam)
          .maybeSingle(),
      ]);
      if (!plano.data || !veic.data || !plano.data.ativo) {
        toast.error("Plano ou veículo não encontrado");
        return;
      }
      if (plano.data.tipo && plano.data.tipo !== veic.data.tipo) {
        toast.error("Este plano não vale para o tipo do veículo");
        return;
      }
      const cli = await supabase
        .from("clientes")
        .select("id, nome, cpf, cnpj, telefone")
        .eq("id", veic.data.cliente_id)
        .maybeSingle();
      setPlanoVenda({
        planoId: plano.data.id,
        veiculoId: veic.data.id,
        veiculo: veic.data.identificacao,
        cliente: cli.data?.nome ?? "",
        produto_id: plano.data.produto_id,
        descricao: plano.data.nome,
        preco: Number(plano.data.preco),
      });
      setLinhas([
        {
          produto_id: plano.data.produto_id,
          descricao: `${plano.data.nome} — ${veic.data.identificacao}`,
          unidade: "UN",
          preco: Number(plano.data.preco),
          quantidade: 1,
        },
      ]);
      if (cli.data) setCliente(cli.data);
    })();
  }, [planoParam, veiculoParam]);

  const pacoteCarregado = useRef<string | null>(null);
  useEffect(() => {
    if (!pacoteParam || !paraParam || !validadeParam) return;
    const chave = `${pacoteParam}:${paraParam}:${validadeParam}`;
    if (pacoteCarregado.current === chave) return;
    pacoteCarregado.current = chave;
    void (async () => {
      const [mod, pet] = await Promise.all([
        supabase
          .from("pet_pacote_modelos")
          .select("id, nome, preco, produto_id, ativo")
          .eq("id", pacoteParam)
          .maybeSingle(),
        supabase.from("pets").select("id, nome, cliente_id").eq("id", paraParam).maybeSingle(),
      ]);
      if (!mod.data || !pet.data || !mod.data.ativo) {
        toast.error("Pacote ou pet não encontrado");
        return;
      }
      const cli = await supabase
        .from("clientes")
        .select("id, nome, cpf, cnpj, telefone")
        .eq("id", pet.data.cliente_id)
        .maybeSingle();
      setPacoteVenda({
        modeloId: mod.data.id,
        petId: pet.data.id,
        validade: validadeParam,
        pet: pet.data.nome,
        tutor: cli.data?.nome ?? "",
        produto_id: mod.data.produto_id,
        descricao: mod.data.nome,
        preco: Number(mod.data.preco),
      });
      setLinhas([
        {
          produto_id: mod.data.produto_id,
          descricao: `${mod.data.nome} — ${pet.data.nome}`,
          unidade: "UN",
          preco: Number(mod.data.preco),
          quantidade: 1,
        },
      ]);
      if (cli.data) setCliente(cli.data);
    })();
  }, [pacoteParam, paraParam, validadeParam]);

  function desistirDaCobrancaPet() {
    setPetCobranca(null);
    setPacoteVenda(null);
    setLavaCobranca(null);
    setPlanoVenda(null);
    planoCarregado.current = null;
    setLinhas([]);
    setCliente(null);
    petCarregado.current = null;
    pacoteCarregado.current = null;
    lavaCarregada.current = null;
    void navegar({ to: "/frente-caixa", search: {} });
  }

  const [pendenciasPet, setPendenciasPet] = useState<PendenciaPet[]>(() => lerPendenciasPet());
  function atualizarPendencias(f: (l: PendenciaPet[]) => PendenciaPet[]) {
    const prox = f(lerPendenciasPet());
    gravarPendenciasPet(prox);
    setPendenciasPet(prox);
  }

  /**
   * Confirma no banco o vínculo da venda com o pet shop. Se a conexão cair, o vínculo fica guardado para tentar de novo;
   * se o banco recusar, fica guardado COM o erro e aparece como aviso fixo — o dinheiro já entrou, então nunca se descarta sozinho.
   */
  async function vincularPet(v: VinculoPet, chave: string, pedidoId: string | null) {
    const ref = pedidoId ? { p_pedido_id: pedidoId } : { p_chave: chave };
    const { data, error } =
      v.tipo === "atendimento"
        ? await supabase.rpc("pet_agenda_retirar", {
            p_agendamento_id: v.agendamentoId,
            p_usar_pacote: v.usarPacote,
            ...ref,
          })
        : v.tipo === "lava"
          ? await supabase.rpc("lr_ordem_retirar", { p_ordem_id: v.ordemId, ...ref })
          : v.tipo === "plano"
            ? await supabase.rpc("lr_plano_vender", {
                p_plano_id: v.planoId,
                p_veiculo_id: v.veiculoId,
                ...ref,
              })
            : await supabase.rpc("pet_pacote_vender", {
                p_modelo_id: v.modeloId,
                p_pet_id: v.petId,
                p_validade_dias: v.validade,
                ...ref,
              });
    if (error) {
      const o =
        v.tipo === "atendimento"
          ? "o atendimento"
          : v.tipo === "lava"
            ? "a ordem"
            : v.tipo === "plano"
              ? "o plano"
              : "o pacote";
      const rede = /fetch|network|failed/i.test(error.message);
      atualizarPendencias((l) => [
        ...l.filter((x) => x.chave !== chave),
        {
          id: crypto.randomUUID(),
          v,
          chave,
          em: new Date().toISOString(),
          ...(rede ? {} : { erro: error.message }),
        },
      ]);
      if (rede) {
        toast.warning(
          `Venda registrada, mas ${o} ainda não foi confirmado. Será confirmado quando a conexão voltar — não cobre de novo.`,
        );
      } else {
        toast.error(`Venda registrada, mas ${o} não foi confirmado`, {
          description: error.message,
          duration: 20000,
        });
      }
      return false;
    }
    atualizarPendencias((l) => l.filter((x) => x.chave !== chave));
    // banho tirado do pacote: avisa a recepção quando sobra só um (ou nenhum)
    const avisos = ((data as { avisos?: { pet: string; restam: number }[] } | null)?.avisos ?? [])
      .map((a) => avisoDepoisDoUso(a.pet, a.restam))
      .filter(Boolean);
    for (const texto of avisos) toast.warning(texto as string, { duration: 15000 });
    void qc.invalidateQueries({ queryKey: ["pet-agenda"] });
    void qc.invalidateQueries({ queryKey: ["pet-pacotes"] });
    void qc.invalidateQueries({ queryKey: ["lava-patio"] });
    void qc.invalidateQueries({ queryKey: ["lava-planos"] });
    return true;
  }

  // ao abrir (ou voltar a conexão), refaz os vínculos que só ficaram pendentes por falta de rede
  useEffect(() => {
    if (!session) return;
    for (const p of lerPendenciasPet().filter((x) => !x.erro)) void vincularPet(p.v, p.chave, null);
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const userId = session?.user.id ?? "";
  const chaveEspera = `fc-espera-${userId}`;
  const chaveFila = `fc-fila-${userId}`;
  type Espera = { id: string; em: string; linhas: Linha[]; desconto: string };
  type Pendente = {
    id: string;
    em: string;
    total: number;
    params: Record<string, unknown>;
    /** pet shop ou lava rápido ligado a esta venda: se ela cair na fila, o vínculo é feito quando a venda for enviada */
    vinculo?: VinculoPet | undefined;
    erro?: string | undefined;
  };
  const [esperas, setEsperas] = useState<Espera[]>([]);
  const [fila, setFila] = useState<Pendente[]>([]);
  const [online, setOnline] = useState(true);
  const enviando = useRef(false);

  useEffect(() => {
    if (!userId) return;
    try {
      setEsperas(JSON.parse(localStorage.getItem(chaveEspera) ?? "[]"));
      setFila(JSON.parse(localStorage.getItem(chaveFila) ?? "[]"));
    } catch {
      /* ignora */
    }
    setOnline(navigator.onLine);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvarEsperas = (v: Espera[]) => {
    setEsperas(v);
    localStorage.setItem(chaveEspera, JSON.stringify(v));
  };
  const salvarFila = (v: Pendente[]) => {
    setFila(v);
    localStorage.setItem(chaveFila, JSON.stringify(v));
  };

  function colocarEmEspera() {
    if (!linhas.length) {
      toast.error("Carrinho vazio");
      return;
    }
    salvarEsperas([
      ...esperas,
      { id: crypto.randomUUID(), em: new Date().toISOString(), linhas, desconto },
    ]);
    setLinhas([]);
    setDesconto("0");
    setAutDesconto(null);
    toast.success("Venda colocada em espera");
    setTimeout(() => buscaRef.current?.focus(), 50);
  }
  function retomar(e: Espera) {
    const resto = esperas.filter((x) => x.id !== e.id);
    salvarEsperas(
      linhas.length
        ? [...resto, { id: crypto.randomUUID(), em: new Date().toISOString(), linhas, desconto }]
        : resto,
    );
    setLinhas(e.linhas);
    setDesconto(e.desconto);
    setAutDesconto(null);
    setModal(null);
  }

  async function enviarFila() {
    if (enviando.current || !navigator.onLine || !userId) return;
    let atual: Pendente[] = [];
    try {
      atual = JSON.parse(localStorage.getItem(chaveFila) ?? "[]");
    } catch {
      return;
    }
    if (!atual.some((p) => !p.erro)) return;
    enviando.current = true;
    const restantes: Pendente[] = [];
    let ok = 0;
    let repetidas = 0;
    for (const p of atual) {
      // recusada pelo banco: fica guardada até alguém resolver (o dinheiro já foi recebido)
      if (p.erro) {
        restantes.push(p);
        continue;
      }
      // Resposta perdida: a venda pode já estar no banco. Avisa em vez de reenviar em silêncio.
      const chave = (p.params as { p_chave?: string }).p_chave;
      if (chave) {
        const { data: ja } = await supabase.rpc("frente_venda_existente", { p_chave: chave });
        const existente = ja as { pedido_id: string; numero: number | null } | null;
        if (existente) {
          repetidas++;
          toast.warning(
            `Venda de ${brl(p.total)} já estava registrada${existente.numero != null ? ` (pedido nº ${existente.numero})` : ""}`,
            {
              description:
                "A resposta do envio anterior tinha se perdido. A venda não foi lançada de novo: confira no caixa que o valor entrou uma vez só.",
              duration: Infinity,
              closeButton: true,
            },
          );
          // a resposta perdida pode ter deixado a venda sem o vínculo: refaz (o banco repete sem duplicar)
          if (p.vinculo) await vincularPet(p.vinculo, chave, existente.pedido_id);
          continue;
        }
      }
      const { data: pedidoEnviado, error } = await supabase.rpc("frente_venda", p.params as never);
      if (error) {
        if (/fetch|network|failed/i.test(error.message)) restantes.push(p);
        else {
          restantes.push({ ...p, erro: error.message });
          toast.error("Venda guardada recusada — veja em Vendas (F7)", {
            description: `${brl(p.total)} — ${error.message}`,
          });
        }
      } else {
        ok++;
        // venda de ordem do lava rápido, plano ou pet shop: liga ao pedido que acabou de nascer
        if (p.vinculo && chave)
          await vincularPet(p.vinculo, chave, (pedidoEnviado as string) ?? null);
      }
    }
    salvarFila(restantes);
    enviando.current = false;
    if (ok) toast.success(`${ok} venda(s) guardada(s) enviada(s)`);
    if (ok || repetidas) void qc.invalidateQueries({ queryKey: ["frente-vendas"] });
  }

  useEffect(() => {
    const on = () => {
      setOnline(true);
      void enviarFila();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const t = setInterval(() => void enviarFila(), 30_000);
    void enviarFila();
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(t);
    };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: base } = useQuery({
    queryKey: ["frente-base"],
    queryFn: async () => {
      const [dep, prod, emp, cx] = await Promise.all([
        supabase.from("depositos").select("id, nome, filial_id").eq("ativo", true).order("nome"),
        supabase
          .from("produtos")
          .select(
            "id, descricao, codigo_interno, codigo_barras, unidade, unidade_venda, preco_venda",
          )
          .eq("ativo", true)
          .order("descricao"),
        supabase.from("empresas").select("pdv_desconto_limite").limit(1).maybeSingle(),
        supabase.rpc("frente_caixa_atual"),
      ]);
      let caixa = null as null | { id: string; numero: number | null; valor_abertura: number };
      if (cx.data) {
        const { data } = await supabase
          .from("caixas")
          .select("id, numero, valor_abertura")
          .eq("id", cx.data as string)
          .maybeSingle();
        caixa = data;
      }
      return {
        depositos: dep.data ?? [],
        produtos: prod.data ?? [],
        limite: Number(emp.data?.pdv_desconto_limite ?? 5),
        caixa,
      };
    },
  });
  const produtos = base?.produtos ?? [];
  const [depositoId, setDepositoIdState] = useState("");
  // o depósito escolhido fica guardado no computador (vale também ao reabrir sem internet)
  useEffect(() => {
    setDepositoIdState(localStorage.getItem("fc-deposito") ?? "");
  }, []);
  const setDepositoId = (id: string) => {
    setDepositoIdState(id);
    localStorage.setItem("fc-deposito", id);
  };
  const deposito =
    base?.depositos.find((d) => d.id === depositoId) ??
    base?.depositos.find(
      (d) => !session?.profile?.filial_id || d.filial_id === session.profile.filial_id,
    ) ??
    base?.depositos[0];
  const caixa = base?.caixa ?? null;

  const { data: vendas = [] } = useQuery({
    queryKey: ["frente-vendas", caixa?.id],
    enabled: !!caixa,
    queryFn: async () => {
      const { data } = await supabase
        .from("pedidos")
        .select("id, numero, total, forma_pagamento, situacao, created_at")
        .eq("caixa_id", caixa!.id)
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const achados = useMemo(() => {
    const t = interpretarBusca(busca).termo.toLowerCase();
    if (!t) return [];
    return produtos
      .filter(
        (p) =>
          p.descricao.toLowerCase().includes(t) ||
          (p.codigo_barras ?? "") === t ||
          (p.codigo_interno ?? "").toLowerCase() === t,
      )
      .slice(0, 8);
  }, [busca, produtos]);

  const subtotal = linhas.reduce((s, l) => s + l.quantidade * l.preco, 0);
  const descNum = Math.max(Number(desconto.replace(",", ".")) || 0, 0);
  const total = Math.max(subtotal - descNum, 0);
  const limiteValor = Math.round(subtotal * (base?.limite ?? 5)) / 100;
  const troco = Math.max((Number(recebido.replace(",", ".")) || 0) - total, 0);
  const aPrazo = forma === "crediario" || forma === "boleto";
  const cartao = forma === "cartao_credito" || forma === "cartao_debito";
  const [tef, setTef] = useState({ nsu: "", aut: "", bandeira: "" });
  const { data: tefCfg } = useQuery({
    queryKey: ["tef-config", deposito?.filial_id],
    enabled: !!deposito?.filial_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("tef_config" as never)
        .select("credenciadora, exigir_nsu, ativo, modo")
        .eq("filial_id", deposito!.filial_id!)
        .maybeSingle();
      return data as {
        credenciadora: string;
        exigir_nsu: boolean;
        ativo: boolean;
        modo: string;
      } | null;
    },
  });

  const simulado = cartao && !!tefCfg?.ativo && tefCfg.modo === "simulado";

  async function simularRecusa() {
    const { error } = await supabase.rpc(
      "tef_registrar_negada" as never,
      {
        p_filial_id: deposito?.filial_id ?? null,
        p_credenciadora: CREDENCIADORA_SIMULADA,
        p_forma: forma,
        p_valor: total,
        p_parcelas: Math.max(Number(parcelas) || 1, 1),
        p_bandeira: "Visa",
        p_motivo: MOTIVO_RECUSA_SIMULADA,
      } as never,
    );
    if (error) toast.error(error.message);
    else {
      setTef({ nsu: "", aut: "", bandeira: "" });
      toast.info("Recusa simulada registrada — a venda não foi concluída");
    }
  }

  function adicionar(
    p: {
      id: string;
      descricao: string;
      unidade: string | null;
      unidade_venda: string | null;
      preco_venda: number | null;
    },
    q: number,
  ) {
    if (q <= 0) {
      toast.error("Quantidade inválida");
      return;
    }
    setLinhas((a) => {
      const e = a.find((l) => l.produto_id === p.id);
      if (e)
        return a.map((l) =>
          l.produto_id === p.id
            ? { ...l, quantidade: Math.round((l.quantidade + q) * 1000) / 1000 }
            : l,
        );
      return [
        ...a,
        {
          produto_id: p.id,
          descricao: p.descricao,
          unidade: p.unidade_venda ?? p.unidade ?? "UN",
          preco: Number(p.preco_venda ?? 0),
          quantidade: q,
        },
      ];
    });
    setBusca("");
    setQtd("1");
    setSel(0);
    buscaRef.current?.focus();
  }

  function onEnter() {
    const { quantidade, termo: texto } = interpretarBusca(busca);
    if (!busca.trim()) return;
    if (!texto) {
      toast.error("Digite o produto depois do multiplicador (ex.: 3*cimento)");
      return;
    }
    const q = quantidade ?? parseNum(qtd);
    const termo = texto.toLowerCase();
    const exato = produtos.find(
      (p) =>
        (p.codigo_barras ?? "").toLowerCase() === termo ||
        (p.codigo_interno ?? "").toLowerCase() === termo,
    );
    const p = exato ?? achados[sel];
    if (p) adicionar(p, q);
    else toast.error("Produto não encontrado");
  }

  function pedirGestor(acao: AcaoGestor, executar: (aut: string) => void) {
    setGEmail("");
    setGSenha("");
    setGestor({ acao, executar });
  }

  const confirmarGestor = useMutation({
    mutationFn: async () =>
      autorizar({ data: { email: gEmail, senha: gSenha, acao: gestor!.acao } }),
    onSuccess: ({ autorizacaoId }) => {
      const g = gestor!;
      setGestor(null);
      g.executar(autorizacaoId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const finalizar = useMutation({
    mutationFn: async () => {
      if (!deposito) throw new Error("Nenhum depósito ativo");
      if (!linhas.length) throw new Error("Inclua itens na venda");
      if (!caixa) throw new Error("Abra o seu caixa antes de vender");
      const params = {
        p_deposito_id: deposito.id,
        ...(cliente ? { p_cliente_id: cliente.id } : {}),
        p_itens: linhas.map((l) => ({
          produto_id: l.produto_id,
          quantidade: l.quantidade,
          preco_unitario: l.preco,
        })),
        p_forma: forma,
        p_desconto: descNum,
        p_parcelas: Math.max(Number(parcelas) || 1, 1),
        ...(aPrazo ? { p_primeiro_vencimento: somaDias(hojeISO(), 30) } : {}),
        ...(autDesconto ? { p_autorizacao: autDesconto } : {}),
        // identifica esta venda: se ela for reenviada (resposta perdida, outra aba), o banco não vende de novo
        p_chave: crypto.randomUUID(),
      };
      const vinculo: VinculoPet | null = petCobranca
        ? { tipo: "atendimento", agendamentoId: petCobranca.id, usarPacote: petCobranca.usarPacote }
        : pacoteVenda
          ? {
              tipo: "pacote",
              modeloId: pacoteVenda.modeloId,
              petId: pacoteVenda.petId,
              validade: pacoteVenda.validade,
            }
          : lavaCobranca
            ? { tipo: "lava", ordemId: lavaCobranca.id }
            : planoVenda
              ? { tipo: "plano", planoId: planoVenda.planoId, veiculoId: planoVenda.veiculoId }
              : null;
      const guardar = () => {
        const atual: Pendente[] = JSON.parse(localStorage.getItem(chaveFila) ?? "[]");
        salvarFila([
          ...atual,
          {
            id: crypto.randomUUID(),
            em: new Date().toISOString(),
            total,
            params,
            // a conexão caiu no meio da venda: o vínculo vai junto, para ser feito quando a venda for enviada
            ...(vinculo ? { vinculo } : {}),
          },
        ]);
        return "offline";
      };
      if ((petCobranca || pacoteVenda || lavaCobranca || planoVenda) && !navigator.onLine)
        throw new Error("A cobrança do pet shop e do lava rápido precisa de internet");
      if (!navigator.onLine) return guardar();
      const { data, error } = await supabase.rpc("frente_venda", params);
      if (error) {
        if (/fetch|network|failed/i.test(error.message)) return guardar();
        throw error;
      }
      if (cartao && data) {
        await supabase.rpc(
          "frente_registrar_tef" as never,
          {
            p_pedido_id: data,
            p_credenciadora: simulado
              ? CREDENCIADORA_SIMULADA
              : (tefCfg?.credenciadora ?? "manual"),
            p_nsu: tef.nsu,
            p_autorizacao: tef.aut,
            p_bandeira: tef.bandeira,
          } as never,
        );
      }
      if (data) {
        if (vinculo) await vincularPet(vinculo, params.p_chave, data as string);
      }
      return data as string;
    },
    onMutate: () => {
      if (pacoteVenda) {
        const l = linhas.find((x) => x.produto_id === pacoteVenda.produto_id);
        if (!l || l.quantidade !== 1 || Math.abs(l.preco - pacoteVenda.preco) > 0.001)
          throw new Error(
            `Mantenha "${pacoteVenda.descricao}" na venda, uma vez, por ${brl(pacoteVenda.preco)}`,
          );
      }
      if (petCobranca) {
        // a venda precisa trazer cada serviço cobrado do atendimento, uma vez e pelo valor combinado
        for (const sv of petCobranca.servicos) {
          const l = linhas.find((x) => x.produto_id === sv.produto_id);
          if (!l || l.quantidade !== 1 || Math.abs(l.preco - sv.preco) > 0.001)
            throw new Error(`Mantenha "${sv.descricao}" na venda, uma vez, por ${brl(sv.preco)}`);
        }
      }
      if (planoVenda) {
        const l = linhas.find((x) => x.produto_id === planoVenda.produto_id);
        if (!l || l.quantidade !== 1 || Math.abs(l.preco - planoVenda.preco) > 0.001)
          throw new Error(
            `Mantenha "${planoVenda.descricao}" na venda, uma vez, por ${brl(planoVenda.preco)}`,
          );
      }
      if (lavaCobranca) {
        // a venda precisa trazer cada serviço da ordem, uma vez e pelo valor combinado
        for (const sv of lavaCobranca.servicos) {
          const l = linhas.find((x) => x.produto_id === sv.produto_id);
          if (!l || l.quantidade !== 1 || Math.abs(l.preco - sv.preco) > 0.001)
            throw new Error(`Mantenha "${sv.descricao}" na venda, uma vez, por ${brl(sv.preco)}`);
        }
      }
      // A resposta simulada não entra na fila offline (ela só guarda os parâmetros de frente_venda).
      if (simulado && !navigator.onLine)
        throw new Error("Modo de teste: a maquininha simulada precisa de internet");
      if (simulado && !tef.nsu)
        throw new Error("Modo de teste: clique em “Simular aprovação” antes de finalizar");
      if (cartao && tefCfg?.exigir_nsu && !tef.nsu.trim())
        throw new Error("Digite o código da transação (NSU) do comprovante da maquininha");
    },
    onSuccess: async (r) => {
      toast.success(
        r === "offline"
          ? "Sem internet: venda guardada e será enviada quando a conexão voltar"
          : `Venda concluída${!aPrazo && troco > 0 ? ` — troco ${brl(troco)}` : ""}`,
      );
      let numero = "pendente de envio";
      if (r !== "offline" && r) {
        const { data: p } = await supabase
          .from("pedidos")
          .select("numero")
          .eq("id", r)
          .maybeSingle();
        if (p?.numero != null) numero = String(p.numero);
      }
      const rec = Number(recebido.replace(",", ".")) || 0;
      setCupom({
        numero,
        emitidoEm: new Date().toLocaleString("pt-BR"),
        loja: session?.empresa?.nome_fantasia || session?.empresa?.razao_social || "Loja",
        deposito: deposito?.nome ?? "—",
        cliente: cliente?.nome ?? "Consumidor",
        vendedor: session?.profile?.nome ?? "—",
        itens: linhas.map((l) => ({
          descricao: l.descricao,
          unidade: l.unidade,
          quantidade: l.quantidade,
          preco: l.preco,
        })),
        subtotal,
        desconto: descNum,
        total,
        forma,
        parcelas: Math.max(Number(parcelas) || 1, 1),
        ...(!aPrazo && forma === "dinheiro" ? { recebido: rec, troco } : {}),
        ...(cartao
          ? {
              tef: {
                credenciadora: simulado ? CREDENCIADORA_SIMULADA : (tefCfg?.credenciadora ?? "—"),
                nsu: tef.nsu,
                autorizacao: tef.aut,
                bandeira: tef.bandeira,
                simulado,
              },
            }
          : {}),
      });
      setTef({ nsu: "", aut: "", bandeira: "" });
      if (petCobranca || pacoteVenda || lavaCobranca || planoVenda) {
        setPetCobranca(null);
        setPacoteVenda(null);
        setLavaCobranca(null);
        setPlanoVenda(null);
        planoCarregado.current = null;
        petCarregado.current = null;
        pacoteCarregado.current = null;
        lavaCarregada.current = null;
        void navegar({ to: "/frente-caixa", search: {} });
      }
      setLinhas([]);
      setDesconto("0");
      setRecebido("");
      setAutDesconto(null);
      setPedidoCupom(r !== "offline" && r ? r : null);
      setModal("cupom");
      setForma("dinheiro");
      setParcelas("1");
      setCliente(null);
      void qc.invalidateQueries({ queryKey: ["frente-vendas"] });
      setTimeout(() => buscaRef.current?.focus(), 50);
    },
    onError: (e: Error) => toast.error("Não foi possível finalizar", { description: e.message }),
  });

  const cancelarVenda = useMutation({
    mutationFn: async ({ id, aut }: { id: string; aut: string }) => {
      const { error } = await supabase.rpc("frente_cancelar_venda", {
        p_pedido_id: id,
        p_autorizacao: aut,
        p_motivo: "Cancelada no caixa",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda cancelada, estoque devolvido");
      void qc.invalidateQueries({ queryKey: ["frente-vendas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const movimentar = useMutation({
    mutationFn: async (aut: string | null) => {
      const valor = Number(mov.valor.replace(",", ".")) || 0;
      if (valor <= 0) throw new Error("Informe o valor");
      const { error } = await supabase.rpc("frente_movimento", {
        p_tipo: mov.tipo,
        p_valor: valor,
        p_descricao: mov.descricao || (mov.tipo === "sangria" ? "Sangria" : "Suprimento"),
        ...(aut ? { p_autorizacao: aut } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Movimento registrado");
      setModal(null);
      setMov({ tipo: "suprimento", valor: "", descricao: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const abrirCaixa = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("frente_abrir_caixa", {
        p_filial_id:
          deposito?.filial_id ?? session?.profile?.filial_id ?? (null as unknown as string),
        p_valor_abertura: Number(valorCaixa.replace(",", ".")) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caixa aberto");
      setModal(null);
      setValorCaixa("");
      void qc.invalidateQueries({ queryKey: ["frente-base"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const fecharCaixa = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("fechar_caixa", {
        p_caixa_id: caixa!.id,
        p_valor_informado: Number(valorCaixa.replace(",", ".")) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Caixa fechado");
      setModal(null);
      setValorCaixa("");
      void qc.invalidateQueries({ queryKey: ["frente-base"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const trocarOperador = useMutation({
    mutationFn: async () => {
      await trocarOperadorLogin(opEmail, opSenha);
    },
    onSuccess: () => {
      setModal(null);
      setOpSenha("");
      setLinhas([]);
      void qc.invalidateQueries();
      toast.success("Operador conectado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const consultarIa = useMutation({
    mutationFn: async () => sugerir({ data: { texto: textoIa } }),
    onSuccess: (r) => {
      setSugestoes({
        observacao: r.observacao,
        itens: r.itens.map((i) => {
          const p = produtos.find((x) => x.id === i.produto_id);
          return {
            produto_id: i.produto_id,
            descricao: i.descricao,
            quantidade: i.quantidade,
            motivo: i.motivo,
            marcado: true,
            unidade: p?.unidade_venda ?? p?.unidade ?? "UN",
            preco: Number(p?.preco_venda ?? 0),
          };
        }),
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function aplicarDesconto(valor: string) {
    const v = Math.max(Number(valor.replace(",", ".")) || 0, 0);
    if (v > limiteValor) {
      pedirGestor("desconto", (aut) => {
        setAutDesconto(aut);
        setDesconto(valor);
        setModal(null);
        toast.success("Desconto autorizado");
      });
    } else {
      setAutDesconto(null);
      setDesconto(valor);
      setModal(null);
    }
  }

  const [descTexto, setDescTexto] = useState("");

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Escape") {
        if (gestor) setGestor(null);
        else setModal(null);
        return;
      }
      if (gestor) return;
      if (k === "F10" && modal === "pagamento") {
        e.preventDefault();
        finalizar.mutate();
        return;
      }
      if (modal) return;
      const mapa: Record<string, () => void> = {
        F2: () => buscaRef.current?.focus(),
        F3: () => {
          setSugestoes(null);
          setModal("ia");
        },
        F4: () => {
          if (!caixa) toast.error("Abra o seu caixa");
          else if (!linhas.length) toast.error("Carrinho vazio");
          else setModal("pagamento");
        },
        F5: () => colocarEmEspera(),
        F6: () => {
          setDescTexto(desconto);
          setModal("desconto");
        },
        F7: () => setModal("vendas"),
        F8: () => setLinhas((a) => a.slice(0, -1)),
        F9: () => setModal("movimento"),
        F11: () => setModal("espera"),
      };
      if (mapa[k]) {
        e.preventDefault();
        mapa[k]();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  useEffect(() => {
    buscaRef.current?.focus();
  }, [caixa?.id]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b bg-sidebar px-4 py-2 text-sidebar-foreground">
        <div className="font-display text-lg font-semibold">Frente de caixa</div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            Operador: <b>{session?.profile?.nome ?? session?.user.email}</b>
          </span>
          <span>{caixa ? `Caixa nº ${caixa.numero ?? "—"} aberto` : "Caixa fechado"}</span>
          <span className={online ? "" : "font-semibold text-destructive"}>
            {online ? "Online" : "Sem internet"}
            {fila.length ? ` · ${fila.length} venda(s) a enviar` : ""}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setModal("espera")}>
            Em espera ({esperas.length})
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setModal("cliente")}>
            F12 · Cliente: {cliente ? cliente.nome : "Consumidor final"}
          </Button>
          <select
            aria-label="Depósito"
            className="rounded bg-sidebar px-2 py-1 text-sm"
            value={deposito?.id ?? ""}
            onChange={(e) => setDepositoId(e.target.value)}
          >
            {base?.depositos.map((d) => (
              <option key={d.id} value={d.id}>
                {d.nome}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={() => setModal("operador")}>
            Trocar operador
          </Button>
          {caixa ? (
            <Button size="sm" variant="secondary" onClick={() => setModal("fechar")}>
              Fechar caixa
            </Button>
          ) : (
            <Button size="sm" onClick={() => setModal("abrir")}>
              Abrir caixa
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link to="/dashboard">
              <X className="size-4" /> Sair
            </Link>
          </Button>
        </div>
      </header>

      {!caixa ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-lg">Abra o seu caixa para começar a vender.</p>
          <Button onClick={() => setModal("abrir")}>Abrir caixa</Button>
        </div>
      ) : (
        <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_360px]">
          <div className="flex min-h-0 flex-col gap-3">
            <div className="flex gap-2">
              <Input
                className="w-24 text-lg"
                value={qtd}
                onChange={(e) => setQtd(e.target.value)}
                aria-label="Quantidade"
              />
              <div className="relative flex-1">
                <Input
                  ref={buscaRef}
                  className="h-12 text-lg"
                  placeholder="F2 — código de barras, código ou nome (ex.: 3*cimento)"
                  value={busca}
                  onChange={(e) => {
                    setBusca(e.target.value);
                    setSel(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onEnter();
                    }
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSel((s) => Math.min(s + 1, achados.length - 1));
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSel((s) => Math.max(s - 1, 0));
                    }
                  }}
                />
                {achados.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow">
                    {achados.map((p, i) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          adicionar(p, interpretarBusca(busca).quantidade ?? parseNum(qtd))
                        }
                        className={`flex w-full justify-between px-3 py-2 text-left text-sm ${i === sel ? "bg-mint/30" : ""}`}
                      >
                        <span>{p.descricao}</span>
                        <span className="text-numeric">{brl(p.preco_venda)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                className="h-12"
                onClick={() => {
                  setSugestoes(null);
                  setModal("ia");
                }}
              >
                <Sparkles className="size-4" /> F3 IA
              </Button>
            </div>

            {pendenciasPet
              .filter((p) => p.erro)
              .map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm"
                >
                  <span>
                    <strong>
                      Venda do{" "}
                      {p.v.tipo === "lava" || p.v.tipo === "plano" ? "lava rápido" : "pet shop"}{" "}
                      recebida, mas não ligada:
                    </strong>{" "}
                    {p.v.tipo === "atendimento"
                      ? "atendimento"
                      : p.v.tipo === "lava"
                        ? "ordem"
                        : p.v.tipo === "plano"
                          ? "plano"
                          : "pacote"}{" "}
                    — {p.erro}. O dinheiro já entrou: resolva antes de cobrar de novo.
                  </span>
                  <span className="space-x-2">
                    <Button size="sm" onClick={() => void vincularPet(p.v, p.chave, null)}>
                      Tentar de novo
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => atualizarPendencias((l) => l.filter((x) => x.id !== p.id))}
                    >
                      Descartar
                    </Button>
                  </span>
                </div>
              ))}
            {pacoteVenda && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  <strong>Vendendo pacote de banhos:</strong> {pacoteVenda.descricao} para{" "}
                  {pacoteVenda.pet}
                  {pacoteVenda.tutor ? ` (${pacoteVenda.tutor})` : ""}, válido por{" "}
                  {pacoteVenda.validade} dias. Mantenha o pacote na venda e escolha a forma de
                  pagamento.
                </span>
                <Button size="sm" variant="outline" onClick={desistirDaCobrancaPet}>
                  Desistir da venda do pacote
                </Button>
              </div>
            )}
            {petCobranca && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  <strong>Cobrando atendimento do pet shop:</strong> {petCobranca.pet}
                  {petCobranca.tutor ? ` (${petCobranca.tutor})` : ""}.{" "}
                  {petCobranca.usarPacote
                    ? "Os banhos cobertos pelo pacote saem do pacote e não entram na venda. "
                    : ""}
                  Mantenha os serviços na venda; pode somar produtos e escolher a forma de
                  pagamento.
                </span>
                <Button size="sm" variant="outline" onClick={desistirDaCobrancaPet}>
                  Desistir da cobrança
                </Button>
              </div>
            )}

            {planoVenda && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  <strong>Vendendo plano de lavagens:</strong> {planoVenda.descricao} para{" "}
                  {planoVenda.veiculo}
                  {planoVenda.cliente ? ` (${planoVenda.cliente})` : ""}. Mantenha o plano na venda
                  e escolha a forma de pagamento.
                </span>
                <Button size="sm" variant="outline" onClick={desistirDaCobrancaPet}>
                  Desistir da venda
                </Button>
              </div>
            )}

            {lavaCobranca && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <span>
                  <strong>Cobrando ordem do lava rápido:</strong> {lavaCobranca.veiculo}
                  {lavaCobranca.cliente ? ` (${lavaCobranca.cliente})` : ""}. Mantenha os serviços
                  na venda; pode somar produtos e escolher a forma de pagamento.
                </span>
                <Button size="sm" variant="outline" onClick={desistirDaCobrancaPet}>
                  Desistir da cobrança
                </Button>
              </div>
            )}

            <div className="panel min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-left">
                  <tr>
                    <th className="p-2">#</th>
                    <th className="p-2">Produto</th>
                    <th className="p-2 text-right">Qtd</th>
                    <th className="p-2 text-right">Preço</th>
                    <th className="p-2 text-right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={l.produto_id} className="border-t">
                      <td className="p-2">{i + 1}</td>
                      <td className="p-2">{l.descricao}</td>
                      <td className="p-2 text-right text-numeric">
                        {num(l.quantidade, 3)} {l.unidade}
                      </td>
                      <td className="p-2 text-right text-numeric">{brl(l.preco)}</td>
                      <td className="p-2 text-right text-numeric font-semibold">
                        {brl(l.quantidade * l.preco)}
                      </td>
                      <td className="p-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setLinhas((a) => a.filter((x) => x.produto_id !== l.produto_id))
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {!linhas.length && (
                    <tr>
                      <td colSpan={6} className="p-10 text-center text-muted-foreground">
                        Passe o código de barras ou digite o produto.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="flex flex-col gap-3">
            <div className="panel space-y-1 p-4">
              <div className="flex justify-between text-sm">
                <span>Subtotal</span>
                <span className="text-numeric">{brl(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Desconto {autDesconto && "(autorizado)"}</span>
                <span className="text-numeric">{brl(descNum)}</span>
              </div>
              <div className="flex justify-between pt-2 font-display text-3xl font-bold text-primary">
                <span>Total</span>
                <span className="text-numeric">{brl(total)}</span>
              </div>
            </div>
            <div className="panel grid grid-cols-2 gap-1 p-3 text-xs">
              {[
                ["F2", "Buscar produto"],
                ["Enter", "Adicionar item"],
                ["F3", "Sugestão por IA"],
                ["F4", "Pagamento"],
                ["F5", "Pôr venda em espera"],
                ["F11", "Vendas em espera"],
                ["F6", "Desconto"],
                ["F7", "Vendas / cancelar"],
                ["F8", "Remover último item"],
                ["F9", "Sangria / suprimento"],
                ["F10", "Finalizar (no pagamento)"],
                ["Esc", "Fechar janela"],
              ].map(([k, t]) => (
                <div key={k} className="flex gap-2">
                  <kbd className="rounded border bg-muted px-1.5 font-mono">{k}</kbd>
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <Button
              size="lg"
              className="h-14 text-lg"
              disabled={!linhas.length}
              onClick={() => setModal("pagamento")}
            >
              F4 — Pagamento
            </Button>
          </aside>
        </div>
      )}

      {/* Pagamento */}
      <Dialog open={modal === "pagamento"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagamento — {brl(total)}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {formasPagamento.map((f, i) => (
              <Button
                key={f.value}
                variant={forma === f.value ? "default" : "outline"}
                onClick={() => setForma(f.value)}
              >
                {i + 1}. {f.label}
              </Button>
            ))}
          </div>
          {aPrazo ? (
            <div>
              <Label>Parcelas</Label>
              <Input value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
            </div>
          ) : (
            <div>
              <Label>Valor recebido</Label>
              <Input
                autoFocus
                className="text-lg"
                value={recebido}
                onChange={(e) => setRecebido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") finalizar.mutate();
                }}
              />
              <p className="mt-2 font-display text-2xl font-bold">Troco: {brl(troco)}</p>
            </div>
          )}
          {simulado && (
            <div className="space-y-2 rounded border border-amber-500 bg-amber-50 p-2 text-amber-950">
              <p className="text-xs font-semibold">
                MODO DE TESTE — nenhuma cobrança real. A venda grava NSU e autorização de exemplo.
              </p>
              {tef.nsu ? (
                <p className="text-sm">
                  Aprovada · NSU {tef.nsu} · Aut. {tef.aut} · {tef.bandeira}
                </p>
              ) : (
                <p className="text-sm">Simule a resposta da maquininha e depois finalize.</p>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const r = gerarRespostaSimulada();
                    setTef({ nsu: r.nsu, aut: r.autorizacao, bandeira: r.bandeira });
                  }}
                >
                  Simular aprovação
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void simularRecusa()}
                >
                  Simular recusa
                </Button>
              </div>
            </div>
          )}
          {cartao && !simulado && (
            <div className="grid grid-cols-3 gap-2 rounded border p-2">
              <p className="col-span-3 text-xs text-muted-foreground">
                Maquininha {tefCfg?.credenciadora ?? "(não configurada)"} — passe o cartão e digite
                o comprovante.
              </p>
              <div>
                <Label>Código (NSU)</Label>
                <Input value={tef.nsu} onChange={(e) => setTef({ ...tef, nsu: e.target.value })} />
              </div>
              <div>
                <Label>Autorização</Label>
                <Input value={tef.aut} onChange={(e) => setTef({ ...tef, aut: e.target.value })} />
              </div>
              <div>
                <Label>Bandeira</Label>
                <Input
                  value={tef.bandeira}
                  placeholder="Visa"
                  onChange={(e) => setTef({ ...tef, bandeira: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => finalizar.mutate()} disabled={finalizar.isPending}>
              F10 — Finalizar venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desconto */}
      <Dialog open={modal === "desconto"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desconto na venda</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Até {brl(limiteValor)} ({num(base?.limite ?? 5)}%) sem senha. Acima disso, pede a senha
            do gestor.
          </p>
          <Input
            autoFocus
            value={descTexto}
            onChange={(e) => setDescTexto(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && aplicarDesconto(descTexto)}
          />
          <DialogFooter>
            <Button onClick={() => aplicarDesconto(descTexto)}>Aplicar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* IA */}
      <Dialog open={modal === "ia"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>O que o cliente procura?</DialogTitle>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={3}
            placeholder="Ex.: quero rebocar uma parede de 3 por 4 metros"
            value={textoIa}
            onChange={(e) => setTextoIa(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.ctrlKey) consultarIa.mutate();
            }}
          />
          <Button
            onClick={() => consultarIa.mutate()}
            disabled={consultarIa.isPending || textoIa.trim().length < 3}
          >
            <Sparkles className="size-4" />{" "}
            {consultarIa.isPending ? "Procurando produtos..." : "Sugerir produtos (Ctrl+Enter)"}
          </Button>
          {sugestoes && (
            <div className="space-y-2">
              {sugestoes.itens.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum produto correspondente no catálogo.
                </p>
              )}
              {sugestoes.itens.map((s, i) => (
                <label
                  key={s.produto_id}
                  className="flex items-start gap-2 rounded border p-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={s.marcado}
                    onChange={(e) =>
                      setSugestoes({
                        ...sugestoes,
                        itens: sugestoes.itens.map((x, j) =>
                          j === i ? { ...x, marcado: e.target.checked } : x,
                        ),
                      })
                    }
                  />
                  <div className="flex-1">
                    <b>{s.descricao}</b> — {brl(s.preco)}
                    <p className="text-xs text-muted-foreground">{s.motivo}</p>
                  </div>
                  <Input
                    className="w-24"
                    defaultValue={String(s.quantidade).replace(".", ",")}
                    onChange={(e) =>
                      setSugestoes({
                        ...sugestoes,
                        itens: sugestoes.itens.map((x, j) =>
                          j === i ? { ...x, quantidade: parseNum(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                  <span className="pt-2 text-xs">{s.unidade}</span>
                </label>
              ))}
              {sugestoes.observacao && (
                <p className="text-xs text-muted-foreground">{sugestoes.observacao}</p>
              )}
            </div>
          )}
          {sugestoes && sugestoes.itens.length > 0 && (
            <DialogFooter>
              <Button
                onClick={() => {
                  for (const s of sugestoes.itens.filter((x) => x.marcado && x.quantidade > 0)) {
                    const p = produtos.find((x) => x.id === s.produto_id);
                    if (p) adicionar(p, s.quantidade);
                  }
                  setModal(null);
                  setTextoIa("");
                }}
              >
                Adicionar selecionados à venda
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Sangria / suprimento */}
      <Dialog open={modal === "movimento"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sangria ou suprimento</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={mov.tipo === "suprimento" ? "default" : "outline"}
              onClick={() => setMov({ ...mov, tipo: "suprimento" })}
            >
              Suprimento
            </Button>
            <Button
              variant={mov.tipo === "sangria" ? "default" : "outline"}
              onClick={() => setMov({ ...mov, tipo: "sangria" })}
            >
              Sangria (senha do gestor)
            </Button>
          </div>
          <div>
            <Label>Valor</Label>
            <Input
              autoFocus
              value={mov.valor}
              onChange={(e) => setMov({ ...mov, valor: e.target.value })}
            />
          </div>
          <div>
            <Label>Descrição</Label>
            <Input
              value={mov.descricao}
              onChange={(e) => setMov({ ...mov, descricao: e.target.value })}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() =>
                mov.tipo === "sangria"
                  ? pedirGestor("sangria", (aut) => movimentar.mutate(aut))
                  : movimentar.mutate(null)
              }
            >
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vendas do caixa */}
      <Dialog
        open={modal === "cupom"}
        onOpenChange={(o) => {
          if (!o) {
            setModal(null);
            setTimeout(() => buscaRef.current?.focus(), 50);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cupom da venda (80 mm)</DialogTitle>
          </DialogHeader>
          {cupom && modal === "cupom" && (
            <div className="max-h-[60vh] overflow-auto rounded border">
              <CupomFiscal dados={cupom} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setModal(null)}>
              Fechar (Esc)
            </Button>
            <Button
              variant="outline"
              disabled={!pedidoCupom}
              title={
                pedidoCupom ? undefined : "Disponível depois que a venda for enviada ao sistema"
              }
              onClick={() => {
                setPedidoNfce(pedidoCupom);
                setModal("nfce");
              }}
            >
              Emitir NFC-e
            </Button>
            <Button autoFocus onClick={() => window.print()}>
              Imprimir cupom
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={modal === "nfce"}
        onOpenChange={(o) => {
          if (!o) {
            setModal(null);
            setTimeout(() => buscaRef.current?.focus(), 50);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>NFC-e da venda</DialogTitle>
          </DialogHeader>
          {pedidoNfce && modal === "nfce" ? <EmitirNfce pedidoId={pedidoNfce} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={modal === "vendas"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Vendas deste caixa</DialogTitle>
          </DialogHeader>
          <div className="max-h-96 space-y-1 overflow-auto">
            {vendas.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma venda ainda.</p>
            )}
            {vendas.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between rounded border p-2 text-sm"
              >
                <span>
                  Nº {v.numero} · {labelForma(v.forma_pagamento)} · {brl(v.total)}
                </span>
                {v.situacao === "cancelado" ? (
                  <span className="text-destructive">Cancelada</span>
                ) : (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPedidoNfce(v.id);
                        setModal("nfce");
                      }}
                    >
                      NFC-e
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        pedirGestor("cancelar_venda", (aut) =>
                          cancelarVenda.mutate({ id: v.id, aut }),
                        )
                      }
                    >
                      Cancelar
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Abrir / fechar caixa */}
      <Dialog
        open={modal === "abrir" || modal === "fechar"}
        onOpenChange={(o) => !o && setModal(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{modal === "abrir" ? "Abrir caixa" : "Fechar caixa"}</DialogTitle>
          </DialogHeader>
          <Label>
            {modal === "abrir" ? "Valor de abertura (troco)" : "Dinheiro contado na gaveta"}
          </Label>
          <Input autoFocus value={valorCaixa} onChange={(e) => setValorCaixa(e.target.value)} />
          <DialogFooter>
            <Button
              onClick={() => (modal === "abrir" ? abrirCaixa.mutate() : fecharCaixa.mutate())}
            >
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vendas em espera */}
      <Dialog open={modal === "espera"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vendas em espera</DialogTitle>
          </DialogHeader>
          {esperas.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma venda em espera. Use F5 para guardar a venda atual.
            </p>
          )}
          <div className="space-y-2">
            {esperas.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
              >
                <div>
                  <b>{brl(e.linhas.reduce((s, l) => s + l.preco * l.quantidade, 0))}</b> ·{" "}
                  {e.linhas.length} item(ns)
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.em).toLocaleTimeString("pt-BR")} —{" "}
                    {e.linhas
                      .slice(0, 2)
                      .map((l) => l.descricao)
                      .join(", ")}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" onClick={() => retomar(e)}>
                    Retomar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => salvarEsperas(esperas.filter((x) => x.id !== e.id))}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          {fila.some((p) => !p.erro) && (
            <p className="text-xs text-muted-foreground">
              {fila.filter((p) => !p.erro).length} venda(s) finalizada(s) sem internet aguardando
              envio ({brl(fila.filter((p) => !p.erro).reduce((s, p) => s + p.total, 0))}).{" "}
              <Button size="sm" variant="link" onClick={() => void enviarFila()}>
                Enviar agora
              </Button>
            </p>
          )}
          {fila
            .filter((p) => p.erro)
            .map((p) => (
              <div
                key={p.id}
                className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs"
              >
                <p className="font-semibold">
                  Venda de {brl(p.total)} feita sem internet em{" "}
                  {new Date(p.em).toLocaleString("pt-BR")} foi recusada
                </p>
                <p>{p.erro}</p>
                <p className="text-muted-foreground">
                  O dinheiro já foi recebido: corrija o motivo (ex.: lance a entrada no estoque) e
                  envie de novo.
                </p>
                <div className="mt-1 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      salvarFila(fila.map((x) => (x.id === p.id ? { ...x, erro: undefined } : x)));
                      setTimeout(() => void enviarFila(), 50);
                    }}
                  >
                    Tentar de novo
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Descartar esta venda guardada? Ela não entrará no caixa."))
                        salvarFila(fila.filter((x) => x.id !== p.id));
                    }}
                  >
                    Descartar
                  </Button>
                </div>
              </div>
            ))}
        </DialogContent>
      </Dialog>

      {/* Trocar operador */}
      <Dialog open={modal === "operador"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Entrar como outro operador</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Usuário ou e-mail</Label>
            <Input autoFocus value={opEmail} onChange={(e) => setOpEmail(e.target.value)} />
          </div>
          <div>
            <Label>Senha</Label>
            <Input
              type="password"
              value={opSenha}
              onChange={(e) => setOpSenha(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && trocarOperador.mutate()}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => trocarOperador.mutate()}>Entrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Senha do gestor */}
      <Dialog open={!!gestor} onOpenChange={(o) => !o && setGestor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Senha do gestor — {gestor && rotuloAcao[gestor.acao]}</DialogTitle>
          </DialogHeader>
          <div>
            <Label>E-mail do gestor</Label>
            <Input autoFocus value={gEmail} onChange={(e) => setGEmail(e.target.value)} />
          </div>
          <div>
            <Label>Senha</Label>
            <Input
              type="password"
              value={gSenha}
              onChange={(e) => setGSenha(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmarGestor.mutate()}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => confirmarGestor.mutate()} disabled={confirmarGestor.isPending}>
              Autorizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
