import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Printer } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { MOTIVOS_PADRAO, urlChamarMesa, type MotivoChamado } from "@/lib/chamados";
import { CHAVE_REST, tabela, type Mesa } from "@/lib/restaurante-dados";

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/** Chamar o garçom: liga o recurso, cadastra os motivos e imprime o QR code de cada mesa. */
export function ChamadosAdmin({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const atualizar = () => void qc.invalidateQueries({ queryKey: [CHAVE_REST] });
  const [nome, setNome] = useState("");
  const [imprimindo, setImprimindo] = useState(false);

  const { data: ligado = false } = useQuery({
    queryKey: [CHAVE_REST, "config-chamar"],
    queryFn: async () => {
      const r = await tabela("restaurante_config").select("chamar_garcom").maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return (r.data as unknown as { chamar_garcom: boolean } | null)?.chamar_garcom ?? false;
    },
  });
  const { data: slug } = useQuery({
    queryKey: [CHAVE_REST, "slug-empresa"],
    queryFn: async () => {
      const r = await supabase.from("empresas").select("slug").limit(1).maybeSingle();
      if (r.error) throw new Error(r.error.message);
      return ((r.data as { slug?: string | null } | null)?.slug ?? null) as string | null;
    },
  });
  const { data: motivos = [] } = useQuery({
    queryKey: [CHAVE_REST, "motivos-chamado"],
    queryFn: async () => {
      const r = await tabela("restaurante_chamados_motivos")
        .select("*")
        .order("ordem")
        .order("nome");
      if (r.error) throw new Error(r.error.message);
      return (r.data ?? []) as unknown as MotivoChamado[];
    },
  });
  const { data: mesas = [] } = useQuery({
    queryKey: [CHAVE_REST, "mesas-cadastro"],
    queryFn: async () => {
      const r = await tabela("mesas").select("*");
      if (r.error) throw new Error(r.error.message);
      return ((r.data ?? []) as unknown as Mesa[]).sort((a, b) =>
        a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }),
      );
    },
  });

  const alternar = useMutation({
    mutationFn: async (v: boolean) => {
      const r = await tabela("restaurante_config").upsert(
        { tenant_id: tenantId, chamar_garcom: v, updated_at: new Date().toISOString() } as never,
        { onConflict: "tenant_id" },
      );
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: () => {
      toast.success("Configuração salva");
      atualizar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const salvarMotivo = useMutation({
    mutationFn: async (p: { id?: string; dados: Record<string, unknown> }) => {
      const r = p.id
        ? await tabela("restaurante_chamados_motivos")
            .update(p.dados as never)
            .eq("id", p.id)
        : await tabela("restaurante_chamados_motivos").insert(p.dados as never);
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  const criarPadrao = useMutation({
    mutationFn: async () => {
      const faltam = MOTIVOS_PADRAO.filter(
        (n) => !motivos.some((m) => m.nome.toLowerCase() === n.toLowerCase()),
      );
      if (faltam.length === 0) return;
      const r = await tabela("restaurante_chamados_motivos").insert(
        faltam.map((n, i) => ({
          tenant_id: tenantId,
          nome: n,
          ordem: motivos.length + i,
        })) as never,
      );
      if (r.error) throw new Error(r.error.message);
    },
    onSuccess: atualizar,
    onError: (e: Error) => toast.error(e.message),
  });

  async function imprimirQr() {
    if (!slug) return;
    const janela = window.open("", "_blank", "width=800,height=900");
    if (!janela) {
      toast.error("O navegador bloqueou a janela de impressão");
      return;
    }
    setImprimindo(true);
    try {
      const ativas = mesas.filter((m) => m.ativa);
      const cards: string[] = [];
      for (const m of ativas) {
        const png = await QRCode.toDataURL(urlChamarMesa(window.location.origin, slug, m.id), {
          margin: 1,
          width: 300,
        });
        cards.push(
          `<div class="c"><p class="m">Mesa ${esc(m.numero)}</p><img src="${png}" alt="QR da mesa ${esc(m.numero)}"/><p>Chame o garçom pelo celular</p></div>`,
        );
      }
      janela.document
        .write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>QR das mesas</title>
<style>
  @page { margin: 8mm; }
  body { font-family: Arial, sans-serif; margin: 0; }
  .g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
  .c { border: 1px dashed #888; padding: 4mm; text-align: center; break-inside: avoid; }
  .c img { width: 100%; max-width: 55mm; }
  .m { font-size: 20px; font-weight: bold; margin: 0 0 2mm; }
  p { margin: 1mm 0; font-size: 12px; }
</style></head><body><div class="g">${cards.join("")}</div></body></html>`);
      janela.document.close();
      janela.focus();
      setTimeout(() => janela.print(), 500);
    } catch {
      janela.close();
      toast.error("Não foi possível gerar os QR codes");
    } finally {
      setImprimindo(false);
    }
  }

  return (
    <div className="mt-4 max-w-2xl space-y-5">
      <p className="text-sm text-muted-foreground">
        O cliente lê o QR code da mesa, escolhe o motivo e o chamado aparece no PDV do restaurante
        até alguém marcar “Atendi”. Não é preciso instalar nada.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <Switch
          checked={ligado}
          disabled={alternar.isPending}
          onCheckedChange={(v) => alternar.mutate(v)}
          aria-label="Chamar garçom ligado"
        />
        Chamar garçom ligado
      </label>
      {!slug && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          A empresa ainda não tem link de acesso. Defina o link na tela Empresa para gerar os QR
          codes.
        </p>
      )}

      <section className="space-y-2">
        <h3 className="font-display font-semibold">Motivos do chamado</h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="mot-nome">Novo motivo</Label>
            <Input
              id="mot-nome"
              maxLength={40}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <Button
            disabled={!nome.trim() || salvarMotivo.isPending}
            onClick={() =>
              salvarMotivo.mutate(
                { dados: { tenant_id: tenantId, nome: nome.trim(), ordem: motivos.length } },
                { onSuccess: () => setNome("") },
              )
            }
          >
            <Plus className="mr-1 size-4" /> Adicionar
          </Button>
          <Button
            variant="outline"
            disabled={criarPadrao.isPending}
            onClick={() => criarPadrao.mutate()}
          >
            Criar os motivos padrão
          </Button>
        </div>
        {motivos.map((m) => (
          <div key={m.id} className="flex items-center justify-between rounded border p-2">
            <span className={m.ativo ? "" : "text-muted-foreground line-through"}>{m.nome}</span>
            <Switch
              aria-label={`Motivo ${m.nome} ativo`}
              checked={m.ativo}
              onCheckedChange={(v) => salvarMotivo.mutate({ id: m.id, dados: { ativo: v } })}
            />
          </div>
        ))}
        {motivos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Sem motivos cadastrados, o cliente vê só o botão “Chamar garçom”.
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="font-display font-semibold">QR code das mesas</h3>
        <p className="text-sm text-muted-foreground">
          Imprime uma folha com o QR de cada mesa ativa ({mesas.filter((m) => m.ativa).length}{" "}
          mesas). Recorte e cole em cada mesa. Mesa nova pede nova impressão.
        </p>
        <Button disabled={!slug || !ligado || imprimindo} onClick={() => void imprimirQr()}>
          <Printer className="mr-1 size-4" /> {imprimindo ? "Gerando..." : "Imprimir os QR codes"}
        </Button>
        {!ligado && <p className="text-xs text-muted-foreground">Ligue o recurso para imprimir.</p>}
      </section>
    </div>
  );
}
