import { createFileRoute } from "@tanstack/react-router";

import { ipDoCliente } from "@/lib/ip-cliente";
import { criarLimitador, ehRuido, LIMITE_CORPO, lerCorpoDoNavegador } from "@/lib/monitoramento";

// Recebe os erros do navegador: POST /api/public/erros. É público porque o erro pode acontecer antes do login. Por isso: corpo
// pequeno, limite por IP, texto limpo de dados pessoais no servidor (nunca confia no navegador) e o banco agrupa e limita o volume.
const podeEnviar = criarLimitador(20, 60_000);

function ipDe(request: Request): string {
  return ipDoCliente(request.headers) ?? "desconhecido";
}

export const Route = createFileRoute("/api/public/erros")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const resposta = (status: number) => new Response(null, { status });
        if (!podeEnviar(ipDe(request))) return resposta(429);
        const tamanho = Number(request.headers.get("content-length") ?? 0);
        if (tamanho > LIMITE_CORPO) return resposta(413);
        let texto: string;
        try {
          texto = await request.text();
        } catch {
          return resposta(400);
        }
        if (texto.length > LIMITE_CORPO) return resposta(413);
        let corpo: unknown;
        try {
          corpo = JSON.parse(texto);
        } catch {
          return resposta(400);
        }
        const relato = lerCorpoDoNavegador(corpo);
        if (!relato) return resposta(400);
        if (ehRuido(relato.mensagem, relato.stack)) return resposta(204);
        const { empresaDoToken, gravarRelato } = await import("@/lib/monitoramento.server");
        const token =
          /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
        await gravarRelato(relato, await empresaDoToken(token));
        return resposta(204);
      },
    },
  },
});
