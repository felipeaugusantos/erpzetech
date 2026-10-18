import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { brl, num } from "@/lib/format";
import { SACOLINHA_PADRAO, custoPar, custoSacolinha, margemPar } from "@/lib/personalizacao";
import { StatCard } from "@/components/app/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const n = (v: string) => {
  const x = Number(v.replace(",", "."));
  return Number.isFinite(x) ? x : 0;
};

/**
 * Custo interno do chinelo + sacolinha voil. Só aparece na tela (print:hidden):
 * nenhum custo vai para a via impressa do cliente.
 */
export function RentabilidadeChinelo({
  pares: paresIniciais,
  precoPar: precoInicial,
}: { pares?: number | undefined; precoPar?: number | undefined }) {
  const { data: produtos = [] } = useQuery({
    queryKey: ["produtos-custo-par"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos")
        .select("id, descricao, codigo_interno, custo, preco_venda")
        .eq("ativo", true)
        .order("descricao");
      if (error) throw error;
      return data;
    },
  });

  const [tiraId, setTiraId] = useState("");
  const [soladoId, setSoladoId] = useState("");
  const [folhaId, setFolhaId] = useState("");
  const [folhasChinelo, setFolhasChinelo] = useState("2");
  const [outros, setOutros] = useState("0");
  const [comSacolinha, setComSacolinha] = useState(true);
  const [voil, setVoil] = useState(String(SACOLINHA_PADRAO.precoMetroVoil));
  const [rendeMetro, setRendeMetro] = useState(String(SACOLINHA_PADRAO.sacolinhasPorMetro));
  const [costura, setCostura] = useState(String(SACOLINHA_PADRAO.costura));
  const [rolo, setRolo] = useState(String(SACOLINHA_PADRAO.precoRoloFita));
  const [rendeRolo, setRendeRolo] = useState(String(SACOLINHA_PADRAO.sacolinhasPorRolo));
  const [folhasSacolinha, setFolhasSacolinha] = useState(String(SACOLINHA_PADRAO.folhasPorSacolinha));
  const [preco, setPreco] = useState(precoInicial ? precoInicial.toFixed(2) : "");
  const [pares, setPares] = useState(String(paresIniciais ?? 1));

  useEffect(() => {
    if (precoInicial) setPreco(precoInicial.toFixed(2));
  }, [precoInicial]);
  useEffect(() => {
    if (paresIniciais) setPares(String(paresIniciais));
  }, [paresIniciais]);

  const custoDe = (id: string) => Number(produtos.find((p) => p.id === id)?.custo ?? 0);
  const folha = custoDe(folhaId);
  const chinelo = custoPar({
    tira: custoDe(tiraId), tirasPorPar: 1,
    solado: custoDe(soladoId), soladosPorPar: 1,
    folha: folha * n(folhasChinelo), paresPorFolha: 1,
    outros: n(outros),
  });
  const sacolinha = custoSacolinha({
    precoMetroVoil: n(voil), sacolinhasPorMetro: n(rendeMetro), costura: n(costura),
    precoRoloFita: n(rolo), sacolinhasPorRolo: n(rendeRolo),
    folha, folhasPorSacolinha: n(folhasSacolinha),
  });
  const custoSac = comSacolinha ? sacolinha.total : 0;
  const total = chinelo.total + custoSac;
  const precoN = n(preco);
  const qtd = Math.max(0, Math.floor(n(pares)));
  const margem = margemPar(precoN, total);

  const escolha = (rotulo: string, valor: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <Label>{rotulo}</Label>
      <Select value={valor} onValueChange={set}>
        <SelectTrigger><SelectValue placeholder="Escolha o produto" /></SelectTrigger>
        <SelectContent>
          {produtos.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.codigo_interno} — {p.descricao} ({brl(Number(p.custo ?? 0))})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const campo = (rotulo: string, valor: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <Label>{rotulo}</Label>
      <Input inputMode="decimal" value={valor} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <div className="space-y-4 print:hidden">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="size-4" /> Uso interno — estes custos não aparecem na impressão do cliente.
      </p>

      <div className="rounded-lg border bg-card p-4">
        <p className="mb-3 font-semibold">Chinelo</p>
        <div className="grid gap-4 md:grid-cols-2">
          {escolha("Solado", soladoId, setSoladoId)}
          {escolha("Tira", tiraId, setTiraId)}
          {escolha("Folha transfer", folhaId, setFolhaId)}
          {campo("Folhas por par de chinelo", folhasChinelo, setFolhasChinelo)}
          {campo("Outros gastos por par (R$)", outros, setOutros)}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="font-semibold">Sacolinha voil</p>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={comSacolinha} onCheckedChange={setComSacolinha} /> Incluir sacolinha
          </label>
        </div>
        {comSacolinha && (
          <div className="grid gap-4 md:grid-cols-3">
            {campo("Metro do voil (R$) — use o valor com desconto PIX/dinheiro", voil, setVoil)}
            {campo("Sacolinhas por metro", rendeMetro, setRendeMetro)}
            {campo("Costureira por sacolinha (R$)", costura, setCostura)}
            {campo("Rolo de fita de cetim (R$)", rolo, setRolo)}
            {campo("Sacolinhas por rolo", rendeRolo, setRendeRolo)}
            {campo("Folhas transfer por sacolinha", folhasSacolinha, setFolhasSacolinha)}
          </div>
        )}
        {comSacolinha && (
          <p className="mt-3 text-sm text-muted-foreground">
            Tecido {brl(sacolinha.tecido)} · Costura {brl(sacolinha.costura)} · Fita {brl(sacolinha.fita)} · Folhas {brl(sacolinha.folhas)}
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {campo("Preço de venda do par (R$)", preco, setPreco)}
        {campo("Quantidade de pares", pares, setPares)}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Custo do chinelo" value={brl(chinelo.total)} />
        <StatCard label="Custo da sacolinha" value={brl(custoSac)} />
        <StatCard label="Custo do conjunto" value={brl(total)} />
        <StatCard
          label="Lucro por par"
          value={precoN > 0 ? `${brl(precoN - total)} (${num(margem)}%)` : "Informe o preço"}
        />
      </div>
      <StatCard
        label={`Pedido de ${num(qtd)} pares`}
        value={`Custo ${brl(total * qtd)}${precoN > 0 ? ` · Lucro ${brl((precoN - total) * qtd)}` : ""}`}
      />
    </div>
  );
}
