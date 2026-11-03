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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useSessionData } from "@/hooks/useSessionData";
import { dateBR } from "@/lib/format";
import { SITUACOES_LIMPEZA, lerPeriodo } from "@/lib/hotelaria";
import { hsDb, hsRpc, linhas } from "@/lib/hotelaria-api";
import type { Hotel, HsBloqueio, HsTipoUh, HsUh } from "@/lib/hotelaria-tipos";
import { isoBrasilia } from "@/lib/fuso";

export const Route = createFileRoute("/_authenticated/hotel-acomodacoes")({
  head: () => ({
    meta: [
      { title: "Acomodações do hotel — EZRA ERP" },
      {
        name: "description",
        content: "Tipos de acomodação, quartos, limpeza e bloqueios por período.",
      },
    ],
  }),
  component: () => <ModuloHotelaria>{(hotel) => <Acomodacoes hotel={hotel} />}</ModuloHotelaria>,
});

type TipoForm = {
  id?: string;
  nome: string;
  descricao: string;
  adultos: string;
  criancas: string;
  comodidades: string;
  ativo: boolean;
};
type UhForm = {
  id?: string;
  numero: string;
  andar: string;
  tipo_id: string;
  interditada: boolean;
  motivo: string;
  ativo: boolean;
};

function Acomodacoes({ hotel }: { hotel: Hotel }) {
  const qc = useQueryClient();
  const { data: sessao } = useSessionData();
  const gestao = (sessao?.roles ?? []).some((r) => r === "administrador" || r === "gestor");

  const { data, isLoading, error } = useQuery({
    queryKey: ["hotel-acomodacoes", hotel.id],
    queryFn: async () => {
      const [tipos, uhs, bloqueios] = await Promise.all([
        hsDb.from("hs_tipos_uh").select("*").eq("filial_id", hotel.id).order("nome"),
        hsDb.from("hs_uhs").select("*").eq("filial_id", hotel.id).order("numero"),
        hsDb
          .from("hs_ocupacoes")
          .select("id, uh_id, periodo, motivo")
          .eq("filial_id", hotel.id)
          .eq("origem", "bloqueio")
          .order("periodo"),
      ]);
      return {
        tipos: linhas<HsTipoUh>(tipos),
        uhs: linhas<HsUh>(uhs),
        bloqueios: linhas<HsBloqueio>(bloqueios),
      };
    },
  });
  const tipos = data?.tipos ?? [];
  const uhs = data?.uhs ?? [];
  const hoje = isoBrasilia();
  const bloqueios = (data?.bloqueios ?? [])
    .map((b) => ({ b, p: lerPeriodo(b.periodo) }))
    .filter((x) => x.p && x.p.ate > hoje);

  const [tipo, setTipo] = useState<TipoForm | null>(null);
  const [uh, setUh] = useState<UhForm | null>(null);
  const [bloquear, setBloquear] = useState<HsUh | null>(null);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (bloquear) {
      setDe(hoje);
      setAte("");
      setMotivo("");
    }
  }, [bloquear]); // eslint-disable-line react-hooks/exhaustive-deps

  const atualizar = () => {
    for (const k of [
      "hotel-acomodacoes",
      "hotel-tipos",
      "hotel-mapa",
      "hotel-painel",
      "hotel-uhs-livres",
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };
  const falhou = (e: Error) => toast.error(e.message);

  const salvarTipo = useMutation({
    mutationFn: () =>
      hsRpc("hs_tipo_uh_salvar", {
        p_dados: {
          ...(tipo!.id ? { id: tipo!.id } : {}),
          filial_id: hotel.id,
          nome: tipo!.nome,
          descricao: tipo!.descricao,
          capacidade_adultos: Number(tipo!.adultos),
          capacidade_criancas: Number(tipo!.criancas),
          comodidades: tipo!.comodidades
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
          ativo: tipo!.ativo,
        },
      }),
    onSuccess: () => {
      toast.success("Tipo salvo.");
      setTipo(null);
      atualizar();
    },
    onError: falhou,
  });
  const salvarUh = useMutation({
    mutationFn: () =>
      hsRpc("hs_uh_salvar", {
        p_dados: {
          ...(uh!.id ? { id: uh!.id } : {}),
          tipo_id: uh!.tipo_id,
          numero: uh!.numero,
          andar: uh!.andar,
          interditada: uh!.interditada,
          motivo_interdicao: uh!.motivo,
          ativo: uh!.ativo,
        },
      }),
    onSuccess: () => {
      toast.success("Acomodação salva.");
      setUh(null);
      atualizar();
    },
    onError: falhou,
  });
  const limpeza = useMutation({
    mutationFn: (p: { uh: string; para: string }) =>
      hsRpc("hs_uh_situacao", { p_uh: p.uh, p_para: p.para }),
    onSuccess: atualizar,
    onError: falhou,
  });
  const bloquearUh = useMutation({
    mutationFn: () =>
      hsRpc("hs_uh_interditar", { p_uh: bloquear!.id, p_de: de, p_ate: ate, p_motivo: motivo }),
    onSuccess: () => {
      toast.success("Acomodação bloqueada no período.");
      setBloquear(null);
      atualizar();
    },
    onError: falhou,
  });
  const removerBloqueio = useMutation({
    mutationFn: (id: string) => hsRpc("hs_bloqueio_remover", { p_id: id }),
    onSuccess: () => {
      toast.success("Bloqueio removido.");
      atualizar();
    },
    onError: falhou,
  });

  const nomeTipo = (id: string) => tipos.find((t) => t.id === id)?.nome ?? "—";
  const numeroUh = (id: string) => uhs.find((u) => u.id === id)?.numero ?? "—";

  return (
    <div>
      <PageHeader
        title="Acomodações"
        description={`${hotel.nome} · tipos, quartos, limpeza e bloqueios. Só a gestão cadastra.`}
      />
      {isLoading ? (
        <div className="panel h-48 animate-pulse" />
      ) : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : (
        <Tabs defaultValue="uhs">
          <TabsList>
            <TabsTrigger value="uhs">Acomodações ({uhs.length})</TabsTrigger>
            <TabsTrigger value="tipos">Tipos ({tipos.length})</TabsTrigger>
            <TabsTrigger value="bloqueios">Bloqueios ({bloqueios.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="uhs" className="mt-4">
            {gestao && (
              <div className="mb-3">
                <Button
                  onClick={() =>
                    setUh({
                      numero: "",
                      andar: "",
                      tipo_id: tipos.find((t) => t.ativo)?.id ?? "",
                      interditada: false,
                      motivo: "",
                      ativo: true,
                    })
                  }
                  disabled={tipos.length === 0}
                >
                  <Plus className="size-4" /> Nova acomodação
                </Button>
                {tipos.length === 0 && (
                  <span className="ml-3 text-sm text-muted-foreground">
                    Cadastre um tipo antes.
                  </span>
                )}
              </div>
            )}
            {uhs.length === 0 ? (
              <EmptyState
                title="Nenhuma acomodação"
                description="Cadastre os quartos do hotel para reservar."
              />
            ) : (
              <div className="panel overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Número</TableHead>
                      <TableHead>Andar</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Limpeza</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uhs.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.numero}</TableCell>
                        <TableCell>{u.andar ?? "—"}</TableCell>
                        <TableCell>{nomeTipo(u.tipo_id)}</TableCell>
                        <TableCell>
                          <Select
                            value={u.situacao_limpeza}
                            onValueChange={(v) => limpeza.mutate({ uh: u.id, para: v })}
                          >
                            <SelectTrigger
                              aria-label={`Limpeza da ${u.numero}`}
                              className="h-8 w-36"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SITUACOES_LIMPEZA.map((s) => (
                                <SelectItem key={s.value} value={s.value}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {!u.ativo ? (
                            <Badge variant="secondary">Inativa</Badge>
                          ) : u.interditada ? (
                            <Badge variant="destructive">Interditada</Badge>
                          ) : (
                            <Badge variant="outline">Em venda</Badge>
                          )}
                        </TableCell>
                        <TableCell className="space-x-1 text-right">
                          {gestao && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setBloquear(u)}
                                disabled={!u.ativo}
                              >
                                Bloquear período
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setUh({
                                    id: u.id,
                                    numero: u.numero,
                                    andar: u.andar ?? "",
                                    tipo_id: u.tipo_id,
                                    interditada: u.interditada,
                                    motivo: u.motivo_interdicao ?? "",
                                    ativo: u.ativo,
                                  })
                                }
                              >
                                Editar
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
          </TabsContent>

          <TabsContent value="tipos" className="mt-4">
            {gestao && (
              <div className="mb-3">
                <Button
                  onClick={() =>
                    setTipo({
                      nome: "",
                      descricao: "",
                      adultos: "2",
                      criancas: "0",
                      comodidades: "",
                      ativo: true,
                    })
                  }
                >
                  <Plus className="size-4" /> Novo tipo
                </Button>
              </div>
            )}
            {tipos.length === 0 ? (
              <EmptyState
                title="Nenhum tipo cadastrado"
                description="Ex.: Standard casal, Luxo, Suíte família."
              />
            ) : (
              <div className="panel overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Capacidade</TableHead>
                      <TableHead>Comodidades</TableHead>
                      <TableHead>Acomodações</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tipos.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">
                          {t.nome}
                          {!t.ativo && (
                            <span className="ml-2 text-xs text-muted-foreground">(inativo)</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.capacidade_adultos} adulto(s) · {t.capacidade_criancas} criança(s)
                        </TableCell>
                        <TableCell>{t.comodidades.join(", ") || "—"}</TableCell>
                        <TableCell>
                          {uhs.filter((u) => u.tipo_id === t.id && u.ativo).length}
                        </TableCell>
                        <TableCell className="text-right">
                          {gestao && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setTipo({
                                  id: t.id,
                                  nome: t.nome,
                                  descricao: t.descricao ?? "",
                                  adultos: String(t.capacidade_adultos),
                                  criancas: String(t.capacidade_criancas),
                                  comodidades: t.comodidades.join(", "),
                                  ativo: t.ativo,
                                })
                              }
                            >
                              Editar
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="bloqueios" className="mt-4">
            {bloqueios.length === 0 ? (
              <EmptyState
                title="Nenhum bloqueio em vigor"
                description="Use Bloquear período para tirar uma acomodação de venda (manutenção, uso interno)."
              />
            ) : (
              <div className="panel overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Acomodação</TableHead>
                      <TableHead>De</TableHead>
                      <TableHead>Volta à venda em</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead className="text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bloqueios.map(({ b, p }) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">{numeroUh(b.uh_id)}</TableCell>
                        <TableCell>{dateBR(p!.de)}</TableCell>
                        <TableCell>{dateBR(p!.ate)}</TableCell>
                        <TableCell>{b.motivo}</TableCell>
                        <TableCell className="text-right">
                          {gestao && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => removerBloqueio.mutate(b.id)}
                            >
                              Remover
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      <AcaoDialog
        titulo={tipo?.id ? "Editar tipo" : "Novo tipo"}
        aberto={tipo !== null}
        onFechar={() => setTipo(null)}
        rotulo="Salvar"
        pendente={salvarTipo.isPending}
        aoConfirmar={() => salvarTipo.mutate()}
      >
        {tipo && (
          <>
            <CampoRotulo id="t-nome" rotulo="Nome">
              <Input
                id="t-nome"
                value={tipo.nome}
                onChange={(e) => setTipo({ ...tipo, nome: e.target.value })}
              />
            </CampoRotulo>
            <div className="grid grid-cols-2 gap-2">
              <CampoRotulo id="t-ad" rotulo="Adultos">
                <Input
                  id="t-ad"
                  inputMode="numeric"
                  value={tipo.adultos}
                  onChange={(e) => setTipo({ ...tipo, adultos: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="t-cr" rotulo="Crianças">
                <Input
                  id="t-cr"
                  inputMode="numeric"
                  value={tipo.criancas}
                  onChange={(e) => setTipo({ ...tipo, criancas: e.target.value })}
                />
              </CampoRotulo>
            </div>
            <CampoRotulo id="t-com" rotulo="Comodidades (separadas por vírgula)">
              <Input
                id="t-com"
                value={tipo.comodidades}
                onChange={(e) => setTipo({ ...tipo, comodidades: e.target.value })}
              />
            </CampoRotulo>
            <CampoRotulo id="t-desc" rotulo="Descrição">
              <Textarea
                id="t-desc"
                rows={2}
                value={tipo.descricao}
                onChange={(e) => setTipo({ ...tipo, descricao: e.target.value })}
              />
            </CampoRotulo>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={tipo.ativo}
                onCheckedChange={(v) => setTipo({ ...tipo, ativo: v })}
              />{" "}
              Ativo
            </label>
          </>
        )}
      </AcaoDialog>

      <AcaoDialog
        titulo={uh?.id ? "Editar acomodação" : "Nova acomodação"}
        descricao="Mudar o tipo, inativar ou interditar uma acomodação com reserva a partir de hoje não é permitido."
        aberto={uh !== null}
        onFechar={() => setUh(null)}
        rotulo="Salvar"
        pendente={salvarUh.isPending}
        aoConfirmar={() => salvarUh.mutate()}
      >
        {uh && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <CampoRotulo id="u-num" rotulo="Número ou nome">
                <Input
                  id="u-num"
                  value={uh.numero}
                  onChange={(e) => setUh({ ...uh, numero: e.target.value })}
                />
              </CampoRotulo>
              <CampoRotulo id="u-andar" rotulo="Andar">
                <Input
                  id="u-andar"
                  value={uh.andar}
                  onChange={(e) => setUh({ ...uh, andar: e.target.value })}
                />
              </CampoRotulo>
            </div>
            <CampoRotulo id="u-tipo" rotulo="Tipo">
              <Select value={uh.tipo_id} onValueChange={(v) => setUh({ ...uh, tipo_id: v })}>
                <SelectTrigger id="u-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tipos
                    .filter((t) => t.ativo || t.id === uh.tipo_id)
                    .map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </CampoRotulo>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={uh.ativo} onCheckedChange={(v) => setUh({ ...uh, ativo: v })} />{" "}
              Ativa
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={uh.interditada}
                onCheckedChange={(v) => setUh({ ...uh, interditada: v })}
              />{" "}
              Interditada (fora de venda sem data para voltar)
            </label>
            {uh.interditada && (
              <CampoRotulo id="u-motivo" rotulo="Motivo da interdição">
                <Input
                  id="u-motivo"
                  value={uh.motivo}
                  onChange={(e) => setUh({ ...uh, motivo: e.target.value })}
                />
              </CampoRotulo>
            )}
          </>
        )}
      </AcaoDialog>

      <AcaoDialog
        titulo={`Bloquear ${bloquear?.numero ?? ""}`}
        descricao="A acomodação sai de venda no período. A data de volta já fica livre."
        aberto={bloquear !== null}
        onFechar={() => setBloquear(null)}
        rotulo="Bloquear"
        pendente={bloquearUh.isPending}
        aoConfirmar={() => bloquearUh.mutate()}
      >
        <div className="grid grid-cols-2 gap-2">
          <CampoRotulo id="b-de" rotulo="A partir de">
            <Input id="b-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </CampoRotulo>
          <CampoRotulo id="b-ate" rotulo="Volta à venda em">
            <Input id="b-ate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </CampoRotulo>
        </div>
        <CampoRotulo id="b-motivo" rotulo="Motivo">
          <Input id="b-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </CampoRotulo>
      </AcaoDialog>
    </div>
  );
}
