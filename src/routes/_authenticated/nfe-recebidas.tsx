import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { EmptyState, PageHeader } from "@/components/app/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { brl, dateBR } from "@/lib/format";
import {
  buscarNotasRecebidas,
  historicoManifestacoes,
  listarNotasRecebidas,
  manifestarNota,
  painelNotasRecebidas,
  salvarConfigNotasRecebidas,
} from "@/lib/nfe-recebidas.functions";
import {
  EVENTOS_COM_JUSTIFICATIVA,
  EVENTOS_MANIFESTACAO,
  type TipoEvento,
} from "@/lib/nfe-recebidas";

export const Route = createFileRoute("/_authenticated/nfe-recebidas")({
  head: () => ({
    meta: [
      { title: "Notas recebidas — EZRA ERP" },
      {
        name: "description",
        content:
          "Busque as notas fiscais emitidas contra o CNPJ da empresa e registre a ciência, a confirmação ou a recusa.",
      },
    ],
  }),
  component: NotasRecebidas,
});

type Nota = {
  chave: string;
  emitente: string;
  emitenteCnpj: string;
  emissao: string | null;
  valor: number;
};

function NotasRecebidas() {
  const qc = useQueryClient();
  const [ambiente, setAmbiente] = useState<"producao" | "homologacao">("producao");
  const [cnpjEscolhido, setCnpjEscolhido] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const [alvo, setAlvo] = useState<{ nota: Nota; tipo: TipoEvento } | null>(null);
  const [justificativa, setJustificativa] = useState("");

  const painel = useQuery({
    queryKey: ["nfe-recebidas-painel", ambiente],
    queryFn: () => painelNotasRecebidas({ data: { ambiente } }),
  });
  const empresas = painel.data?.empresas ?? [];
  const atual = empresas.find((e) => e.cnpj === cnpjEscolhido) ?? empresas[0];
  const cnpj = atual?.cnpj ?? "";

  const notas = useQuery({
    queryKey: ["nfe-recebidas-notas", ambiente, cnpj, pagina],
    enabled: !!cnpj,
    queryFn: () => listarNotasRecebidas({ data: { cnpj, ambiente, pagina } }),
  });
  const historico = useQuery({
    queryKey: ["nfe-recebidas-historico"],
    queryFn: () => historicoManifestacoes(),
  });

  const buscar = useMutation({
    mutationFn: () => buscarNotasRecebidas({ data: { cnpj, ambiente } }),
    onSuccess: (r) => {
      if (r.status === "erro") toast.error(r.mensagem ?? "A Sefaz recusou a consulta.");
      else toast.success(r.mensagem ?? "Consulta concluída.");
      void qc.invalidateQueries({ queryKey: ["nfe-recebidas-notas"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const config = useMutation({
    mutationFn: (c: {
      distribuicao_automatica: boolean;
      distribuicao_intervalo_horas: number;
      ciencia_automatica: boolean;
    }) => salvarConfigNotasRecebidas({ data: { cnpj, ambiente, config: c } }),
    onSuccess: () => {
      toast.success("Configuração salva.");
      void qc.invalidateQueries({ queryKey: ["nfe-recebidas-painel"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const manifestar = useMutation({
    mutationFn: () => {
      if (!alvo) throw new Error("Nenhuma nota selecionada.");
      return manifestarNota({
        data: {
          cnpj,
          ambiente,
          chave: alvo.nota.chave,
          tipo: alvo.tipo,
          justificativa,
          emitente: alvo.nota.emitente,
          valor: alvo.nota.valor,
        },
      });
    },
    onSuccess: (r) => {
      if (r.status === "rejeitado" || r.status === "erro") {
        toast.error(r.mensagem ?? "A Sefaz rejeitou a manifestação.");
      } else {
        toast.success("Manifestação enviada.");
      }
      if (r.registroLocalFalhou) {
        toast.warning("A Sefaz recebeu o evento, mas o histórico local não foi gravado.");
      }
      setAlvo(null);
      setJustificativa("");
      void qc.invalidateQueries({ queryKey: ["nfe-recebidas-notas"] });
      void qc.invalidateQueries({ queryKey: ["nfe-recebidas-historico"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cfg = atual?.config;
  const exigeJustificativa = alvo ? EVENTOS_COM_JUSTIFICATIVA.includes(alvo.tipo) : false;
  const totalPaginas = notas.data ? Math.ceil(notas.data.total / notas.data.porPagina) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notas recebidas"
        description="Notas fiscais emitidas contra o CNPJ da empresa, para dar ciência, confirmar ou recusar."
        actions={
          <>
            <Select
              value={ambiente}
              onValueChange={(v) => {
                setAmbiente(v as "producao" | "homologacao");
                setPagina(0);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="producao">Produção</SelectItem>
                <SelectItem value="homologacao">Homologação</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => buscar.mutate()} disabled={!cnpj || buscar.isPending}>
              {buscar.isPending ? "Buscando…" : "Buscar notas agora"}
            </Button>
          </>
        }
      />

      {painel.isError && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar</AlertTitle>
          <AlertDescription>{(painel.error as Error).message}</AlertDescription>
        </Alert>
      )}

      {!painel.isLoading && empresas.length === 0 && (
        <EmptyState
          title="Nenhuma empresa com CNPJ"
          description="Cadastre o CNPJ de 14 caracteres da empresa para receber as notas emitidas contra ele."
        />
      )}

      {empresas.length > 1 && (
        <div className="max-w-sm space-y-1">
          <Label>Empresa</Label>
          <Select
            value={cnpj}
            onValueChange={(v) => {
              setCnpjEscolhido(v);
              setPagina(0);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {empresas.map((e) => (
                <SelectItem key={e.cnpj} value={e.cnpj}>
                  {e.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {atual && (
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">Busca automática</h2>
          {atual.erro && (
            <Alert>
              <AlertTitle>Configuração indisponível</AlertTitle>
              <AlertDescription>
                {atual.erro} O certificado digital A1 da empresa precisa estar cadastrado no emissor
                fiscal.
              </AlertDescription>
            </Alert>
          )}
          {cfg && (
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                Buscar notas automaticamente
                <Switch
                  checked={cfg.distribuicao_automatica}
                  disabled={config.isPending}
                  onCheckedChange={(v) => config.mutate({ ...cfg, distribuicao_automatica: v })}
                />
              </label>
              <div className="flex items-center justify-between gap-3 text-sm">
                A cada
                <Select
                  value={String(cfg.distribuicao_intervalo_horas)}
                  onValueChange={(v) =>
                    config.mutate({ ...cfg, distribuicao_intervalo_horas: Number(v) })
                  }
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 4, 6, 12, 24].map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h} {h === 1 ? "hora" : "horas"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                Dar ciência automaticamente
                <Switch
                  checked={cfg.ciencia_automatica}
                  disabled={config.isPending}
                  onCheckedChange={(v) => config.mutate({ ...cfg, ciencia_automatica: v })}
                />
              </label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            A ciência só informa à Sefaz que a nota existe e libera o XML. Confirmar e recusar nunca
            são automáticos: dependem de uma pessoa (administrador, gestor ou financeiro).
          </p>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Aguardando manifestação</h2>
        {notas.isError && (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível listar as notas</AlertTitle>
            <AlertDescription>{(notas.error as Error).message}</AlertDescription>
          </Alert>
        )}
        {notas.data && notas.data.notas.length === 0 && (
          <EmptyState
            title="Nenhuma nota pendente"
            description="Use Buscar notas agora para consultar a Sefaz."
          />
        )}
        {notas.data && notas.data.notas.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Emitente</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Chave</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notas.data.notas.map((n) => (
                <TableRow key={n.chave}>
                  <TableCell>
                    {n.emitente}
                    <div className="text-xs text-muted-foreground">{n.emitenteCnpj}</div>
                  </TableCell>
                  <TableCell>{n.emissao ? dateBR(n.emissao) : "—"}</TableCell>
                  <TableCell className="text-right">{brl(n.valor)}</TableCell>
                  <TableCell className="font-mono text-xs">{n.chave}</TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    {(Object.keys(EVENTOS_MANIFESTACAO) as TipoEvento[]).map((tipo) => (
                      <Button
                        key={tipo}
                        size="sm"
                        variant={tipo === "210200" ? "default" : "outline"}
                        onClick={() => {
                          setJustificativa("");
                          setAlvo({ nota: n, tipo });
                        }}
                      >
                        {tipo === "210200"
                          ? "Confirmar"
                          : tipo === "210210"
                            ? "Ciência"
                            : tipo === "210220"
                              ? "Desconhecer"
                              : "Não realizada"}
                      </Button>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <Button
              size="sm"
              variant="outline"
              disabled={pagina === 0}
              onClick={() => setPagina((p) => p - 1)}
            >
              Anterior
            </Button>
            <span>
              {pagina + 1} / {totalPaginas}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={pagina + 1 >= totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Histórico de manifestações</h2>
        {historico.data && historico.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma manifestação registrada ainda.</p>
        )}
        {historico.data && historico.data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Emitente</TableHead>
                <TableHead>Quem</TableHead>
                <TableHead>Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historico.data.map((h) => (
                <TableRow key={h.id}>
                  <TableCell>{dateBR(h.created_at)}</TableCell>
                  <TableCell>
                    {EVENTOS_MANIFESTACAO[h.tipo_evento as TipoEvento] ?? h.tipo_evento}
                    {h.justificativa && (
                      <div className="text-xs text-muted-foreground">{h.justificativa}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {h.emitente ?? "—"}
                    <div className="font-mono text-xs text-muted-foreground">{h.chave_acesso}</div>
                  </TableCell>
                  <TableCell>{h.autor ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={h.status === "registrado" ? "default" : "secondary"}>
                      {h.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <Dialog open={!!alvo} onOpenChange={(o) => !o && setAlvo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{alvo ? EVENTOS_MANIFESTACAO[alvo.tipo] : ""}</DialogTitle>
            <DialogDescription>
              {alvo?.nota.emitente} — {alvo ? brl(alvo.nota.valor) : ""}. Este registro vai para a
              Sefaz e
              {exigeJustificativa || alvo?.tipo === "210200"
                ? " não pode ser desfeito"
                : " fica no histórico"}
              .
            </DialogDescription>
          </DialogHeader>
          {exigeJustificativa && (
            <div className="space-y-1">
              <Label>Justificativa (15 a 255 caracteres)</Label>
              <Textarea
                value={justificativa}
                maxLength={255}
                onChange={(e) => setJustificativa(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAlvo(null)}>
              Cancelar
            </Button>
            <Button
              variant={exigeJustificativa ? "destructive" : "default"}
              disabled={
                manifestar.isPending || (exigeJustificativa && justificativa.trim().length < 15)
              }
              onClick={() => manifestar.mutate()}
            >
              {manifestar.isPending ? "Enviando…" : "Enviar à Sefaz"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
