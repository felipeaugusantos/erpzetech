import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateBR } from "@/lib/format";

export function DataAtendimento({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(`${value}T12:00:00`) : undefined;
  return <div>
    <Label htmlFor="data-atendimento">Data do atendimento</Label>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id="data-atendimento" variant="outline" disabled={disabled} className="w-full justify-start font-normal">
          <CalendarIcon className="size-4" />{value ? dateBR(value) : "Selecionar data"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0 pointer-events-auto">
        <Calendar mode="single" locale={ptBR} selected={date} {...(date ? { defaultMonth: date } : {})}
          captionLayout="dropdown" startMonth={new Date(1900, 0)} endMonth={new Date()}
          disabled={{ after: new Date() }} className="pointer-events-auto"
          onSelect={(next) => {
            if (!next) return;
            onChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`);
            setOpen(false);
          }} />
      </PopoverContent>
    </Popover>
  </div>;
}