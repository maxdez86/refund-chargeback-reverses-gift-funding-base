import React from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Database,
  Heart,
  Lock,
  Mail,
  Scale,
  Server,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CONTACT_EMAIL, CONTACT_EMAIL_MAILTO } from "@/lib/contact";

export default function Privacidade() {
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return (
    <div className="min-h-screen bg-[#fcfbf9] text-[#30251f] flex flex-col selection:bg-[#9f7a34]/20 selection:text-[#30251f]">
      {/* Top Header / Navigation */}
      <header className="sticky top-0 z-40 w-full border-b border-[#e7e1d5] bg-[#fcfbf9]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link
            href="/"
            className="group inline-flex items-center gap-2 text-sm font-medium text-[#736357] transition-colors hover:text-[#30251f]"
            aria-label="Voltar para a página inicial"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
            <span>Voltar para o início</span>
          </Link>

          <Link
            href="/"
            className="font-serif text-2xl font-medium tracking-tight text-[#30251f] hover:text-[#9f7a34] transition-colors"
          >
            Brimax
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-12 md:py-16">
        <div className="mx-auto max-w-4xl px-6">
          {/* Header Banner */}
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#d6ae64]/40 bg-[#f7f1e5] px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[#8a6a22]">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Transparência &amp; Privacidade</span>
            </div>

            <h1 className="font-serif mt-6 text-4xl text-[#30251f] md:text-5xl lg:text-6xl font-normal">
              Política de Privacidade
            </h1>

            <p className="mt-4 text-base md:text-lg text-[#736357] max-w-2xl mx-auto leading-relaxed">
              Esta política descreve de forma clara e transparente como tratamos,
              protegemos e respeitamos os dados pessoais dos nossos convidados e
              familiares para a celebração do Casamento de Brida &amp; Max.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-[#8c7a6e]">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[#efeae1] px-2.5 py-1">
                <Calendar className="h-3.5 w-3.5 text-[#9f7a34]" />
                Evento: 06 de Dezembro de 2026
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[#efeae1] px-2.5 py-1">
                <Scale className="h-3.5 w-3.5 text-[#9f7a34]" />
                Em conformidade com a LGPD (Lei nº 13.709/2018)
              </span>
            </div>

            <div className="faq-v2-divider mx-auto my-10 w-24" />
          </div>

          {/* Policy Sections */}
          <div className="space-y-8">
            {/* 1. Controlador dos Dados */}
            <Card className="border-[#e7e1d5] bg-[#ffffff] shadow-xs">
              <CardContent className="p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-[#f7f1e5] p-2.5 text-[#8a6a22] shrink-0">
                    <Heart className="h-5 w-5" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="font-serif text-2xl text-[#30251f] font-medium">
                      1. Controlador dos Dados
                    </h2>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42]">
                      O controlador dos dados pessoais tratados nesta plataforma é a organização do{" "}
                      <strong className="text-[#30251f]">Casamento Brida &amp; Max</strong>, com
                      celebração agendada para o dia{" "}
                      <strong className="text-[#30251f]">06/12/2026</strong> em São Paulo - SP.
                    </p>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42]">
                      Os noivos são os responsáveis diretos pelas decisões referentes ao tratamento
                      dos dados pessoais de seus convidados, coletados exclusivamente para fins de
                      organização, logística, segurança e celebração do matrimônio.
                    </p>
                    <div className="pt-2 text-sm text-[#736357]">
                      <span>Canal oficial de contato do controlador: </span>
                      <a
                        href={CONTACT_EMAIL_MAILTO}
                        className="font-medium text-[#9f7a34] underline underline-offset-2 hover:text-[#7d5d20]"
                      >
                        {CONTACT_EMAIL}
                      </a>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 2. Dados Pessoais Coletados */}
            <Card className="border-[#e7e1d5] bg-[#ffffff] shadow-xs">
              <CardContent className="p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-[#f7f1e5] p-2.5 text-[#8a6a22] shrink-0">
                    <Database className="h-5 w-5" />
                  </div>
                  <div className="space-y-4 w-full">
                    <h2 className="font-serif text-2xl text-[#30251f] font-medium">
                      2. Dados Pessoais Coletados
                    </h2>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42]">
                      Coletamos apenas as informações estritamente necessárias para planejar o
                      evento, acolher nossos convidados e viabilizar os serviços da plataforma:
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2 pt-1">
                      <div className="rounded-lg border border-[#ede7dc] bg-[#faf8f4] p-4 space-y-1.5">
                        <h3 className="font-semibold text-sm text-[#30251f]">
                          Identificação &amp; Família
                        </h3>
                        <p className="text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                          Nome completo dos convidados titulares e relação de familiares ou
                          acompanhantes vinculados ao convite.
                        </p>
                      </div>

                      <div className="rounded-lg border border-[#ede7dc] bg-[#faf8f4] p-4 space-y-1.5">
                        <h3 className="font-semibold text-sm text-[#30251f]">
                          Contato &amp; WhatsApp
                        </h3>
                        <p className="text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                          Número de telefone celular / WhatsApp utilizado para envio do convite
                          digital, avisos transacionais e confirmação de presença.
                        </p>
                      </div>

                      <div className="rounded-lg border border-[#ede7dc] bg-[#faf8f4] p-4 space-y-1.5">
                        <h3 className="font-semibold text-sm text-[#30251f]">
                          Confirmação de Presença (RSVP)
                        </h3>
                        <p className="text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                          Status de confirmação (comparecimento), indicação de crianças de até 6 anos
                          (para buffet e espaço kids), restrições alimentares e observações para o
                          cerimonial.
                        </p>
                      </div>

                      <div className="rounded-lg border border-[#ede7dc] bg-[#faf8f4] p-4 space-y-1.5">
                        <h3 className="font-semibold text-sm text-[#30251f]">
                          Mural de Recados
                        </h3>
                        <p className="text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                          Mensagens de carinho, votos e fotos/homenagens enviadas espontaneamente
                          pelos convidados para exibição no mural do site.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#e5ded0] bg-[#fbf9f4] p-4 text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                      <strong className="text-[#30251f]">Presentes e Doações via Pix:</strong> Ao
                      adquirir um presente da lista virtual, são registrados o identificador da
                      transação e o item presenteado. Os pagamentos são processados pela
                      instituição financeira parceira (Asaas).{" "}
                      <strong className="text-[#30251f]">
                        O site não armazena dados bancários confidenciais ou cartões de crédito.
                      </strong>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 3. Finalidade do Tratamento */}
            <Card className="border-[#e7e1d5] bg-[#ffffff] shadow-xs">
              <CardContent className="p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-[#f7f1e5] p-2.5 text-[#8a6a22] shrink-0">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div className="space-y-3">
                    <h2 className="font-serif text-2xl text-[#30251f] font-medium">
                      3. Finalidade do Tratamento
                    </h2>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42]">
                      Os dados pessoais coletados destinam-se exclusivamente às seguintes finalidades:
                    </p>

                    <ul className="space-y-2.5 pt-1 text-sm md:text-base text-[#5c4d42]">
                      <li className="flex items-start gap-2.5">
                        <CheckCircle2 className="h-5 w-5 text-[#8a6a22] shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-[#30251f]">Organização e Gestão de Convidados:</strong>{" "}
                          Controle de lista de presença, dimensionamento de buffet, planejamento do
                          espaço kids e acomodação de necessidades e restrições alimentares.
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <CheckCircle2 className="h-5 w-5 text-[#8a6a22] shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-[#30251f]">Notificações e Confirmações via WhatsApp:</strong>{" "}
                          Envio de lembretes, detalhes de localização, horários e reconfirmação de
                          presença através da API oficial do WhatsApp Cloud.
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <CheckCircle2 className="h-5 w-5 text-[#8a6a22] shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-[#30251f]">Exibição de Mensagens no Mural:</strong>{" "}
                          Publicação dos recados deixados pelos amigos e familiares na página de
                          homenagens.
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <CheckCircle2 className="h-5 w-5 text-[#8a6a22] shrink-0 mt-0.5" />
                        <span>
                          <strong className="text-[#30251f]">Gestão da Lista de Presentes:</strong>{" "}
                          Conciliação de presentes recebidos via Pix e envio de mensagens de
                          agradecimento pelos noivos.
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 4. Compartilhamento com Terceiros (Operadores) */}
            <Card className="border-[#e7e1d5] bg-[#ffffff] shadow-xs">
              <CardContent className="p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-[#f7f1e5] p-2.5 text-[#8a6a22] shrink-0">
                    <Share2 className="h-5 w-5" />
                  </div>
                  <div className="space-y-4 w-full">
                    <h2 className="font-serif text-2xl text-[#30251f] font-medium">
                      4. Compartilhamento com Terceiros (Operadores)
                    </h2>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42]">
                      Para viabilizar o funcionamento técnico da plataforma e os serviços do
                      casamento, os dados podem ser compartilhados estritamente com os seguintes
                      operadores de tecnologia e infraestrutura:
                    </p>

                    <div className="space-y-3 pt-1">
                      <div className="rounded-lg border border-[#ede7dc] bg-[#faf8f4] p-4">
                        <div className="flex items-center gap-2 font-semibold text-sm text-[#30251f]">
                          <Smartphone className="h-4 w-4 text-[#8a6a22]" />
                          <span>Meta Platforms / WhatsApp Cloud API</span>
                        </div>
                        <p className="mt-1 text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                          Utilizado para o disparo e recebimento seguro de mensagens transacionais de
                          convite, atualizações do evento e confirmação de presença (RSVP).
                        </p>
                      </div>

                      <div className="rounded-lg border border-[#ede7dc] bg-[#faf8f4] p-4">
                        <div className="flex items-center gap-2 font-semibold text-sm text-[#30251f]">
                          <Scale className="h-4 w-4 text-[#8a6a22]" />
                          <span>Asaas Gestão Financeira Instituição de Pagamento S.A.</span>
                        </div>
                        <p className="mt-1 text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                          Instituição de pagamento regulada pelo Banco Central do Brasil, responsável
                          pelo processamento, liquidação e conciliação segura dos presentes e
                          contribuições via Pix.
                        </p>
                      </div>

                      <div className="rounded-lg border border-[#ede7dc] bg-[#faf8f4] p-4">
                        <div className="flex items-center gap-2 font-semibold text-sm text-[#30251f]">
                          <Server className="h-4 w-4 text-[#8a6a22]" />
                          <span>Amazon Web Services (AWS)</span>
                        </div>
                        <p className="mt-1 text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                          Provedor de infraestrutura de nuvem segura (AWS Lambda, DynamoDB, S3,
                          CloudFront) onde os dados da aplicação são armazenados com criptografia e
                          altos padrões de segurança.
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#e5ded0] bg-[#fbf9f4] p-4 text-xs md:text-sm text-[#5c4d42] leading-relaxed">
                      <strong className="text-[#30251f]">Compromisso de Não Comercialização:</strong>{" "}
                      Seus dados pessoais <strong className="text-[#30251f]">nunca</strong> serão
                      vendidos, alugados, cedidos ou compartilhados com empresas de publicidade ou
                      quaisquer terceiros para fins comerciais.
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 5. Segurança da Informação e Retenção */}
            <Card className="border-[#e7e1d5] bg-[#ffffff] shadow-xs">
              <CardContent className="p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-[#f7f1e5] p-2.5 text-[#8a6a22] shrink-0">
                    <Lock className="h-5 w-5" />
                  </div>
                  <div className="space-y-3">
                    <h2 className="font-serif text-2xl text-[#30251f] font-medium">
                      5. Segurança da Informação e Retenção
                    </h2>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42]">
                      Adotamos práticas e medidas técnicas adequadas para proteger seus dados
                      pessoais contra acessos não autorizados, perda ou alteração indevida:
                    </p>
                    <ul className="list-disc pl-5 space-y-1.5 text-sm md:text-base text-[#5c4d42]">
                      <li>
                        Criptografia de ponta a ponta nas transmissões de rede (HTTPS / TLS).
                      </li>
                      <li>
                        Armazenamento em banco de dados seguro em nuvem com criptografia em repouso.
                      </li>
                      <li>
                        Acesso ao painel administrativo restrito exclusivamente aos noivos por meio de
                        autenticação segura.
                      </li>
                    </ul>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42] pt-2">
                      <strong className="text-[#30251f]">Período de Retenção:</strong> Os dados
                      pessoais serão armazenados e processados durante o ciclo de planejamento e
                      execução do casamento (data do evento: 06/12/2026) e pelo período necessário
                      para recordações afetivas dos noivos (como mensagens do mural). Após a
                      conclusão das finalidades, os dados serão excluídos de forma segura.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 6. Direitos do Titular (LGPD) */}
            <Card className="border-[#e7e1d5] bg-[#ffffff] shadow-xs">
              <CardContent className="p-6 md:p-8">
                <div className="flex items-start gap-4">
                  <div className="rounded-lg bg-[#f7f1e5] p-2.5 text-[#8a6a22] shrink-0">
                    <Scale className="h-5 w-5" />
                  </div>
                  <div className="space-y-3">
                    <h2 className="font-serif text-2xl text-[#30251f] font-medium">
                      6. Direitos do Titular (LGPD)
                    </h2>
                    <p className="text-sm md:text-base leading-relaxed text-[#5c4d42]">
                      Em cumprimento ao Artigo 18 da Lei Geral de Proteção de Dados Pessoais (LGPD -
                      Lei nº 13.709/2018), você possui o direito de solicitar a qualquer momento:
                    </p>
                    <ul className="grid gap-2 sm:grid-cols-2 text-xs md:text-sm text-[#5c4d42] pt-1">
                      <li className="rounded-md bg-[#faf8f4] border border-[#ede7dc] p-3">
                        <strong className="text-[#30251f] block mb-1">Confirmação e Acesso</strong>
                        Confirmar a existência de tratamento e acessar os dados fornecidos.
                      </li>
                      <li className="rounded-md bg-[#faf8f4] border border-[#ede7dc] p-3">
                        <strong className="text-[#30251f] block mb-1">Correção e Atualização</strong>
                        Corrigir dados incompletos, inexatos ou desatualizados.
                      </li>
                      <li className="rounded-md bg-[#faf8f4] border border-[#ede7dc] p-3">
                        <strong className="text-[#30251f] block mb-1">Exclusão ou Anonimização</strong>
                        Solicitar a remoção de seus dados da lista de convidados ou do mural.
                      </li>
                      <li className="rounded-md bg-[#faf8f4] border border-[#ede7dc] p-3">
                        <strong className="text-[#30251f] block mb-1">Revogação de Comunicações</strong>
                        Optar por não receber lembretes ou mensagens automáticas no WhatsApp.
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 7. Canal de Contato */}
            <Card className="border-[#d6ae64]/50 bg-gradient-to-br from-[#faf7f0] to-[#f4ede0] shadow-xs">
              <CardContent className="p-6 md:p-8 text-center space-y-4">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f7f1e5] text-[#8a6a22]">
                  <Mail className="h-6 w-6" />
                </div>
                <div className="space-y-2">
                  <h2 className="font-serif text-2xl text-[#30251f] font-medium">
                    7. Canal de Atendimento e Dúvidas
                  </h2>
                  <p className="text-sm md:text-base text-[#5c4d42] max-w-xl mx-auto leading-relaxed">
                    Se você tiver dúvidas sobre esta Política de Privacidade ou desejar exercer seus
                    direitos de titular, entre em contato diretamente conosco através do nosso e-mail
                    oficial:
                  </p>
                </div>
                <div className="pt-2">
                  <a
                    href={CONTACT_EMAIL_MAILTO}
                    className="inline-flex items-center gap-2 rounded-full bg-[#30251f] px-6 py-2.5 text-sm font-medium text-[#fbf7f0] transition-colors hover:bg-[#483930]"
                  >
                    <Mail className="h-4 w-4" />
                    <span>{CONTACT_EMAIL}</span>
                  </a>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bottom Navigation */}
          <div className="mt-12 flex flex-col items-center justify-center gap-4 text-center">
            <Button
              asChild
              variant="outline"
              className="rounded-full px-6 border-[#d6ae64]/40 hover:bg-[#f7f1e5] text-[#30251f]"
            >
              <Link href="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Voltar para o início
              </Link>
            </Button>

            <p className="font-serif mt-6 text-xl italic text-[#736357]">
              Com amor, Brida &amp; Max.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
