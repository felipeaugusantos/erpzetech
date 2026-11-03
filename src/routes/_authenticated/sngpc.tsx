import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ModuloBloqueado } from "@/components/app/ModuloCnae";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { cnpjAlfaValido } from "@/lib/cnpj-alfa";
import { brl, dateBR, dateTimeBR } from "@/lib/format";
import {
  LISTAS_PORTARIA,
  MOTIVOS_PERDA,
  ROTULO_LANCAMENTO,
  TIPOS_RECEITUARIO,
  TIPO_DOCUMENTO_COMPRADOR,
  UNIDADES_MEDIDA,
  dataTravada,
  erroDoItem,
  idadeParaSngpc,
  rotuloMotivoPerda,
  rotuloReceituario,
  rotuloUnidade,
  sexoParaSngpc,
  soNumeros,
  somaPorLote,
  type DocumentoLivro,
  type EnvioSngpc,
  type InventarioSngpc,
  type MedicamentoControlado,
  type PeriodoSngpc,
  type PeriodoTravado,
  type ResponsavelSngpc,
  type SaldoLote,
  type TipoLancamento,
} from "@/lib/sngpc";
import {
  criarZip,
  gerarXmlInventario,
  gerarXmlMovimentacao,
  nomeDoArquivo,
  paraLatin1,
  resumoDoPeriodo,
} from "@/lib/sngpc-xml";
import { UFS_CRMV } from "@/lib/pet";

export const Route = createFileRoute("/_authenticated/sngpc")({
  head: () => ({
    meta: [
      { title: "SNGPC — EZRA ERP" },
      {
        name: "description",
        content:
          "Livro dos medicamentos controlados de uso veterinário e geração dos arquivos do SNGPC.",
      },
    ],
  }),
  component: SngpcModulo,
});

const NENHUM = "__nenhum";

function SngpcModulo() {
  const modulos = useModulosCnae();
  const { data: session } = useSessionData();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  const pode = (session?.roles ?? []).some((r) =>
    ["administrador", "gestor", "veterinario"].includes(r),
  );
  if (!pode)
    return (
      <EmptyState
        title="Sem acesso ao SNGPC"
        description="O livro dos controlados é do administrador, do gestor e do veterinário."
      />
    );
  return <Sngpc />;
}

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const somaDias = (iso: string, dias: number) => {
  const [a, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(a, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

function Sngpc() {
  const medicamentos = useQuery({
    queryKey: ["sngpc-medicamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sngpc_medicamentos");
      if (error) throw error;
      return (data ?? []) as unknown as MedicamentoControlado[];
    },
  });
  const saldo = useQuery({
    queryKey: ["sngpc-saldo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sngpc_saldo", {});
      if (error) throw error;
      return (data ?? []) as unknown as SaldoLote[];
    },
  });

  return (
    <div>
      <PageHeader
        title="SNGPC — medicamentos controlados"
        description="Livro dos medicamentos de controle especial de uso veterinário (Portaria 344) e geração dos arquivos para o SNGPC. Confirme com o responsável técnico se a clínica deve enviar ao SNGPC."
      />
      <Tabs defaultValue="livro">
        <TabsList>
          <TabsTrigger value="livro">Livro</TabsTrigger>
          <TabsTrigger value="medicamentos">Medicamentos</TabsTrigger>
          <TabsTrigger value="envios">Envios</TabsTrigger>
        </TabsList>
        <TabsContent value="livro">
          <Livro medicamentos={medicamentos.data ?? []} saldo={saldo.data ?? []} />
        </TabsContent>
        <TabsContent value="medicamentos">
          <Medicamentos lista={medicamentos.data ?? []} carregando={medicamentos.isLoading} />
        </TabsContent>
        <TabsContent value="envios">
          <Envios />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------- medicamentos

function Medicamentos({
  lista,
  carregando,
}: {
  lista: MedicamentoControlado[];
  carregando: boolean;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({
    id: "",
    produto_id: "",
    registro: "",
    lista: "B1",
    unidade: "1",
    ativo: true,
  });
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");

  const produtos = useQuery({
    queryKey: ["sngpc-produtos", termo],
    enabled: termo.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao")
        .eq("ativo", true)
        .ilike("descricao", `%${termo}%`)
        .order("descricao")
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!form.id && !form.produto_id) throw new Error("Escolha o produto do cadastro.");
      if (soNumeros(form.registro).length !== 13)
        throw new Error("O registro na Anvisa tem 13 números.");
      const { error } = await supabase.rpc("sngpc_medicamento_salvar", {
        p_dados: {
          ...(form.id ? { id: form.id } : { produto_id: form.produto_id }),
          registro_ms: soNumeros(form.registro),
          lista: form.lista,
          unidade_medida: Number(form.unidade),
          ativo: form.ativo,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Medicamento controlado salvo.");
      setAberto(false);
      void qc.invalidateQueries({ queryKey: ["sngpc-medicamentos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-4">
      <div className="mb-3 flex justify-end">
        <Button
          onClick={() => {
            setForm({
              id: "",
              produto_id: "",
              registro: "",
              lista: "B1",
              unidade: "1",
              ativo: true,
            });
            setBusca("");
            setTermo("");
            setAberto(true);
          }}
        >
          <Plus className="size-4" /> Novo medicamento controlado
        </Button>
      </div>
      {carregando ? (
        <div className="panel h-32 animate-pulse" />
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum medicamento controlado cadastrado"
          description="Escolha um produto do cadastro e informe o registro na Anvisa, a lista da Portaria 344 e a unidade."
        />
      ) : (
        <div className="panel overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Registro (Anvisa)</TableHead>
                <TableHead>Lista</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((m) => (
                <TableRow key={m.id} className={m.ativo ? "" : "opacity-60"}>
                  <TableCell className="font-medium">
                    {m.produto}
                    {!m.ativo && (
                      <Badge variant="outline" className="ml-2">
                        Inativo
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-numeric">{m.registro_ms}</TableCell>
                  <TableCell>{m.lista}</TableCell>
                  <TableCell>{rotuloUnidade(m.unidade_medida)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${m.produto}`}
                      onClick={() => {
                        setForm({
                          id: m.id,
                          produto_id: m.produto_id,
                          registro: m.registro_ms,
                          lista: m.lista,
                          unidade: String(m.unidade_medida),
                          ativo: m.ativo,
                        });
                        setAberto(true);
                      }}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Editar medicamento controlado" : "Novo medicamento controlado"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {!form.id && (
              <div>
                <Label htmlFor="sg-busca">Produto do cadastro</Label>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setTermo(busca.trim());
                    setForm({ ...form, produto_id: "" });
                  }}
                >
                  <Input
                    id="sg-busca"
                    placeholder="Nome do produto"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                  />
                  <Button type="submit" variant="outline" disabled={busca.trim().length < 2}>
                    Buscar
                  </Button>
                </form>
                {termo && (
                  <Select
                    value={form.produto_id || NENHUM}
                    onValueChange={(v) => setForm({ ...form, produto_id: v === NENHUM ? "" : v })}
                  >
                    <SelectTrigger className="mt-2" aria-label="Produto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUM}>
                        {produtos.isLoading
                          ? "Buscando…"
                          : (produtos.data ?? []).length
                            ? "Escolha…"
                            : "Nenhum produto encontrado"}
                      </SelectItem>
                      {(produtos.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.descricao}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="sg-reg">Registro na Anvisa (13 números)</Label>
              <Input
                id="sg-reg"
                inputMode="numeric"
                value={form.registro}
                onChange={(e) => setForm({ ...form, registro: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sg-lista">Lista da Portaria 344</Label>
                <Select value={form.lista} onValueChange={(v) => setForm({ ...form, lista: v })}>
                  <SelectTrigger id="sg-lista">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTAS_PORTARIA.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="sg-un">Unidade de medida</Label>
                <Select
                  value={form.unidade}
                  onValueChange={(v) => setForm({ ...form, unidade: v })}
                >
                  <SelectTrigger id="sg-un">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIDADES_MEDIDA.map((u) => (
                      <SelectItem key={u.value} value={String(u.value)}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="sg-ativo"
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />
              <Label htmlFor="sg-ativo">Ativo</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Depois do primeiro movimento, o registro e a unidade não mudam (o livro e os arquivos
              enviados dependem deles).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- livro

function resumoDoLancamento(d: DocumentoLivro) {
  if (d.tipo === "entrada")
    return `NF ${d.nf_numero} de ${dateBR(d.nf_data)} · CNPJ ${d.cnpj_origem}`;
  if (d.tipo === "venda")
    return `${rotuloReceituario(d.tipo_receituario).split(" (")[0]} nº ${d.numero_notificacao} · ${d.prescritor_nome} (CRMV ${d.prescritor_registro}/${d.prescritor_uf}) · tutor(a) ${d.comprador_nome}${d.paciente_nome ? ` · ${d.paciente_nome}` : ""}`;
  if (d.tipo === "perda") return rotuloMotivoPerda(d.motivo_perda);
  return "Saldo na abertura do livro";
}

function Livro({
  medicamentos,
  saldo,
}: {
  medicamentos: MedicamentoControlado[];
  saldo: SaldoLote[];
}) {
  const qc = useQueryClient();
  const [lancando, setLancando] = useState<TipoLancamento | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const livro = useQuery({
    queryKey: ["sngpc-livro"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sngpc_livro", {});
      if (error) throw error;
      return data as unknown as {
        fechado_ate: string | null;
        periodos_travados: PeriodoTravado[];
        documentos: DocumentoLivro[];
      };
    },
  });

  const recarregar = () => {
    void qc.invalidateQueries({ queryKey: ["sngpc-livro"] });
    void qc.invalidateQueries({ queryKey: ["sngpc-saldo"] });
  };
  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("sngpc_cancelar", {
        p_id: cancelando,
        p_motivo: motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento cancelado.");
      setCancelando(null);
      setMotivo("");
      recarregar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ativos = medicamentos.filter((m) => m.ativo);
  const docs = livro.data?.documentos ?? [];
  const fechado = livro.data?.fechado_ate ?? null;
  const travados = livro.data?.periodos_travados ?? [];

  return (
    <div className="mt-4 grid gap-4">
      {fechado && (
        <p className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm">
          <TriangleAlert className="size-4" /> Período fechado até {dateBR(fechado)}: o que já foi
          transmitido ao SNGPC não muda.
        </p>
      )}
      {travados.some((t) => t.situacao === "gerado") && (
        <p className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3 text-sm">
          <TriangleAlert className="size-4" /> Há arquivo gerado (ainda não transmitido) para{" "}
          {travados
            .filter((t) => t.situacao === "gerado")
            .map((t) => `${dateBR(t.inicio)} a ${dateBR(t.fim)}`)
            .join("; ")}
          : o livro dessas datas não muda. Para lançar ou cancelar nelas, cancele o arquivo gerado
          na aba Envios.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {(["saldo_inicial", "entrada", "venda", "perda"] as TipoLancamento[]).map((t) => (
          <Button
            key={t}
            variant={t === "venda" ? "default" : "outline"}
            onClick={() => setLancando(t)}
            disabled={ativos.length === 0}
          >
            <Plus className="size-4" /> {ROTULO_LANCAMENTO[t]}
          </Button>
        ))}
        {ativos.length === 0 && (
          <p className="self-center text-sm text-muted-foreground">
            Cadastre um medicamento controlado primeiro.
          </p>
        )}
      </div>

      <div>
        <h3 className="mb-1 font-display text-base font-semibold">Saldo por lote</h3>
        {saldo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum lote com saldo. Comece pelo saldo inicial.
          </p>
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Lista</TableHead>
                  <TableHead>Lote</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {saldo.map((s) => (
                  <TableRow key={`${s.medicamento_id}${s.lote}`}>
                    <TableCell className="font-medium">{s.produto}</TableCell>
                    <TableCell>{s.lista}</TableCell>
                    <TableCell className="text-numeric">{s.lote}</TableCell>
                    <TableCell>{s.validade ? dateBR(s.validade) : "—"}</TableCell>
                    <TableCell className="text-right text-numeric font-semibold">
                      {s.saldo} {rotuloUnidade(s.unidade_medida).toLowerCase()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1 font-display text-base font-semibold">Lançamentos</h3>
        {livro.isLoading ? (
          <div className="panel h-32 animate-pulse" />
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lançamento ainda.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Detalhes</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id} className={d.cancelado_em ? "opacity-60" : ""}>
                    <TableCell className="whitespace-nowrap">{dateBR(d.data)}</TableCell>
                    <TableCell>
                      <Badge variant={d.tipo === "venda" ? "default" : "secondary"}>
                        {ROTULO_LANCAMENTO[d.tipo]}
                      </Badge>
                      {d.cancelado_em && (
                        <Badge variant="outline" className="ml-1">
                          Cancelado
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md text-sm">
                      {resumoDoLancamento(d)}
                      <span className="block text-xs text-muted-foreground">
                        {d.registrado_nome} · {dateTimeBR(d.created_at)}
                        {d.cancelado_em
                          ? ` · cancelado por ${d.cancelado_por_nome}: ${d.cancelado_motivo}`
                          : ""}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {d.itens.map((i, k) => (
                        <span key={k} className="block">
                          {i.produto} · lote {i.lote} · {i.quantidade}
                        </span>
                      ))}
                    </TableCell>
                    <TableCell className="text-right">
                      {!d.cancelado_em &&
                        (!fechado || d.data > fechado) &&
                        !dataTravada(d.data, travados) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Cancelar lançamento"
                            onClick={() => {
                              setCancelando(d.id);
                              setMotivo("");
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {lancando && (
        <LancarDialog
          tipo={lancando}
          medicamentos={ativos}
          saldo={saldo}
          aoFechar={() => setLancando(null)}
          aoLancar={() => {
            setLancando(null);
            recarregar();
          }}
        />
      )}

      {cancelando && (
        <Dialog open onOpenChange={(o) => !o && setCancelando(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar lançamento</DialogTitle>
            </DialogHeader>
            <Label htmlFor="sg-motivo">
              Motivo (o lançamento fica no livro, marcado como cancelado)
            </Label>
            <Textarea
              id="sg-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelando(null)}>
                Voltar
              </Button>
              <Button
                onClick={() => cancelar.mutate()}
                disabled={cancelar.isPending || !motivo.trim()}
              >
                Cancelar lançamento
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type LinhaItem = { medicamento_id: string; lote: string; quantidade: string; validade: string };
const linhaVazia = (): LinhaItem => ({
  medicamento_id: "",
  lote: "",
  quantidade: "1",
  validade: "",
});

function LancarDialog({
  tipo,
  medicamentos,
  saldo,
  aoFechar,
  aoLancar,
}: {
  tipo: TipoLancamento;
  medicamentos: MedicamentoControlado[];
  saldo: SaldoLote[];
  aoFechar: () => void;
  aoLancar: () => void;
}) {
  const [data, setData] = useState(hojeISO());
  const [itens, setItens] = useState<LinhaItem[]>([linhaVazia()]);
  const [obs, setObs] = useState("");
  // entrada
  const [nf, setNf] = useState({ numero: "", data: hojeISO(), cnpj: "" });
  // perda
  const [motivoPerda, setMotivoPerda] = useState("2");
  // dispensação
  const [rec, setRec] = useState({
    tipo: "2",
    numero: "",
    data: hojeISO(),
    prescritor: "",
    registro: "",
    uf: "PE",
    comprador: "",
    documento: "",
    orgao: "SSP",
    docUf: "PE",
  });
  const [pac, setPac] = useState({ nome: "", idade: "", unidadeIdade: "1", sexo: "1" });
  const [petId, setPetId] = useState("");

  const pets = useQuery({
    queryKey: ["sngpc-pets"],
    enabled: tipo === "venda",
    retry: false,
    queryFn: async () => {
      const [p, c] = await Promise.all([
        supabase
          .from("pets")
          .select("id, nome, sexo, nascimento, cliente_id")
          .eq("ativo", true)
          .order("nome")
          .limit(1500),
        supabase.from("clientes").select("id, nome").is("deleted_at", null).limit(2000),
      ]);
      if (p.error || c.error) return [];
      const nomes = new Map((c.data ?? []).map((x) => [x.id, x.nome]));
      return (p.data ?? []).map((x) => ({ ...x, tutor: nomes.get(x.cliente_id) ?? "" }));
    },
  });
  const vets = useQuery({
    queryKey: ["sngpc-vets"],
    enabled: tipo === "venda",
    retry: false,
    queryFn: async () => {
      const { data: d, error } = await supabase
        .from("pet_profissionais")
        .select("id, nome, crmv, crmv_uf")
        .eq("funcao", "veterinario")
        .eq("ativo", true)
        .order("nome");
      return error ? [] : (d ?? []);
    },
  });

  const escolherPet = (id: string) => {
    setPetId(id);
    const p = (pets.data ?? []).find((x) => x.id === id);
    if (!p) return;
    const idade = idadeParaSngpc(p.nascimento);
    setPac({
      nome: p.nome,
      idade: idade ? String(idade.idade) : "",
      unidadeIdade: String(idade?.unidade ?? 1),
      sexo: String(sexoParaSngpc(p.sexo) ?? 1),
    });
    if (!rec.comprador) setRec((r) => ({ ...r, comprador: p.tutor }));
  };

  const registrar = useMutation({
    mutationFn: async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Informe a data.");
      for (const i of itens) {
        const e = erroDoItem(i);
        if (e) throw new Error(e);
      }
      // aviso antes de o banco recusar: saída maior que o saldo atual do lote
      if (tipo === "venda" || tipo === "perda") {
        const pedido = somaPorLote(
          itens.map((i) => ({
            medicamento_id: i.medicamento_id,
            lote: i.lote,
            quantidade: Number(i.quantidade),
          })),
        );
        for (const [k, q] of pedido) {
          const [med, lote] = k.split("|") as [string, string];
          const atual = saldo.find((s) => s.medicamento_id === med && s.lote === lote)?.saldo ?? 0;
          if (q > atual)
            throw new Error(`O lote ${lote} tem saldo de ${atual}; não dá para tirar ${q}.`);
        }
      }
      const base: Record<string, unknown> = {
        data,
        observacao: obs,
        itens: itens.map((i) => ({
          medicamento_id: i.medicamento_id,
          lote: i.lote,
          quantidade: Number(i.quantidade),
          ...(i.validade ? { validade: i.validade } : {}),
        })),
      };
      if (tipo === "entrada") {
        if (!cnpjAlfaValido(nf.cnpj) || soNumeros(nf.cnpj).length !== 14)
          throw new Error("CNPJ do fornecedor inválido (14 números).");
        if (!/^\d+$/.test(nf.numero)) throw new Error("Informe o número da nota fiscal.");
        Object.assign(base, {
          nf_numero: Number(nf.numero),
          nf_data: nf.data,
          cnpj_origem: soNumeros(nf.cnpj),
        });
      }
      if (tipo === "perda") Object.assign(base, { motivo_perda: Number(motivoPerda) });
      if (tipo === "venda") {
        if (!/^\d{1,12}$/.test(rec.numero.trim()))
          throw new Error("O número da receita ou notificação tem só números (até 12).");
        if (!rec.prescritor.trim() || !rec.registro.trim())
          throw new Error("Informe o nome e o CRMV do prescritor.");
        if (!rec.comprador.trim() || !rec.documento.trim() || !rec.orgao.trim())
          throw new Error("Informe o nome do tutor e o documento dele (número e órgão expedidor).");
        Object.assign(base, {
          tipo_receituario: Number(rec.tipo),
          numero_notificacao: rec.numero.trim(),
          data_prescricao: rec.data,
          prescritor_nome: rec.prescritor,
          prescritor_registro: rec.registro,
          prescritor_uf: rec.uf,
          comprador_nome: rec.comprador,
          comprador_tipo_documento: TIPO_DOCUMENTO_COMPRADOR,
          comprador_documento: rec.documento,
          comprador_orgao: rec.orgao,
          comprador_uf: rec.docUf,
          ...(petId ? { pet_id: petId } : {}),
          ...(pac.nome.trim()
            ? {
                paciente_nome: pac.nome,
                paciente_idade: Number(pac.idade || 0),
                paciente_unidade_idade: Number(pac.unidadeIdade),
                paciente_sexo: Number(pac.sexo),
              }
            : {}),
        });
      }
      const { error } = await supabase.rpc("sngpc_registrar", {
        p_tipo: tipo,
        p_dados: base as never,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Lançamento registrado no livro.");
      aoLancar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const comValidade = tipo === "entrada" || tipo === "saldo_inicial";
  const lotesDe = (med: string) => saldo.filter((s) => s.medicamento_id === med);

  return (
    <Dialog open onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ROTULO_LANCAMENTO[tipo]}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="lc-data">
                {tipo === "entrada"
                  ? "Data do recebimento"
                  : tipo === "saldo_inicial"
                    ? "Data do saldo"
                    : "Data"}
              </Label>
              <Input
                id="lc-data"
                type="date"
                max={hojeISO()}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>
            {tipo === "perda" && (
              <div className="sm:col-span-2">
                <Label htmlFor="lc-motivo">Motivo da perda</Label>
                <Select value={motivoPerda} onValueChange={setMotivoPerda}>
                  <SelectTrigger id="lc-motivo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_PERDA.map((m) => (
                      <SelectItem key={m.value} value={String(m.value)}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {tipo === "entrada" && (
            <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="nf-num">Nota fiscal nº</Label>
                <Input
                  id="nf-num"
                  inputMode="numeric"
                  value={nf.numero}
                  onChange={(e) => setNf({ ...nf, numero: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="nf-data">Data da nota</Label>
                <Input
                  id="nf-data"
                  type="date"
                  max={data}
                  value={nf.data}
                  onChange={(e) => setNf({ ...nf, data: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="nf-cnpj">CNPJ do fornecedor</Label>
                <Input
                  id="nf-cnpj"
                  inputMode="numeric"
                  value={nf.cnpj}
                  onChange={(e) => setNf({ ...nf, cnpj: e.target.value })}
                />
              </div>
            </div>
          )}

          {tipo === "venda" && (
            <>
              <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Label htmlFor="rc-tipo">Receituário</Label>
                  <Select value={rec.tipo} onValueChange={(v) => setRec({ ...rec, tipo: v })}>
                    <SelectTrigger id="rc-tipo">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_RECEITUARIO.map((t) => (
                        <SelectItem key={t.value} value={String(t.value)}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="rc-num">Número da receita / notificação</Label>
                  <Input
                    id="rc-num"
                    inputMode="numeric"
                    value={rec.numero}
                    onChange={(e) => setRec({ ...rec, numero: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="rc-data">Data da prescrição</Label>
                  <Input
                    id="rc-data"
                    type="date"
                    max={data}
                    value={rec.data}
                    onChange={(e) => setRec({ ...rec, data: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="rc-vet">Veterinário da clínica</Label>
                  <Select
                    value={NENHUM}
                    onValueChange={(v) => {
                      const x = (vets.data ?? []).find((p) => p.id === v);
                      if (x)
                        setRec({
                          ...rec,
                          prescritor: x.nome,
                          registro: x.crmv ?? "",
                          uf: x.crmv_uf ?? rec.uf,
                        });
                    }}
                  >
                    <SelectTrigger id="rc-vet">
                      <SelectValue placeholder="Preencher com…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUM}>Preencher com…</SelectItem>
                      {(vets.data ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="sm:col-span-1">
                  <Label htmlFor="rc-pn">Prescritor (nome)</Label>
                  <Input
                    id="rc-pn"
                    maxLength={60}
                    value={rec.prescritor}
                    onChange={(e) => setRec({ ...rec, prescritor: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="rc-pr">CRMV (número)</Label>
                  <Input
                    id="rc-pr"
                    value={rec.registro}
                    onChange={(e) => setRec({ ...rec, registro: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="rc-puf">UF do CRMV</Label>
                  <UfSelect id="rc-puf" valor={rec.uf} aoMudar={(v) => setRec({ ...rec, uf: v })} />
                </div>
              </div>

              <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="pa-pet">Animal (opcional: preenche os dados)</Label>
                  <Select
                    value={petId || NENHUM}
                    onValueChange={(v) => v !== NENHUM && escolherPet(v)}
                  >
                    <SelectTrigger id="pa-pet">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUM}>Digitar os dados abaixo</SelectItem>
                      {(pets.data ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome} — {p.tutor}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="pa-nome">Nome do animal</Label>
                  <Input
                    id="pa-nome"
                    maxLength={60}
                    value={pac.nome}
                    onChange={(e) => setPac({ ...pac, nome: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label htmlFor="pa-idade">Idade</Label>
                    <Input
                      id="pa-idade"
                      inputMode="numeric"
                      value={pac.idade}
                      onChange={(e) => setPac({ ...pac, idade: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pa-un">Em</Label>
                    <Select
                      value={pac.unidadeIdade}
                      onValueChange={(v) => setPac({ ...pac, unidadeIdade: v })}
                    >
                      <SelectTrigger id="pa-un">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Anos</SelectItem>
                        <SelectItem value="2">Meses</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="pa-sexo">Sexo</Label>
                    <Select value={pac.sexo} onValueChange={(v) => setPac({ ...pac, sexo: v })}>
                      <SelectTrigger id="pa-sexo">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Macho</SelectItem>
                        <SelectItem value="2">Fêmea</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="cp-nome">Tutor(a) que retirou</Label>
                  <Input
                    id="cp-nome"
                    maxLength={60}
                    value={rec.comprador}
                    onChange={(e) => setRec({ ...rec, comprador: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="cp-doc">Documento (RG): número</Label>
                  <Input
                    id="cp-doc"
                    value={rec.documento}
                    onChange={(e) => setRec({ ...rec, documento: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="cp-org">Órgão expedidor</Label>
                    <Input
                      id="cp-org"
                      maxLength={20}
                      value={rec.orgao}
                      onChange={(e) => setRec({ ...rec, orgao: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cp-uf">UF</Label>
                    <UfSelect
                      id="cp-uf"
                      valor={rec.docUf}
                      aoMudar={(v) => setRec({ ...rec, docUf: v })}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="grid gap-2">
            <p className="text-sm font-medium">Itens</p>
            {itens.map((i, k) => (
              <div
                key={k}
                className={`grid gap-2 sm:items-end ${comValidade ? "sm:grid-cols-[1fr_8rem_5rem_9rem_auto]" : "sm:grid-cols-[1fr_8rem_5rem_auto]"}`}
              >
                <div>
                  <Label className="text-xs">Medicamento</Label>
                  <Select
                    value={i.medicamento_id || NENHUM}
                    onValueChange={(v) =>
                      setItens(
                        itens.map((x, j) =>
                          j === k ? { ...x, medicamento_id: v === NENHUM ? "" : v, lote: "" } : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger aria-label="Medicamento">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUM}>Escolha…</SelectItem>
                      {medicamentos.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.produto} ({m.lista})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Lote</Label>
                  <Input
                    aria-label="Lote"
                    list={`lotes-${k}`}
                    maxLength={20}
                    value={i.lote}
                    onChange={(e) =>
                      setItens(itens.map((x, j) => (j === k ? { ...x, lote: e.target.value } : x)))
                    }
                  />
                  {!comValidade && (
                    <datalist id={`lotes-${k}`}>
                      {lotesDe(i.medicamento_id).map((s) => (
                        <option key={s.lote} value={s.lote}>
                          saldo {s.saldo}
                        </option>
                      ))}
                    </datalist>
                  )}
                </div>
                <div>
                  <Label className="text-xs">Qtd.</Label>
                  <Input
                    aria-label="Quantidade"
                    inputMode="numeric"
                    value={i.quantidade}
                    onChange={(e) =>
                      setItens(
                        itens.map((x, j) => (j === k ? { ...x, quantidade: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                {comValidade && (
                  <div>
                    <Label className="text-xs">Validade</Label>
                    <Input
                      aria-label="Validade"
                      type="date"
                      value={i.validade}
                      onChange={(e) =>
                        setItens(
                          itens.map((x, j) => (j === k ? { ...x, validade: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remover item"
                  disabled={itens.length === 1}
                  onClick={() => setItens(itens.filter((_, j) => j !== k))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setItens([...itens, linhaVazia()])}
                disabled={itens.length >= 30}
              >
                <Plus className="size-4" /> Outro item
              </Button>
            </div>
          </div>
          <div>
            <Label htmlFor="lc-obs">Observação</Label>
            <Input
              id="lc-obs"
              maxLength={300}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button onClick={() => registrar.mutate()} disabled={registrar.isPending}>
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UfSelect({
  id,
  valor,
  aoMudar,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <Select value={valor} onValueChange={aoMudar}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UFS_CRMV.map((u) => (
          <SelectItem key={u} value={u}>
            {u}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------- envios

function baixarZip(nome: string, xml: string) {
  const zip = criarZip([{ nome: `${nome}.xml`, dados: paraLatin1(xml) }]);
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nome}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

type Montado = {
  tipo: "movimentacao" | "inventario";
  inicio: string;
  fim: string;
  xml: string;
  assinatura: string;
  linhas: string[];
  farmaceutico: string;
};

function Envios() {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<"movimentacao" | "inventario">("movimentacao");
  const [resp, setResp] = useState("");
  const [inicio, setInicio] = useState(somaDias(hojeISO(), -6));
  const [fim, setFim] = useState(hojeISO());
  const [dataInv, setDataInv] = useState(hojeISO());
  const [montado, setMontado] = useState<Montado | null>(null);
  const [transmitindo, setTransmitindo] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");

  const responsaveis = useQuery({
    queryKey: ["sngpc-responsaveis"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sngpc_responsaveis");
      if (error) throw error;
      return (data ?? []) as unknown as ResponsavelSngpc[];
    },
  });
  const envios = useQuery({
    queryKey: ["sngpc-envios"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sngpc_envios");
      if (error) throw error;
      return (data ?? []) as unknown as EnvioSngpc[];
    },
  });
  const responsavel = useMemo(
    () => (responsaveis.data ?? []).find((r) => r.id === resp),
    [responsaveis.data, resp],
  );

  const montar = useMutation({
    mutationFn: async (): Promise<Montado> => {
      if (!responsavel) throw new Error("Escolha o farmacêutico responsável pelo envio.");
      if (tipo === "movimentacao") {
        const { data, error } = await supabase.rpc("sngpc_periodo", {
          p_inicio: inicio,
          p_fim: fim,
        });
        if (error) throw error;
        const p = data as unknown as PeriodoSngpc;
        const r = resumoDoPeriodo(p);
        if (p.documentos.length === 0)
          throw new Error("Não há movimento neste período para enviar.");
        return {
          tipo,
          inicio: p.inicio,
          fim: p.fim,
          xml: gerarXmlMovimentacao(p, responsavel.cpf),
          assinatura: p.assinatura,
          farmaceutico: responsavel.nome,
          linhas: [
            `${r.entradas} entrada(s)`,
            `${r.dispensacoes} dispensação(ões)`,
            `${r.perdas} perda(s)`,
            `${r.itens} linha(s) de medicamento`,
          ],
        };
      }
      const { data, error } = await supabase.rpc("sngpc_inventario", { p_data: dataInv });
      if (error) throw error;
      const inv = data as unknown as InventarioSngpc;
      if (inv.itens.length === 0) throw new Error("Não há saldo nesta data.");
      return {
        tipo,
        inicio: inv.data,
        fim: inv.data,
        xml: gerarXmlInventario(inv, responsavel.cpf),
        assinatura: inv.assinatura,
        farmaceutico: responsavel.nome,
        linhas: [`Inventário em ${dateBR(inv.data)}`, `${inv.itens.length} lote(s) com saldo`],
      };
    },
    onSuccess: setMontado,
    onError: (e: Error) => toast.error(e.message),
  });

  const guardar = useMutation({
    mutationFn: async () => {
      if (!montado || !responsavel) return;
      const { error } = await supabase.rpc("sngpc_envio_registrar", {
        p_dados: {
          tipo: montado.tipo,
          inicio: montado.inicio,
          fim: montado.fim,
          farmaceutico_id: responsavel.id,
          xml: montado.xml,
          assinatura: montado.assinatura,
        },
      });
      if (error) throw error;
      baixarZip(nomeDoArquivo(montado.tipo, montado.inicio, montado.fim), montado.xml);
    },
    onSuccess: () => {
      toast.success("Arquivo guardado e baixado. Agora valide e envie ao SNGPC.");
      setMontado(null);
      void qc.invalidateQueries({ queryKey: ["sngpc-envios"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const baixar = useMutation({
    mutationFn: async (e: EnvioSngpc) => {
      const { data, error } = await supabase.rpc("sngpc_envio_xml", { p_id: e.id });
      if (error) throw error;
      baixarZip(nomeDoArquivo(e.tipo, e.inicio, e.fim), data as string);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const transmitir = useMutation({
    mutationFn: async () => {
      if (!transmitindo) return;
      const { error } = await supabase.rpc("sngpc_envio_transmitir", {
        p_id: transmitindo,
        p_protocolo: texto,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Envio marcado como transmitido. O período ficou fechado.");
      setTransmitindo(null);
      setTexto("");
      void qc.invalidateQueries({ queryKey: ["sngpc-envios"] });
      void qc.invalidateQueries({ queryKey: ["sngpc-livro"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("sngpc_envio_cancelar", {
        p_id: cancelando,
        p_motivo: texto,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Arquivo cancelado. O período está livre de novo.");
      setCancelando(null);
      setTexto("");
      void qc.invalidateQueries({ queryKey: ["sngpc-envios"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = envios.data ?? [];
  return (
    <div className="mt-4 grid gap-4">
      <div className="panel grid gap-3 p-4">
        <h3 className="font-display text-base font-semibold">Gerar arquivo</h3>
        <div className="grid gap-3 sm:grid-cols-4">
          <div>
            <Label htmlFor="en-tipo">Arquivo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => {
                setTipo(v as typeof tipo);
                setMontado(null);
              }}
            >
              <SelectTrigger id="en-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="movimentacao">Movimentação</SelectItem>
                <SelectItem value="inventario">Inventário</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {tipo === "movimentacao" ? (
            <>
              <div>
                <Label htmlFor="en-ini">De</Label>
                <Input
                  id="en-ini"
                  type="date"
                  value={inicio}
                  max={fim}
                  onChange={(e) => {
                    setInicio(e.target.value);
                    setMontado(null);
                  }}
                />
              </div>
              <div>
                <Label htmlFor="en-fim">Até</Label>
                <Input
                  id="en-fim"
                  type="date"
                  value={fim}
                  max={hojeISO()}
                  onChange={(e) => {
                    setFim(e.target.value);
                    setMontado(null);
                  }}
                />
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="en-inv">Data do inventário (até 7 dias atrás)</Label>
              <Input
                id="en-inv"
                type="date"
                value={dataInv}
                min={somaDias(hojeISO(), -7)}
                max={hojeISO()}
                onChange={(e) => {
                  setDataInv(e.target.value);
                  setMontado(null);
                }}
              />
            </div>
          )}
          <div>
            <Label htmlFor="en-resp">Farmacêutico responsável</Label>
            <Select
              value={resp || NENHUM}
              onValueChange={(v) => {
                setResp(v === NENHUM ? "" : v);
                setMontado(null);
              }}
            >
              <SelectTrigger id="en-resp">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUM}>
                  {(responsaveis.data ?? []).length ? "Escolha…" : "Nenhum cadastrado"}
                </SelectItem>
                {(responsaveis.data ?? []).map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nome} (CRF {r.crf}/{r.crf_uf})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {!responsaveis.isLoading && (responsaveis.data ?? []).length === 0 && (
          <p className="text-sm text-amber-800">
            Cadastre o farmacêutico em Profissionais (função “Farmacêutico”, com CRF e CPF): o CPF
            vai no cabeçalho do arquivo.
          </p>
        )}
        <div>
          <Button onClick={() => montar.mutate()} disabled={montar.isPending || !resp}>
            Montar arquivo
          </Button>
        </div>

        {montado && (
          <div className="grid gap-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Conferência antes de guardar</p>
            <ul className="list-disc pl-5 text-sm">
              {montado.linhas.map((l) => (
                <li key={l}>{l}</li>
              ))}
              <li>
                {montado.tipo === "movimentacao"
                  ? `Período ${dateBR(montado.inicio)} a ${dateBR(montado.fim)}`
                  : `Data ${dateBR(montado.inicio)}`}{" "}
                · responsável {montado.farmaceutico}
              </li>
            </ul>
            <pre
              className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs"
              aria-label="Prévia do XML"
            >
              {montado.xml}
            </pre>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              Guardar baixa o .zip e reserva o período. Antes do primeiro envio real, valide o
              arquivo no validador da Anvisa (o XSD oficial não foi usado aqui; veja docs/sngpc.md).
            </p>
            <div className="flex gap-2">
              <Button onClick={() => guardar.mutate()} disabled={guardar.isPending}>
                <Download className="size-4" /> Guardar e baixar .zip
              </Button>
              <Button variant="outline" onClick={() => setMontado(null)}>
                Descartar
              </Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1 font-display text-base font-semibold">Arquivos gerados</h3>
        {envios.isLoading ? (
          <div className="panel h-24 animate-pulse" />
        ) : lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum arquivo gerado ainda.</p>
        ) : (
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Gerado por</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((e) => (
                  <TableRow key={e.id} className={e.situacao === "cancelado" ? "opacity-60" : ""}>
                    <TableCell>
                      {e.tipo === "movimentacao" ? "Movimentação" : "Inventário"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {e.tipo === "movimentacao"
                        ? `${dateBR(e.inicio)} a ${dateBR(e.fim)}`
                        : dateBR(e.fim)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.situacao === "transmitido" ? "default" : "outline"}>
                        {e.situacao === "gerado"
                          ? "Gerado"
                          : e.situacao === "transmitido"
                            ? "Transmitido"
                            : "Cancelado"}
                      </Badge>
                      {e.protocolo && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          protocolo {e.protocolo}
                        </span>
                      )}
                      {e.cancelado_motivo && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {e.cancelado_motivo}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.gerado_por} · {dateTimeBR(e.created_at)}
                      <span className="block">Responsável: {e.farmaceutico}</span>
                      <span className="block" title={e.sha256}>
                        SHA-256 {e.sha256.slice(0, 12)}…
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => baixar.mutate(e)}
                          disabled={baixar.isPending}
                        >
                          <Download className="size-4" /> .zip
                        </Button>
                        {e.situacao === "gerado" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setTransmitindo(e.id);
                                setTexto("");
                              }}
                            >
                              Marcar como transmitido
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setCancelando(e.id);
                                setTexto("");
                              }}
                            >
                              Cancelar
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {transmitindo && (
        <Dialog open onOpenChange={(o) => !o && setTransmitindo(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Marcar como transmitido</DialogTitle>
            </DialogHeader>
            <Label htmlFor="en-prot">Protocolo ou código que o SNGPC devolveu</Label>
            <Input
              id="en-prot"
              maxLength={80}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Depois disso o período fica fechado: nada dele pode ser lançado nem cancelado no
              livro.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransmitindo(null)}>
                Voltar
              </Button>
              <Button
                onClick={() => transmitir.mutate()}
                disabled={transmitir.isPending || !texto.trim()}
              >
                Confirmar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {cancelando && (
        <Dialog open onOpenChange={(o) => !o && setCancelando(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cancelar arquivo gerado</DialogTitle>
            </DialogHeader>
            <Label htmlFor="en-canc">Motivo</Label>
            <Textarea
              id="en-canc"
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelando(null)}>
                Voltar
              </Button>
              <Button
                onClick={() => cancelar.mutate()}
                disabled={cancelar.isPending || !texto.trim()}
              >
                Cancelar arquivo
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
