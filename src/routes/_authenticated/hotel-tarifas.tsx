import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { AcaoDialog, CampoRotulo } from "@/components/hotelaria/AcaoDialog";
import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { ModuloHotelaria } from "@/components/hotelaria/ModuloHotelaria";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useSessionData } from "@/hooks/useSessionData";
import { brl, dateBR } from "@/lib/format";
import { isoBrasilia } from "@/lib/fuso";
import { DIAS_SEMANA, somarDias } from "@/lib/hotelaria";
import { hsDb, hsRpc, linhas } from "@/lib/hotelaria-api";
import type { CotacaoResposta, Hotel, HsTarifaLinha, HsTipoUh } from "@/lib/hotelaria-tipos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/hotel-tarifas")({
  head: () => ({
    meta: [
      { title: "Tarifas do hotel — EZRA ERP" },
      {
        name: "description",
        content:
          "Tarifas por tipo de acomodação, vigência, dia da semana e prioridade, com simulador de preço.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{(hotel) => <Tarifas hotel={hotel} />}</ModuloHotelaria>,
});

type Form = {
  id?: string;
  nome: string;
  de: string;
  ate: string;
  dias: number[];
  diaria: string;
  adulto: string;
  crianca: string;
  minimo: string;
  incluidas: string;
  prioridade: string;
  ativo: boolean;
};

const resumoDias = (dias: number[]) =>
  dias.length === 0
    ? "Todos os dias"
    : DIAS_SEMANA.filter((d) => dias.includes(d.value))
        .map((d) => d.label)
        .join(", ");

function Tarifas({ hotel }: { hotel: Hotel }) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");
  const [tipoId, setTipoId] = useState("");
  const [form, setForm] = useState<Form | null>(null);

  const tipos = useQuery({
    queryKey: ["hotel-tipos", hotel.id],
    queryFn: async () =>
      linhas<HsTipoUh>(
        await hsDb.from("hs_tipos_uh").select("*").eq("filial_id", hotel.id).order("nome"),
      ),
  });
  useEffect(() => {
    if (!tipoId && tipos.data?.[0]) setTipoId(tipos.data[0].id);
  }, [tipos.data, tipoId]);

  const tarifas = useQuery({
    queryKey: ["hotel-tarifas", tipoId],
    enabled: Boolean(tipoId),
    queryFn: async () =>
      linhas<HsTarifaLinha>(
        await hsDb.from("hs_tarifas").select("*").eq("tipo_id", tipoId).order("vigencia_de"),
      ),
  });

  const salvar = useMutation({
    mutationFn: () =>
      hsRpc("hs_tarifa_salvar", {
        p_dados: {
          ...(form!.id ? { id: form!.id } : {}),
          tipo_id: tipoId,
          nome: form!.nome,
          vigencia_de: form!.de,
          vigencia_ate: form!.ate,
          dias_semana: form!.dias,
          valor_diaria: Number(form!.diaria.replace(",", ".")),
          valor_adulto_extra: Number(form!.adulto.replace(",", ".") || 0),
          valor_crianca: Number(form!.crianca.replace(",", ".") || 0),
          minimo_noites: Number(form!.minimo || 1),
          pessoas_incluidas: Number(form!.incluidas || 2),
          prioridade: Number(form!.prioridade || 0),
          ativo: form!.ativo,
        },
      }),
    onSuccess: () => {
      toast.success("Tarifa salva.");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["hotel-tarifas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remover = useMutation({
    mutationFn: (id: string) => hsRpc("hs_tarifa_remover", { p_id: id }),
    onSuccess: () => {
      toast.success("Tarifa removida. As reservas já feitas não mudam.");
      void qc.invalidateQueries({ queryKey: ["hotel-tarifas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const novo = () => {
    const hoje = isoBrasilia();
    setForm({
      nome: "",
      de: hoje,
      ate: somarDias(hoje, 364),
      dias: [],
      diaria: "",
      adulto: "0",
      crianca: "0",
      minimo: "1",
      incluidas: "2",
      prioridade: "0",
      ativo: true,
    });
  };
  const editar = (t: HsTarifaLinha) =>
    setForm({
      id: t.id,
      nome: t.nome,
      de: t.vigencia_de,
      ate: t.vigencia_ate,
      dias: t.dias_semana,
      diaria: String(t.valor_diaria),
      adulto: String(t.valor_adulto_extra),
      crianca: String(t.valor_crianca),
      minimo: String(t.minimo_noites),
      incluidas: String(t.pessoas_incluidas),
      prioridade: String(t.prioridade),
      ativo: t.ativo,
    });

  return (
    <div>
      <PageHeader
        title="Tarifas"
        description={`${hotel.nome} · entre as tarifas que cobrem a noite vence a de maior prioridade; no empate, a de vigência mais curta. Sem tarifa não há venda.`}
      />
      {tipos.isLoading ? (
        <div className="panel h-40 animate-pulse" />
      ) : (tipos.data ?? []).length === 0 ? (
        <EmptyState
          title="Cadastre um tipo de acomodação primeiro"
          description="As tarifas são por tipo. Vá em Acomodações."
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={tipoId} onValueChange={setTipoId}>
              <SelectTrigger aria-label="Tipo de acomodação" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(tipos.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {gestao && (
              <Button onClick={novo}>
                <Plus className="size-4" /> Nova tarifa
              </Button>
            )}
          </div>

          {tarifas.isLoading ? (
            <div className="panel h-32 animate-pulse" />
          ) : (tarifas.data ?? []).length === 0 ? (
            <EmptyState
              title="Nenhuma tarifa para este tipo"
              description="Crie a tarifa base do ano e, depois, as de fim de semana, alta temporada e feriados."
            />
          ) : (
            <div className="panel overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Vigência</TableHead>
                    <TableHead>Dias</TableHead>
                    <TableHead className="text-right">Diária</TableHead>
                    <TableHead>Extras</TableHead>
                    <TableHead>Mín.</TableHead>
                    <TableHead>Prior.</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tarifas.data ?? []).map((t) => (
                    <TableRow key={t.id} className={cn(!t.ativo && "text-muted-foreground")}>
                      <TableCell className="font-medium">
                        {t.nome} {!t.ativo && <Badge variant="secondary">inativa</Badge>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {dateBR(t.vigencia_de)} a {dateBR(t.vigencia_ate)}
                      </TableCell>
                      <TableCell>{resumoDias(t.dias_semana)}</TableCell>
                      <TableCell className="text-right">{brl(t.valor_diaria)}</TableCell>
                      <TableCell className="text-xs">
                        inclui {t.pessoas_incluidas} · adulto {brl(t.valor_adulto_extra)} · criança{" "}
                        {brl(t.valor_crianca)}
                      </TableCell>
                      <TableCell>{t.minimo_noites}</TableCell>
                      <TableCell>{t.prioridade}</TableCell>
                      <TableCell className="space-x-1 text-right">
                        {gestao && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => editar(t)}>
                              Editar
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => remover.mutate(t.id)}>
                              Remover
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {tipoId && <Simulador hotel={hotel} tipoId={tipoId} />}
        </>
      )}

      <AcaoDialog
        titulo={form?.id ? "Editar tarifa" : "Nova tarifa"}
        aberto={form !== null}
        onFechar={() => setForm(null)}
        rotulo="Salvar"
        pendente={salvar.isPending}
        aoConfirmar={() => salvar.mutate()}
      >
        {form && (
          <>
            <CampoRotulo id="f-nome" rotulo="Nome">
              <Input
                id="f-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </CampoRotulo>
            <div className="grid grid-cols-2 gap-2">
              <CampoRotulo id="f-de" rotulo="Vigência de">
                <Input
                  id="f-de"
                  type="date"
                  value={form.de}
                  onChange={(e) => setForm({ ...form, de: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="f-ate" rotulo="Vigência até">
                <Input
                  id="f-ate"
                  type="date"
                  value={form.ate}
                  onChange={(e) => setForm({ ...form, ate: e.target.value })}
                />
              </CampoRotulo>
            </div>
            <div>
              <p className="mb-1 text-xs">Dias da semana (nenhum marcado = todos)</p>
              <div className="flex flex-wrap gap-1">
                {DIAS_SEMANA.map((d) => (
                  <Button
                    key={d.value}
                    type="button"
                    size="sm"
                    variant={form.dias.includes(d.value) ? "default" : "outline"}
                    onClick={() =>
                      setForm({
                        ...form,
                        dias: form.dias.includes(d.value)
                          ? form.dias.filter((x) => x !== d.value)
                          : [...form.dias, d.value],
                      })
                    }
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CampoRotulo id="f-diaria" rotulo="Diária (R$)">
                <Input
                  id="f-diaria"
                  inputMode="decimal"
                  value={form.diaria}
                  onChange={(e) => setForm({ ...form, diaria: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="f-incl" rotulo="Pessoas incluídas na diária">
                <Input
                  id="f-incl"
                  inputMode="numeric"
                  value={form.incluidas}
                  onChange={(e) => setForm({ ...form, incluidas: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="f-adulto" rotulo="Adulto extra por noite (R$)">
                <Input
                  id="f-adulto"
                  inputMode="decimal"
                  value={form.adulto}
                  onChange={(e) => setForm({ ...form, adulto: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="f-crianca" rotulo="Criança por noite (R$)">
                <Input
                  id="f-crianca"
                  inputMode="decimal"
                  value={form.crianca}
                  onChange={(e) => setForm({ ...form, crianca: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="f-min" rotulo="Mínimo de noites">
                <Input
                  id="f-min"
                  inputMode="numeric"
                  value={form.minimo}
                  onChange={(e) => setForm({ ...form, minimo: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="f-prior" rotulo="Prioridade">
                <Input
                  id="f-prior"
                  inputMode="numeric"
                  value={form.prioridade}
                  onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
                />
              </CampoRotulo>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm({ ...form, ativo: v })}
              />{" "}
              Ativa
            </label>
          </>
        )}
      </AcaoDialog>
    </div>
  );
}

function Simulador({ hotel, tipoId }: { hotel: Hotel; tipoId: string }) {
  const hoje = isoBrasilia();
  const [entrada, setEntrada] = useState(hoje);
  const [saida, setSaida] = useState(somarDias(hoje, 3));
  const [adultos, setAdultos] = useState("2");
  const [criancas, setCriancas] = useState("0");
  const ok = saida > entrada;
  const cot = useQuery({
    queryKey: ["hotel-simulador", hotel.id, tipoId, entrada, saida, adultos, criancas],
    enabled: ok,
    retry: false,
    queryFn: () =>
      hsRpc<CotacaoResposta>("hs_cotar", {
        p_filial: hotel.id,
        p_tipo: tipoId,
        p_entrada: entrada,
        p_saida: saida,
        p_adultos: Number(adultos) || 1,
        p_criancas: Number(criancas) || 0,
      }),
  });
  return (
    <section className="panel mt-6 p-4">
      <h2 className="mb-3 font-display text-base font-semibold">Simulador de preço</h2>
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Input
          aria-label="Entrada"
          type="date"
          value={entrada}
          onChange={(e) => setEntrada(e.target.value)}
        />
        <Input
          aria-label="Saída"
          type="date"
          value={saida}
          onChange={(e) => setSaida(e.target.value)}
        />
        <Input
          aria-label="Adultos"
          inputMode="numeric"
          value={adultos}
          onChange={(e) => setAdultos(e.target.value)}
        />
        <Input
          aria-label="Crianças"
          inputMode="numeric"
          value={criancas}
          onChange={(e) => setCriancas(e.target.value)}
        />
      </div>
      {!ok ? (
        <p className="text-sm text-muted-foreground">A saída precisa ser depois da entrada.</p>
      ) : cot.isLoading ? (
        <div className="h-16 animate-pulse rounded bg-secondary" />
      ) : cot.error ? (
        <p className="text-sm text-destructive">{(cot.error as Error).message}</p>
      ) : cot.data ? (
        <div className="text-sm">
          <p className="mb-2 font-medium">
            Total {brl(cot.data.total)} · {cot.data.quantidade} noite(s)
          </p>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {cot.data.noites.map((n) => (
              <li key={n.data} className="flex justify-between border-b border-border py-1">
                <span>{dateBR(n.data)}</span>
                <span>{brl(n.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
