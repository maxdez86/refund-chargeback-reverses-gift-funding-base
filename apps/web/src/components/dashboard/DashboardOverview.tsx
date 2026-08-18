import {
  CalendarCheck2,
  CircleDashed,
  MailOpen,
  MessageCircleMore,
  SearchCheck
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const modules = [
  {
    id: "confirmacoes",
    title: "Confirmações",
    description: "Visão consolidada das respostas dos convidados.",
    icon: CalendarCheck2
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    description: "Acompanhamento dos convites e respostas pelo WhatsApp.",
    icon: MessageCircleMore
  },
  {
    id: "convites",
    title: "Convites",
    description: "Consulta de convites, convidados e situação de cada grupo.",
    icon: SearchCheck
  },
  {
    id: "recados",
    title: "Recados",
    description: "Organização das mensagens enviadas aos noivos.",
    icon: MailOpen
  }
] as const;

export function DashboardOverview({ preview }: { preview: boolean }) {
  return (
    <div className="space-y-12 pb-16">
      <section id="visao-geral" className="dashboard-section scroll-mt-24" aria-labelledby="visao-geral-titulo">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-[#9f7a34]">06 de dezembro de 2026</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 id="visao-geral-titulo" className="font-serif text-4xl text-foreground sm:text-5xl">Visão geral</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              O ponto de partida para acompanhar os preparativos e o relacionamento com os convidados.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[#d6ae64]/35 bg-[#d6ae64]/10 px-3 py-1.5 text-xs font-medium text-[#76551f]">
            <CircleDashed className="size-3.5" aria-hidden="true" />
            Integrações pendentes
          </span>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <a key={module.id} href={`#${module.id}`} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                <Card className="h-full border-border/80 bg-card/90 shadow-sm transition duration-200 group-hover:-translate-y-0.5 group-hover:border-[#d6ae64]/55 group-hover:shadow-md">
                  <CardContent className="p-5">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground" aria-hidden="true"><Icon className="size-5" /></span>
                    <h2 className="mt-5 font-serif text-2xl">{module.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{module.description}</p>
                    <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-[#9f7a34]">Ver módulo</p>
                  </CardContent>
                </Card>
              </a>
            );
          })}
        </div>
      </section>

      {modules.map((module) => {
        const Icon = module.icon;
        return (
          <section key={module.id} id={module.id} className="dashboard-section scroll-mt-24" aria-labelledby={`${module.id}-titulo`}>
            <Card className="border-border/80 bg-card/80 shadow-sm">
              <CardContent className="p-6 sm:p-8">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-4">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#d6ae64]/12 text-[#8a672d]" aria-hidden="true"><Icon className="size-5" /></span>
                    <div>
                      <h2 id={`${module.id}-titulo`} className="font-serif text-3xl">{module.title}</h2>
                      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{module.description}</p>
                    </div>
                  </div>
                  <span className="w-fit rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    Integração futura
                  </span>
                </div>
                <div className="mt-8 rounded-xl border border-dashed border-border bg-muted/30 px-5 py-8 text-center">
                  <p className="font-medium text-foreground">Nenhum dado disponível</p>
                  <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                    {preview
                      ? "Este ambiente de demonstração não consulta dados reais."
                      : "Este módulo será preenchido quando o endpoint administrativo estiver disponível."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
