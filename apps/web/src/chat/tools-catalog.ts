/**
 * Catálogo das ferramentas que o assistente pode executar — espelha o contrato `TOOL_SPECS` do
 * orquestrador (apps/api/src/chat/orchestrator.service.ts). Usado no disclaimer "ferramentas
 * disponíveis" do composer. Manter em sincronia com o servidor ao adicionar/remover tools.
 */
export interface ToolDescriptorInterface {
  /** Nome técnico (igual ao do orquestrador). */
  name: string;
  /** Rótulo curto em PT-BR. */
  label: string;
  /** O que a ferramenta faz, em uma frase. */
  description: string;
}

/** As ferramentas expostas ao modelo (em ordem de uso típico). */
export const TOOLS_CATALOG: ToolDescriptorInterface[] = [
  {
    name: 'search_shippings',
    label: 'Buscar envios',
    description: 'Busca envios por telefone, status, provedor, cliente ou id de campanha, numa janela de tempo.',
  },
  {
    name: 'get_shipping_trail',
    label: 'Trilha de um envio',
    description: 'Mostra a linha do tempo de um envio (enfileirado → enviado → entregue/falha) com os códigos do provedor.',
  },
  {
    name: 'analyze_shipping_content',
    label: 'Analisar risco de conteúdo',
    description: 'Avalia o risco do conteúdo de um envio (padrões de phishing e SPAM).',
  },
  {
    name: 'generate_delivery_report',
    label: 'Relatório de entregabilidade',
    description: 'Gera um relatório agregado de entrega por janela, cliente ou provedor (com taxa por hora e top erros).',
  },
  {
    name: 'generate_incident_report',
    label: 'Relatório de incidentes',
    description: 'Gera um relatório de incidentes resolvidos por janela (total, por severidade e a lista).',
  },
  {
    name: 'list_incidents',
    label: 'Listar incidentes',
    description: 'Lista incidentes de anomalia por status, severidade ou dimensão.',
  },
  {
    name: 'get_incident',
    label: 'Detalhar incidente',
    description: 'Abre um incidente específico e suas atividades pelo id.',
  },
  {
    name: 'list_providers',
    label: 'Listar provedores',
    description: 'Lista os provedores com atividade numa janela de tempo.',
  },
  {
    name: 'list_customers',
    label: 'Listar clientes',
    description: 'Lista os clientes com atividade numa janela de tempo.',
  },
];

/**
 * Rótulo legível (PT-BR) de uma ferramenta pelo nome técnico; cai no próprio nome se desconhecida.
 *
 * @param name - Nome técnico da tool (ex.: `generate_delivery_report`).
 *
 * @returns Rótulo amigável (ex.: "Relatório de entregabilidade").
 */
export function toolLabel(name: string): string {
  return TOOLS_CATALOG.find((tool) => tool.name === name)?.label ?? name;
}

/**
 * Troca os nomes técnicos das ferramentas pelos rótulos legíveis no texto exibido (raciocínio/
 * resposta). Rede de segurança independente da aderência do modelo ao prompt — o usuário nunca vê
 * `search_shippings` etc. mesmo se o modelo escrever.
 *
 * @param text - Texto cru do modelo.
 *
 * @returns Texto com os nomes técnicos substituídos pelos rótulos.
 */
export function humanizeToolNames(text: string): string {
  return TOOLS_CATALOG.reduce(
    (
      acc,
      tool,
    ) => acc.replaceAll(
      tool.name,
      tool.label,
    ),
    text,
  );
}
