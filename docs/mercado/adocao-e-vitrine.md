# Adoção e vitrine

Como o OmniBoard passa de repositório bom a biblioteca usada. Responde diretamente à pergunta *"ser uma
biblioteca e ter uma interface web pra mostrar funcionando"*.

---

# Parte 1 — Publicar, porque nada acontece antes disso

## 1.1 npm

O README diz `# not on npm yet`. Enquanto isso for verdade:

- ninguém instala
- ninguém acha por busca no npm
- nenhum roundup de "melhores bibliotecas de canvas" pode te listar, porque a primeira coluna dessas
  tabelas é o comando de instalação
- o agente de IA que alguém pergunta "qual biblioteca de canvas usar" não tem como te recomendar, porque
  não existe pacote

Já existe `docs/releasing.md`, então o processo foi pensado. **Isso é a tarefa número um do projeto**, à
frente de qualquer feature.

Detalhes que valem acertar de primeira:

| Item | Recomendação |
|---|---|
| Escopo | `@omniboard/core` e `@omniboard/react` — já é a nomenclatura usada |
| Versão | `0.x` sinaliza API instável, e é honesto. Sair em `1.0` cria expectativa de estabilidade que ainda não existe |
| `provenance` | Publicar do CI com `--provenance` dá o selo de origem verificada no npm. Sinal de seriedade barato |
| `exports` e tipos | ESM + tipos corretos. Erro de resolução de tipo é motivo comum de abandono na primeira tentativa |
| Tamanho | Publicar o número. "Zero dependência de runtime" **mais** o peso em kB é argumento forte contra tldraw e Excalidraw |
| `sideEffects: false` | Permite tree-shaking, e é o tipo de detalhe que quem avalia biblioteca olha |

## 1.2 O README do pacote é a página de vendas

Quem chega pelo npm vê o README de `packages/core`, não o da raiz. Ele precisa ter, nesta ordem:

1. **Um GIF de 5 segundos** do canvas funcionando. É o que decide se a pessoa continua lendo
2. Instalação e as 6 linhas de código que criam um canvas funcional — o README raiz já tem isso, e está bom
3. Link para o playground ao vivo
4. **A tabela de comparação**
5. O que **não** faz (sem tempo real, hoje)

---

# Parte 2 — A vitrine: três coisas diferentes, e a ordem importa

Aqui está a resposta específica à sua pergunta. "Interface web pra mostrar funcionando" pode ser três
coisas, elas servem a propósitos diferentes, e a prioridade não é óbvia.

## 2.1 O que cada uma faz

| Superfície | O que é | Serve para | Prioridade |
|---|---|---|---|
| **Docs com exemplo vivo** | Site de documentação onde **cada conceito da API tem um canvas pequeno, editável, rodando ao lado do código** | Converter quem está avaliando | **1ª** |
| **Playground** | Um canvas cheio, todas as ferramentas, compartilhável por URL | Compartilhamento, reprodução de bug, primeira impressão | **2ª** |
| **App completo** (`apps/web`, já existe) | O produto inteiro | Provar que o motor sustenta produto real | **3ª** |

### Por que docs com exemplo vivo vem primeiro

Porque é onde a decisão acontece. O desenvolvedor que saiu do tldraw não quer ver um whiteboard bonito —
ele quer saber **se dá para fazer o que ele precisa** e **quanto código custa**. Isso se responde com
código ao lado de um canvas que reage quando ele muda o código.

É o modelo do Konva (`konvajs.org`), e não por acaso o Konva é a biblioteca de canvas mais adotada da
lista mesmo sendo a mais baixo-nível: **a documentação dele é a melhor.**

### O que cada página de exemplo precisa ter

Uma por conceito, pequena, isolada:

| Página | Mostra |
|---|---|
| Canvas mínimo | as 6 linhas |
| Ferramentas | trocar de ferramenta por botão |
| **Snapshot e loadSnapshot** | JSON aparecendo ao lado, editável |
| Eventos | log do `change` ao vivo |
| **Seta que gruda no elemento** | mover o elemento e ver a seta seguir. É um dos melhores momentos do produto e ninguém sabe que existe |
| Snapping com guia | arrastar e ver a guia aparecer |
| **Elemento customizado (plugin)** | o exemplo mais importante para adoção: prova extensibilidade |
| **Ferramenta customizada (plugin)** | idem |
| Undo/redo | — |
| Persistência com backend | como plugar o autosave |
| Tema e aparência | claro/escuro e customização |
| Comentários | a colaboração assíncrona que existe |

**O exemplo de plugin é o que decide adoção séria.** Quem embarca canvas num produto sempre precisa de
um elemento que a biblioteca não tem. Se ficar claro em 20 linhas como criar um, o medo de adotar cai.

## 2.2 O playground

Um canvas em tela cheia, todas as ferramentas, e **estado serializado na URL** (ou num link curto).

Três usos, e o terceiro é o que economiza seu tempo:

1. Primeira impressão para quem chega do GitHub
2. Compartilhamento — alguém desenha algo e manda o link, e isso é distribuição de graça
3. **Reprodução de bug**: "reproduza no playground e cole o link na issue". Transforma issue vaga em
   caso reproduzível

Como o motor já serializa em JSON simples, isso é pequeno de construir.

## 2.3 O app completo

Já existe e é um ativo. O erro seria tratá-lo como a vitrine principal — porque quem procura biblioteca
não quer um produto, quer um componente. O papel dele é a seção *"o que dá para construir com isso"*,
com link, e a prova de que o motor aguenta contas, upload, comentários e persistência real.

## 2.4 Onde hospedar

`omniboard.dev` (ou `.js.org`, que é gratuito para projeto open source ⚠️ verificar critérios). Cloudflare
Pages ou GitHub Pages, custo zero.

⚠️ **Um cuidado técnico:** exemplo vivo com código editável costuma puxar um bundler no browser e pesar.
Se o site ficar lento, ele contradiz o argumento de que o motor é leve. Alternativa mais simples e
honesta: exemplos com código **estático ao lado do canvas rodando**, sem editor. Mostra o mesmo e carrega
em milissegundos.

---

# Parte 3 — Conteúdo, que é o canal de descoberta

Sem receita, o "marketing" é conteúdo técnico e presença nos lugares certos.

## 3.1 A página de comparação ⭐

A página que mais vai trazer gente qualificada, porque é exatamente o que quem saiu do tldraw digita.

Ela precisa ser **honesta ao ponto de dizer quando não escolher o OmniBoard** — é isso que faz ser
citada e confiada:

| Se você precisa de… | Use |
|---|---|
| Multiplayer em tempo real, pronto e suportado | **tldraw** (e pague a licença) ou Excalidraw |
| O editor inteiro, com estética de rascunho | **Excalidraw** |
| Controle de baixo nível, canvas próprio, qualquer framework | **Konva** ou Fabric |
| Diagrama de nó e aresta | **React Flow** |
| Milhares de objetos a 60 fps | **PixiJS** (WebGL) |
| **Canvas de produto, embarcável, MIT, sem dependência de runtime** | **OmniBoard** |

## 3.2 Artigos que trazem quem tem o problema

Não "apresentando o OmniBoard". Os problemas difíceis que você já resolveu:

- **"Como fazer uma seta que se prende a um elemento e o segue"** — problema real, difícil, e quase não
  documentado na web
- "Snapping com guia de alinhamento em canvas infinito"
- "Undo/redo em canvas: snapshot versus delta por elemento" — você implementou os dois
- "Editar texto em cima de Canvas 2D sem enlouquecer"
- "Detecção de escrita concorrente sem CRDT"

Cada um atrai quem está construindo canvas agora, e a conclusão natural é "isso já está resolvido aqui".

## 3.3 Onde aparecer

| Canal | Nota |
|---|---|
| **Awesome lists** | `awesome-canvas`, `awesome-javascript`. PR é grátis e dura |
| **Roundups de biblioteca de canvas** | `velt.dev` e outros publicam comparativos periódicos. Estar no npm é pré-requisito para entrar |
| Hacker News (Show HN) | Uma vez, quando o playground e os docs estiverem prontos |
| r/javascript, r/reactjs | Com o artigo técnico, não com "lancei meu projeto" |
| **Issue do tldraw sobre licença** | Existe discussão pública sobre a mudança. Aparecer ali oferecendo alternativa MIT é útil e legítimo — desde que seja educado e sem ataque |
| Excalidraw e Konva | **Não** se posicionar contra. Excalidraw é MIT como você, e Konva é outro nível de abstração |

## 3.4 Sobre estrela no GitHub

Estrela não é o objetivo, mas é o proxy que os diretórios e os artigos usam para incluir ou não. O que
realmente move: um artigo técnico bom, aparecer num roundup, e ser citado numa thread de "alternativa ao
tldraw".

---

# Parte 4 — Ordem de execução

| # | Item | Por quê nessa posição |
|---|---|---|
| **1** | **Publicar no npm** (`0.x`, com provenance) | Eliminatório. Nada abaixo funciona sem isso |
| **2** | **README do pacote** com GIF, código mínimo e tabela de comparação | É a página que o npm mostra |
| **3** | **Docs com exemplo por conceito**, incluindo os dois de plugin | Onde a decisão de adoção acontece |
| 4 | **Playground com estado na URL** | Compartilhamento e reprodução de bug |
| 5 | **Página de comparação honesta** | Traz quem saiu do tldraw |
| 6 | 2 artigos técnicos (seta que gruda, undo/redo) | SEO em problema real |
| 7 | Awesome lists e roundups | Distribuição durável |
| 8 | **Usar o motor no Noki e no Weaver** | Melhora a API de verdade e elimina trabalho duplicado |
| 9 | Tempo real com Yjs ou Automerge | Só quando alguém pedir. Não escrever CRDT próprio |
| 10 | i18n | Importa para o app, não para a biblioteca |

**O item 8 merece atenção** — não é marketing, é o que faz a API ficar boa. Biblioteca que só o autor
usa em demo tem API de demo. Embarcar no Noki (mindmap e board) e no Weaver (grafo de orquestração) é o
teste de embarcabilidade real, e os dois já precisam disso.

---

# Parte 5 — Como saber se funcionou

Sem receita, as métricas são de adoção:

| Métrica | O que indica |
|---|---|
| **Downloads semanais no npm** | A única métrica que importa de verdade para biblioteca |
| **Issues abertas por terceiros** | Prova que gente de fora está usando a sério. Issue é sinal melhor que estrela |
| **PR de terceiro** | O sinal mais forte que existe |
| Projetos usando em produção | Peça e monte um showcase |
| Estrelas | Proxy para entrar em lista e roundup |
| **Você mesmo usando no Noki e no Weaver** | O teste de embarcabilidade |

## Critério de morte

**Se, 6 meses depois de publicado no npm com docs e playground prontos, não houver nenhuma issue ou PR
de terceiro**, a biblioteca não achou público. Nesse caso as duas saídas honestas são: reduzir escopo e
tratar como dependência interna dos seus projetos — o que já paga o investimento pelo item 8 — ou
descobrir, conversando, por que quem avaliou não adotou.

**O que não fazer nesse cenário:** continuar adicionando feature. Biblioteca sem usuário não fica com
usuário por ter mais feature.
