# O cenário, e a janela que abriu em setembro de 2025

Pesquisa de **12/08/2026**. O objetivo declarado do OmniBoard não é receita, e sim **ser uma biblioteca
usada, com uma vitrine que prove que funciona**. Este arquivo é sobre onde ela se encaixa; o
[adocao-e-vitrine.md](adocao-e-vitrine.md) é sobre como fazer isso acontecer.

---

## 1. O achado que muda tudo: o tldraw fechou

| Fato | Selo |
|---|---|
| **A partir do tldraw SDK 4.0 (setembro de 2025), o SDK passou a ser distribuído sob a "tldraw license"** — código público no GitHub, uso licenciado | ✅ [tldraw.dev](https://tldraw.dev/blog/20-things-i-wish-ai-chatbots-knew-about-tldraw) |
| **"O SDK do tldraw exige uma chave de licença para funcionar em produção. Sem chave válida, o SDK roda apenas em modo de desenvolvimento."** | ✅ [tldraw Docs](https://tldraw.dev/sdk-features/license-key) |
| Na licença de hobby, **a marca d'água "made with tldraw" tem que aparecer no canvas** | ✅ [tldraw Docs](https://tldraw.dev/community/license) |
| Uso livre é permitido **apenas para fins não comerciais** — hobby, projeto de estudante, contribuição ao repositório | ✅ tldraw |
| Avaliação de terceiro: *"o código do tldraw é visível, mas uso em produção exige licença paga desde a mudança de setembro de 2025, então **na prática não é mais uma opção open source gratuita**"* | ⚠️ meetrix.io |
| **O Excalidraw continua sendo a escolha open source de verdade — MIT, self-host livre, sem marca d'água e sem chave de licença** | ⚠️ meetrix.io |

**Isso criou uma lacuna com data.** Existe, desde setembro de 2025, um fluxo contínuo de
desenvolvedores que avaliam o tldraw, batem no muro da licença, e saem procurando alternativa. Eles
existem hoje e estão procurando agora.

---

## 2. O mapa de abstração — onde exatamente o OmniBoard está

O ponto que decide adoção não é feature, é **nível de abstração**:

| Biblioteca | Nível | O que você tem que construir por cima | Licença |
|---|---|---|---|
| **PixiJS** | Renderização WebGL | tudo | MIT |
| **Konva.js** | Canvas 2D com eventos e drag-and-drop | undo/redo, snapping, seta que gruda, edição de texto, ferramentas, serialização | MIT |
| **Fabric.js** | idem | idem | MIT |
| **React Flow** | Nó e aresta | é para diagrama de fluxo, não canvas livre | MIT |
| **tldraw SDK** | **Canvas pronto de produto** | quase nada | ❌ **licença paga em produção** |
| **Excalidraw** | Editor inteiro como componente | pouco, mas é difícil compor | ✅ MIT |
| **OmniBoard** | **Canvas pronto de produto** | quase nada | ✅ **MIT** |

O Konva descreve a própria posição com honestidade:

> "Konva.js resolve um problema específico: construir gráficos 2D interativos em Canvas HTML5. Se os
> usuários precisam clicar, arrastar, redimensionar ou manipular formas, o Konva te dá tudo isso." ✅

**Tudo isso — e nada mais.** Quem escolhe Konva ainda vai escrever undo/redo, alinhamento com guia,
seta que se prende ao elemento e o segue, edição de texto no canvas, sistema de ferramentas e
serialização. São meses.

O OmniBoard já tem todos esses, e é MIT.

> **A frase de posicionamento: "features de tldraw, licença de Excalidraw."**

E há um segundo diferencial que nenhum concorrente do nível dele pode alegar: **`packages/core` não tem
dependência de runtime.** O tldraw é acoplado a React; o Excalidraw também. Um motor de canvas em
TypeScript puro, que funciona com React opcionalmente, atende Vue, Svelte, Angular e vanilla — que é
onde o Konva ganha hoje justamente por ser agnóstico.

---

## 3. O que falta para ocupar essa posição

Em ordem de gravidade. A primeira é de outra categoria.

### 3.1 ⛔ Não está no npm

Do próprio README:

```
npm i @omniboard/core           # not on npm yet — see docs/releasing.md
```

**Uma biblioteca que não se instala não é uma biblioteca.** É um repositório com código bom dentro.
Isso não é um item de roadmap entre outros — é a diferença entre existir e não existir como
biblioteca, e enquanto for verdade nada mais na lista importa.

### 3.2 Falta colaboração em tempo real

O tldraw vende "**enterprise-grade multiplayer sync**" ✅ e o Excalidraw tem colaboração ao vivo. O
OmniBoard tem **comentários assíncronos** ancorados no canvas, com resposta e resolução, mais link
público de leitura.

Isso é honesto e é menos. Mas duas observações:

**Não é necessariamente o próximo passo.** Muita aplicação que embarca canvas — editor de diagrama,
anotação, construtor de layout, editor de mapa mental — **não precisa de multiplayer**. Vender "canvas
embarcável" para esse público não exige resolver CRDT.

**A fundação já está lá.** Existe *"snapshot versionado, delta por elemento, autosave plugável"* e
detecção de escrita concorrente. Delta por elemento é exatamente o substrato de sincronização em tempo
real. Quando fizer sentido, o caminho é curto — e a saída pragmática é integrar Yjs ou Automerge em vez
de escrever CRDT próprio.

### 3.3 Falta a vitrine

É a pergunta que você fez, e ela tem resposta específica em
[adocao-e-vitrine.md](adocao-e-vitrine.md). Resumo: **a vitrine de uma biblioteca não é um app** — é um
site de documentação com exemplo vivo e editável em cada conceito.

### 3.4 Falta i18n

O README já reconhece: strings hardcoded, e i18n está no roadmap marcado como boa primeira
contribuição. Isso está certo — e é secundário para a **biblioteca**, porque quem embarca o motor traz
os próprios rótulos. Importa para o **app**.

---

## 4. O aviso sobre licença, e ele é irreversível ⚠️

O OmniBoard é MIT hoje. Vale entender o que isso decide, porque **não dá para voltar atrás**.

O tldraw começou permissivo e restringiu em setembro de 2025. Ganhou receita e pagou um preço de
reputação — a ponto de escreverem um post explicando que **nem os modelos de IA concordam sobre se eles
são open source** ✅, e de análises independentes dizerem que "na prática não é mais open source".

Se o objetivo do OmniBoard não é receita, **MIT é a escolha certa e vale se comprometer com ela em voz
alta.** O compromisso explícito é, ele mesmo, um diferencial competitivo agora: é exatamente a dúvida
que o desenvolvedor que saiu do tldraw tem.

E se um dia receita importar, o caminho que **não** queima reputação é:

| Caminho | Efeito |
|---|---|
| ✅ Motor MIT para sempre, monetizar o **app hospedado** | É o modelo do Excalidraw (Excalidraw+). Não quebra confiança |
| ✅ Motor MIT, vender **suporte, integração ou plugin** | Não quebra confiança |
| ❌ Relicenciar o motor depois de adotado | É o que o tldraw fez. Funciona comercialmente e custa a comunidade |

---

## 5. O valor interno, que não é receita e é real ⭐

Vale registrar, porque muda a prioridade: **o OmniBoard resolve problemas de outros dois projetos seus.**

| Projeto | Precisa de canvas | Hoje |
|---|---|---|
| **Noki** | `mindmap`, `board` (kanban com colunas) | Implementação própria. A [pesquisa do Noki](../../../Noki/docs/mercado/concorrentes.md) já sugere checar se o motor do OmniBoard resolve, em vez de manter dois canvas |
| **Weaver** | *"Tela dedicada de orquestração — grafo de papéis, fases ao vivo"*, e *"grafo declarativo de orquestração"* nas ideias maiores | No roadmap, não construído |

Se o motor for embarcável de verdade — e ele foi projetado para isso, com sistema de plugin para
elemento e ferramenta customizados — ele **elimina trabalho duplicado em dois produtos**. Isso é
retorno concreto, independente de qualquer estrela no GitHub.

E tem um efeito colateral valioso: **ser o primeiro usuário sério do próprio motor é o que faz a API
ficar boa.** Biblioteca que só o autor usa em demo tem API de demo.

---

## 6. Veredito

> O OmniBoard está no nível de abstração certo, com a licença certa, no momento em que o líder desse
> nível fechou. A distância entre isso e "biblioteca usada" é **publicar no npm e ter uma vitrine
> onde o desenvolvedor consiga avaliar em dois minutos**.

Três ações, e a primeira é eliminatória:

1. **Publicar `@omniboard/core` e `@omniboard/react` no npm.** Nada mais conta antes disso.
2. **Site de documentação com exemplo vivo por conceito** — não um app, e não só um playground.
3. **Página de comparação honesta** com tldraw, Excalidraw e Konva, dizendo o que o OmniBoard não tem.

Detalhe em [adocao-e-vitrine.md](adocao-e-vitrine.md).

---

## Selos

| Selo | Significa |
|---|---|
| ✅ | Fonte oficial verificada nesta pesquisa, ou verificado no repositório |
| ⚠️ | Fonte secundária ou comparativo de terceiro |
| ❓ | Não confirmado |
