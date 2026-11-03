import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCardapio } from "@/hooks/useCardapio";
import { brl } from "@/lib/format";
import type { CardapioCadastro } from "@/lib/cardapios";
import { CHAVE_REST, tabela } from "@/lib/restaurante-dados";

const num = (v: string) => Number(v.replace(",", "."));
const texto = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
const hhmm = (h: string | null) => (h ? h.slice(0, 5) : "");

/** Cadastro dos cardápios (almoço, jantar, iFood...) e dos itens, preços e ordem de cada um. */
export function CardapiosAdmin({ tenantId }: { tenantId: string }) {
  const { data } = useCardapio(true);
  const [editando, setEditando] = useState<CardapioCadastro | "novo" | null>(null);
  const [itens, setItens] = useState<CardapioCadastro | null>(null);
  const qc = useQueryClient();
  const atualizar = () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] });

  const alternar = useMutation({
    mutationFn: async (p: { id: string; ativo: boolean }) => {
      const r = await tabela("cardapios")
        .update({ ativo: p.ativo } as never)
        .eq("id", p.id);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const menus = data?.cardapios ?? [];
  const qtd = (id: string) => (data?.vinculos ?? []).filter((v) => v.cardapio_id === id).length;

  return (
    <div className="mt-4 max-w-3xl space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada cardápio tem os seus itens, preços e ordem. O preço base do item vale onde o cardápio
        não define um. No salão e no delivery escolhe-se o cardápio na comanda; o horário apenas
        sugere qual abrir.
      </p>
      <Button onClick={() => setEditando("novo")}>
        <Plus className="mr-1 size-4" /> Novo cardápio
      </Button>
      {menus.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum cardápio ainda. Ao criar o primeiro, marque-o como padrão: os itens novos entram
          nele sozinhos.
        </p>
      )}
      {menus.map((m) => (
        <div key={m.id} className="space-y-2 rounded border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className={`font-medium ${m.ativo ? "" : "text-muted-foreground line-through"}`}>
                {m.nome} {m.padrao && <Badge variant="secondary">padrão</Badge>}
              </p>
              <div className="mt-1 flex flex-wrap gap-1 text-xs">
                {m.uso_salao && <Badge variant="outline">Salão</Badge>}
                {m.uso_delivery && <Badge variant="outline">Delivery</Badge>}
                {m.uso_online && <Badge variant="outline">Online</Badge>}
                {m.uso_ifood && <Badge variant="outline">iFood</Badge>}
                {m.hora_inicio && (
                  <Badge variant="outline">
                    {hhmm(m.hora_inicio)}–{hhmm(m.hora_fim)}
                  </Badge>
                )}
                <span className="text-muted-foreground">{qtd(m.id)} itens</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setItens(m)}>
                Itens e preços
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Editar ${m.nome}`}
                onClick={() => setEditando(m)}
              >
                <Pencil className="size-4" />
              </Button>
              <Switch
                aria-label={`Cardápio ${m.nome} ativo`}
                checked={m.ativo}
                onCheckedChange={(v) => alternar.mutate({ id: m.id, ativo: v })}
              />
            </div>
          </div>
        </div>
      ))}

      {editando && (
        <FormCardapio
          tenantId={tenantId}
          cardapio={editando === "novo" ? null : editando}
          temPadrao={menus.some((m) => m.padrao)}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            atualizar();
          }}
        />
      )}
      {itens && (
        <ItensDoCardapio
          tenantId={tenantId}
          cardapio={itens}
          onFechar={() => setItens(null)}
          onSalvo={() => {
            setItens(null);
            atualizar();
          }}
        />
      )}
    </div>
  );
}

function FormCardapio({
  tenantId,
  cardapio,
  temPadrao,
  onFechar,
  onSalvo,
}: {
  tenantId: string;
  cardapio: CardapioCadastro | null;
  temPadrao: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [nome, setNome] = useState(cardapio?.nome ?? "");
  const [ordem, setOrdem] = useState(String(cardapio?.ordem ?? 0));
  const [padrao, setPadrao] = useState(cardapio?.padrao ?? !temPadrao);
  const [salao, setSalao] = useState(cardapio?.uso_salao ?? true);
  const [delivery, setDelivery] = useState(cardapio?.uso_delivery ?? true);
  const [online, setOnline] = useState(cardapio?.uso_online ?? true);
  const [ifood, setIfood] = useState(cardapio?.uso_ifood ?? false);
  const [ini, setIni] = useState(hhmm(cardapio?.hora_inicio ?? null));
  const [fim, setFim] = useState(hhmm(cardapio?.hora_fim ?? null));

  const salvar = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw new Error("Informe o nome do cardápio");
      if (Boolean(ini) !== Boolean(fim))
        throw new Error("Informe o início e o fim do horário, ou nenhum");
      const dados = {
        nome: nome.trim(),
        ordem: Math.round(num(ordem)) || 0,
        padrao,
        uso_salao: salao,
        uso_delivery: delivery,
        uso_online: online,
        uso_ifood: ifood,
        hora_inicio: ini || null,
        hora_fim: fim || null,
      };
      // só um cardápio é o padrão: o anterior deixa de ser antes de este passar a ser
      if (padrao && !cardapio?.padrao) {
        const r = await tabela("cardapios")
          .update({ padrao: false } as never)
          .eq("padrao", true);
        if (r.error) throw new Error(r.error.message);
      }
      const r = cardapio
        ? await tabela("cardapios")
            .update(dados as never)
            .eq("id", cardapio.id)
        : await tabela("cardapios").insert({ ...dados, tenant_id: tenantId } as never);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success("Cardápio salvo");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uso = (rotulo: string, v: boolean, set: (b: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <Switch checked={v} onCheckedChange={set} aria-label={rotulo} /> {rotulo}
    </label>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cardapio ? "Editar cardápio" : "Novo cardápio"}</DialogTitle>
          <DialogDescription>Onde ele aparece e em que horário é sugerido.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div>
              <Label htmlFor="cd-nome">Nome</Label>
              <Input
                id="cd-nome"
                maxLength={40}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cd-ordem">Ordem</Label>
              <Input
                id="cd-ordem"
                inputMode="numeric"
                value={ordem}
                onChange={(e) => setOrdem(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {uso("Salão e balcão", salao, setSalao)}
            {uso("Delivery", delivery, setDelivery)}
            {uso("Cardápio online", online, setOnline)}
            {uso("iFood", ifood, setIfood)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="cd-ini">Sugerir a partir de</Label>
              <Input id="cd-ini" type="time" value={ini} onChange={(e) => setIni(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cd-fim">até</Label>
              <Input id="cd-fim" type="time" value={fim} onChange={(e) => setFim(e.target.value)} />
            </div>
          </div>
          {uso("Cardápio padrão (itens novos entram nele)", padrao, setPadrao)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar cardápio
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Linha = { no: boolean; preco: string; ordem: string };

function ItensDoCardapio({
  tenantId,
  cardapio,
  onFechar,
  onSalvo,
}: {
  tenantId: string;
  cardapio: CardapioCadastro;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { data } = useCardapio(true);
  const itens = data?.itens ?? [];
  const existentes = (data?.vinculos ?? []).filter((v) => v.cardapio_id === cardapio.id);
  const [linhas, setLinhas] = useState<Record<string, Linha>>(() =>
    Object.fromEntries(
      existentes.map((v) => [
        v.item_id,
        { no: true, preco: texto(v.preco), ordem: texto(v.ordem) },
      ]),
    ),
  );
  const [busca, setBusca] = useState("");
  const linha = (id: string): Linha => linhas[id] ?? { no: false, preco: "", ordem: "" };
  const mudar = (id: string, p: Partial<Linha>) =>
    setLinhas({ ...linhas, [id]: { ...linha(id), ...p } });

  const salvar = useMutation({
    mutationFn: async () => {
      const marcados = itens.filter((i) => linha(i.id).no);
      const sai = existentes.filter((v) => !linha(v.item_id).no).map((v) => v.item_id);
      if (sai.length > 0) {
        const r = await tabela("cardapio_cardapio_itens")
          .delete()
          .eq("cardapio_id", cardapio.id)
          .in("item_id", sai);
        if (r.error) throw new Error(r.error.message);
      }
      if (marcados.length > 0) {
        const r = await tabela("cardapio_cardapio_itens").upsert(
          marcados.map((i) => ({
            tenant_id: tenantId,
            cardapio_id: cardapio.id,
            item_id: i.id,
            preco: linha(i.id).preco.trim() ? num(linha(i.id).preco) : null,
            ordem: linha(i.id).ordem.trim() ? Math.round(num(linha(i.id).ordem)) : null,
          })) as never,
          { onConflict: "cardapio_id,item_id" },
        );
        if (r.error) throw new Error(r.error.message);
      }
    },
    onSuccess: () => {
      toast.success("Itens do cardápio salvos");
      onSalvo();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const t = busca.trim().toLowerCase();
  const visiveis = itens.filter((i) => !t || i.nome.toLowerCase().includes(t));

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Itens de {cardapio.nome}</DialogTitle>
          <DialogDescription>
            Marque os itens que vendem neste cardápio. Deixe o preço em branco para usar o preço
            base; a ordem em branco usa a ordem do item.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Buscar item"
          placeholder="Buscar item"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <div className="space-y-1">
          <div className="grid grid-cols-[1.5rem_1fr_7rem_4rem] items-center gap-2 px-1 text-xs text-muted-foreground">
            <span />
            <span>Item (preço base)</span>
            <span>Preço aqui</span>
            <span>Ordem</span>
          </div>
          {visiveis.map((i) => {
            const l = linha(i.id);
            return (
              <div
                key={i.id}
                className="grid grid-cols-[1.5rem_1fr_7rem_4rem] items-center gap-2 rounded border p-1.5"
              >
                <Checkbox
                  checked={l.no}
                  onCheckedChange={(v) => mudar(i.id, { no: v === true })}
                  aria-label={`${i.nome} neste cardápio`}
                />
                <span className="truncate text-sm">
                  {i.nome} <span className="text-xs text-muted-foreground">({brl(i.preco)})</span>
                </span>
                <Input
                  className="h-8"
                  inputMode="decimal"
                  disabled={!l.no}
                  aria-label={`Preço de ${i.nome} neste cardápio`}
                  value={l.preco}
                  onChange={(e) => mudar(i.id, { preco: e.target.value })}
                />
                <Input
                  className="h-8"
                  inputMode="numeric"
                  disabled={!l.no}
                  aria-label={`Ordem de ${i.nome} neste cardápio`}
                  value={l.ordem}
                  onChange={(e) => mudar(i.id, { ordem: e.target.value })}
                />
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Voltar
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
            Salvar itens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
