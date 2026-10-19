import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, Syringe } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useModulosCnae } from "@/lib/cnae";
import { dateBR } from "@/lib/format";
import { hojeISO } from "@/lib/financeiro";
import {
  ATALHOS_PROXIMA_DOSE,
  dataDoAtalho,
  rotuloDose,
  resumoDoProtocolo,
  type CartaoVacinacao,
  type ItemCatalogo,
} from "@/lib/vacinas";

export const Route = createFileRoute("/_authenticated/clinica-vacinas")({
  validateSearch: (search: Record<string, unknown>) => ({
    agendamento:
      typeof search["agendamento"] === "string" ? (search["agendamento"] as string) : undefined,
    pet: typeof search["pet"] === "string" ? (search["pet"] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Vacinas e vermífugos — ERP Ze Tech" },
      {
        name: "description",
        content: "Registro de vacina e vermífugo aplicados, com lote e próxima dose.",
      },
    ],
  }),
  component: VacinasModulo,
});

/** Botões "21 dias", "30 dias" e "1 ano": preenchem a data a partir do dia da aplicação (sem `base`, do dia de hoje no momento do clique). */
function AtalhosProximaDose({
  base,
  valor,
  onEscolher,
  desativado,
}: {
  base?: string;
  valor: string;
  onEscolher: (data: string) => void;
  desativado?: boolean;
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ATALHOS_PROXIMA_DOSE.map((a) => {
        const data = dataDoAtalho(base ?? hojeISO(), a);
        return (
          <Button
            key={a.rotulo}
            type="button"
            size="sm"
            variant={valor === data ? "default" : "outline"}
            disabled={desativado}
            onClick={() => onEscolher(base ? data : dataDoAtalho(hojeISO(), a))}
            title={`Próxima dose em ${dateBR(data)}`}
          >
            {a.rotulo}
          </Button>
        );
      })}
    </div>
  );
}

type Lote = {
  id: string;
  lote: string;
  validade: string | null;
  quantidade: number;
  deposito: string;
};
type Aplicador = { id: string; nome: string; funcao: string };
type Retorno = {
  avisos?: string[];
  proxima_dose_em: string | null;
  dose_tipo: string;
  dose_numero: number;
};

function VacinasModulo() {
  const modulos = useModulosCnae();
  if (modulos.carregando) return <div className="panel h-40 animate-pulse" />;
  if (!modulos.clinica) return <ModuloBloqueado modulo="clinica" />;
  return <Vacinas />;
}

function Vacinas() {
  const { agendamento, pet } = Route.useSearch();
  const qc = useQueryClient();
  const hoje = hojeISO();
  const [catalogoId, setCatalogoId] = useState("");
  const [loteId, setLoteId] = useState("");
  const [aplicador, setAplicador] = useState("");
  const [local, setLocal] = useState("");
  const [obs, setObs] = useState("");
  const [proxima, setProxima] = useState("");
  const [semProxima, setSemProxima] = useState(false);
  const [externa, setExterna] = useState(false);
  const [ext, setExt] = useState({
    catalogo: "",
    data: hoje,
    informado: "",
    lote: "",
    proxima: "",
  });
  const [cancelando, setCancelando] = useState<{ id: string; motivo: string } | null>(null);

  const petId = pet;
  const catalogo = useQuery({
    queryKey: ["clinica-catalogo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_vacinas_catalogo");
      if (error) throw error;
      return ((data ?? []) as unknown as ItemCatalogo[]).filter((i) => i.ativo);
    },
  });
  const cartao = useQuery({
    queryKey: ["clinica-cartao", petId],
    enabled: Boolean(petId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_cartao_vacinacao", {
        p_pet_id: petId as string,
      });
      if (error) throw error;
      return data as unknown as CartaoVacinacao;
    },
  });
  const lotes = useQuery({
    queryKey: ["clinica-lotes", catalogoId],
    enabled: Boolean(catalogoId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_lotes_vacina", {
        p_catalogo_id: catalogoId,
      });
      if (error) throw error;
      return (data ?? []) as unknown as Lote[];
    },
  });
  const aplicadores = useQuery({
    queryKey: ["clinica-aplicadores"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("clinica_aplicadores");
      if (error) throw error;
      return (data ?? []) as unknown as Aplicador[];
    },
  });

  const item = catalogo.data?.find((i) => i.id === catalogoId);

  const aplicar = useMutation({
    mutationFn: async () => {
      if (!agendamento) throw new Error("Abra pelo atendimento de vacina da Minha agenda.");
      const { data, error } = await supabase.rpc("clinica_vacina_aplicar", {
        p_agendamento_id: agendamento,
        p_dados: {
          catalogo_id: catalogoId,
          estoque_lote_id: loteId,
          ...(aplicador ? { aplicador_id: aplicador } : {}),
          local_aplicacao: local,
          observacoes: obs,
          ...(semProxima ? { proxima_dose_em: "" } : proxima ? { proxima_dose_em: proxima } : {}),
        },
      });
      if (error) throw error;
      return data as unknown as Retorno;
    },
    onSuccess: (r) => {
      toast.success(`${rotuloDose(r.dose_tipo, r.dose_numero)} registrada`, {
        description: r.proxima_dose_em
          ? `Próxima dose em ${dateBR(r.proxima_dose_em)}.`
          : "Sem próxima dose.",
      });
      for (const a of r.avisos ?? []) toast.warning(a);
      setLoteId("");
      setLocal("");
      setObs("");
      setProxima("");
      setSemProxima(false);
      void qc.invalidateQueries({ queryKey: ["clinica-cartao"] });
      void qc.invalidateQueries({ queryKey: ["clinica-lotes"] });
      void qc.invalidateQueries({ queryKey: ["pet-minha-agenda"] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const registrarExterna = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("clinica_vacina_registrar_externa", {
        p_pet_id: petId as string,
        p_dados: {
          catalogo_id: ext.catalogo,
          aplicada_em: ext.data,
          informado_por: ext.informado,
          lote: ext.lote,
          // em branco vale o protocolo do item
          ...(ext.proxima ? { proxima_dose_em: ext.proxima } : {}),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registrada como aplicada em outro local");
      setExterna(false);
      setExt({ catalogo: "", data: hoje, informado: "", lote: "", proxima: "" });
      void qc.invalidateQueries({ queryKey: ["clinica-cartao"] });
    },
    onError: (e: Error) => toast.error("Não foi possível registrar", { description: e.message }),
  });

  const cancelar = useMutation({
    mutationFn: async () => {
      if (!cancelando) return;
      const { error } = await supabase.rpc("clinica_vacina_cancelar", {
        p_id: cancelando.id,
        p_motivo: cancelando.motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aplicação cancelada", { description: "A dose voltou ao lote." });
      setCancelando(null);
      void qc.invalidateQueries({ queryKey: ["clinica-cartao"] });
      void qc.invalidateQueries({ queryKey: ["clinica-lotes"] });
    },
    onError: (e: Error) => toast.error("Não foi possível cancelar", { description: e.message }),
  });

  if (!petId)
    return (
      <EmptyState
        title="Nenhum paciente escolhido"
        description="Abra pelo atendimento de vacina da Minha agenda ou pela ficha do paciente."
        action={
          <Button asChild variant="outline">
            <Link to="/pet-minha-agenda">Ir para Minha agenda</Link>
          </Button>
        }
      />
    );

  const c = cartao.data;
  return (
    <div>
      <PageHeader
        title={`Vacinas e vermífugos${c ? ` de ${c.pet.nome}` : ""}`}
        description={c ? `Tutor(a) ${c.tutor}` : "Carregando…"}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/clinica-cartao" search={{ pet: petId }}>
                <Printer className="size-4" /> Cartão de vacinação
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setExterna(true)}>
              Aplicada em outro local
            </Button>
          </>
        }
      />

      {agendamento && (
        <div className="panel mb-4 grid gap-3 p-4">
          <h2 className="font-display text-base font-semibold">Registrar aplicação</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="a-item">Vacina ou vermífugo</Label>
              <Select
                value={catalogoId || "__nenhum"}
                onValueChange={(v) => {
                  setCatalogoId(v === "__nenhum" ? "" : v);
                  setLoteId("");
                }}
              >
                <SelectTrigger id="a-item">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Escolha o item</SelectItem>
                  {catalogo.data?.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {item && (
                <p className="mt-1 text-xs text-muted-foreground">{resumoDoProtocolo(item)}</p>
              )}
            </div>
            <div>
              <Label htmlFor="a-lote">Lote</Label>
              <Select
                value={loteId || "__nenhum"}
                onValueChange={(v) => setLoteId(v === "__nenhum" ? "" : v)}
                disabled={!catalogoId}
              >
                <SelectTrigger id="a-lote">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Escolha o lote</SelectItem>
                  {lotes.data?.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.lote} · vence {dateBR(l.validade)} · {l.quantidade} dose(s) · {l.deposito}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {catalogoId && lotes.data?.length === 0 && (
                <p className="mt-1 text-xs text-amber-800">
                  Nenhum lote com saldo e dentro da validade para este item.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="a-aplicador">Aplicado por</Label>
              <Select
                value={aplicador || "__eu"}
                onValueChange={(v) => setAplicador(v === "__eu" ? "" : v)}
              >
                <SelectTrigger id="a-aplicador">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__eu">Eu mesmo (veterinário)</SelectItem>
                  {aplicadores.data?.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nome} (sob minha responsabilidade)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="a-local">Local da aplicação</Label>
              <Input
                id="a-local"
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                placeholder="Ex.: subcutânea, dorso"
              />
            </div>
            <div>
              <Label htmlFor="a-prox">Próxima dose</Label>
              <Input
                id="a-prox"
                type="date"
                disabled={semProxima}
                value={proxima}
                onChange={(e) => setProxima(e.target.value)}
              />
              <AtalhosProximaDose
                valor={proxima}
                desativado={semProxima}
                onEscolher={(d) => {
                  setProxima(d);
                  setSemProxima(false);
                }}
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={semProxima}
                  onChange={(e) => setSemProxima(e.target.checked)}
                />
                Sem próxima dose
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Em branco, vale o protocolo do item.
              </p>
            </div>
            <div>
              <Label htmlFor="a-obs">Observações</Label>
              <Input id="a-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
            </div>
          </div>
          <div>
            <Button
              onClick={() => aplicar.mutate()}
              disabled={aplicar.isPending || !catalogoId || !loteId}
            >
              <Syringe className="size-4" /> Registrar aplicação
            </Button>
          </div>
        </div>
      )}

      <h2 className="mb-2 font-display text-base font-semibold">
        Histórico de vacinas e vermífugos
      </h2>
      {cartao.isLoading ? (
        <div className="panel h-24 animate-pulse" />
      ) : cartao.error ? (
        <EmptyState title="Não foi possível abrir" description={(cartao.error as Error).message} />
      ) : (c?.aplicacoes ?? []).length === 0 ? (
        <EmptyState
          title="Nada registrado"
          description="As aplicações aparecem aqui e no cartão de vacinação."
        />
      ) : (
        <div className="grid gap-2">
          {c?.aplicacoes.map((a) => (
            <div
              key={a.id}
              className="panel flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div>
                <strong>{a.nome}</strong> · {rotuloDose(a.dose_tipo, a.dose_numero)} ·{" "}
                {dateBR(a.aplicada_em)}
                <span className="block text-xs text-muted-foreground">
                  {a.origem === "outro_local"
                    ? `Aplicada em outro local — informado por ${a.informado_por}`
                    : `Lote ${a.lote}${a.validade_lote ? ` (vence ${dateBR(a.validade_lote)})` : ""} · ${a.aplicador ?? a.veterinario} · resp. ${a.veterinario} (CRMV ${a.crmv}/${a.crmv_uf})`}
                  {a.proxima_dose_em ? ` · próxima ${dateBR(a.proxima_dose_em)}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {a.origem === "outro_local" && <Badge variant="outline">Outro local</Badge>}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelando({ id: a.id, motivo: "" })}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={externa} onOpenChange={(o) => !o && setExterna(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicada em outro local</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="e-item">Vacina ou vermífugo</Label>
              <Select
                value={ext.catalogo || "__nenhum"}
                onValueChange={(v) => setExt({ ...ext, catalogo: v === "__nenhum" ? "" : v })}
              >
                <SelectTrigger id="e-item">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__nenhum">Escolha o item</SelectItem>
                  {catalogo.data?.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="e-data">Data</Label>
                <Input
                  id="e-data"
                  type="date"
                  max={hoje}
                  value={ext.data}
                  onChange={(e) => setExt({ ...ext, data: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="e-lote">Lote (se constar)</Label>
                <Input
                  id="e-lote"
                  value={ext.lote}
                  onChange={(e) => setExt({ ...ext, lote: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="e-info">Quem informou</Label>
              <Input
                id="e-info"
                value={ext.informado}
                onChange={(e) => setExt({ ...ext, informado: e.target.value })}
                placeholder="Ex.: carteira de vacinação, tutor, outra clínica"
              />
            </div>
            <div>
              <Label htmlFor="e-prox">Próxima dose</Label>
              <Input
                id="e-prox"
                type="date"
                value={ext.proxima}
                onChange={(e) => setExt({ ...ext, proxima: e.target.value })}
              />
              <AtalhosProximaDose
                base={ext.data || hoje}
                valor={ext.proxima}
                onEscolher={(d) => setExt({ ...ext, proxima: d })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Em branco, vale o protocolo do item.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Não baixa estoque; entra no cartão marcada “aplicada em outro local”.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExterna(false)}>
              Voltar
            </Button>
            <Button
              onClick={() => registrarExterna.mutate()}
              disabled={
                registrarExterna.isPending || !ext.catalogo || !ext.data || !ext.informado.trim()
              }
            >
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cancelando)} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar aplicação</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor="c-motivo">Motivo</Label>
            <Input
              id="c-motivo"
              value={cancelando?.motivo ?? ""}
              onChange={(e) =>
                cancelando && setCancelando({ ...cancelando, motivo: e.target.value })
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              O registro não some: fica cancelado com o motivo. Aplicação da clínica devolve a dose
              ao lote e ao estoque.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              Voltar
            </Button>
            <Button
              onClick={() => cancelar.mutate()}
              disabled={cancelar.isPending || !cancelando?.motivo.trim()}
            >
              Cancelar aplicação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
