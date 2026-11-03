import { Badge } from "@/components/ui/badge";
import { rotuloSituacaoQuarto, rotuloSituacaoReserva, tomDaSituacao } from "@/lib/hotelaria";

/** Selo da situação da reserva (ou do quarto, quando `quarto` é verdadeiro). */
export function SituacaoBadge({
  situacao,
  quarto = false,
}: {
  situacao: string | null | undefined;
  quarto?: boolean;
}) {
  return (
    <Badge variant={tomDaSituacao(situacao)}>
      {quarto ? rotuloSituacaoQuarto(situacao) : rotuloSituacaoReserva(situacao)}
    </Badge>
  );
}
