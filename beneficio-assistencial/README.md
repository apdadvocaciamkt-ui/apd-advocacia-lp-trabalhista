# APD - formulário de benefício assistencial

## Estado

Formulário publicado na rota `/beneficio-assistencial/`, com backend em
`POST /api/beneficio-assistencial`.

O mesmo caminho também funciona no projeto Cloudflare Pages isolado. Nesse
ambiente, `functions/api/beneficio-assistencial.js` grava as respostas no D1
`apd-landing-tracking-db`, relaciona o envio ao evento `Lead` pelo `event_id`
e sincroniza o contato com o LiderHub. A implantação da Vercel permanece
disponível como rollback, mas a integração CRM é canônica no Cloudflare.

O sucesso somente é confirmado na tela depois que o registro é gravado e o
contato é criado ou atualizado no LiderHub.

## Dados armazenados

Cada envio grava no D1:

- ID aleatório;
- data e hora do envio;
- nome e telefone normalizado com DDI;
- origem fixa `/beneficio-assistencial/`;
- os quatro códigos das opções marcadas (`q1` a `q4`).
- estado da sincronização e ID do contato no CRM.

Nome, telefone e as quatro respostas são enviados ao LiderHub. O contato entra
no status `LEADS`, recebe a etiqueta `LP | Benefício Assistencial` e ganha uma
nota interna com as respostas. A nota não é enviada como mensagem ao WhatsApp.
CPF, laudos e documentos não são solicitados. As respostas continuam fora dos
payloads enviados à Meta e ao GA4.

## Proteções

- armazenamento no D1 do projeto Cloudflare;
- chave do LiderHub mantida somente como segredo do ambiente;
- validação estrita das opções permitidas;
- validação e normalização de nome e telefone;
- limite de 4 KiB por requisição;
- validação de mesma origem;
- campo honeypot para reduzir spam;
- resposta `no-store` e sem retorno da URL privada do registro.

## Arquivos

- `index.html` - interface do formulário e envio para a API;
- `../api/beneficio-assistencial.js` - Vercel Function de validação e gravação;
- `../functions/api/beneficio-assistencial.js` - Pages Function que grava no D1;
- `assets/` - logos oficiais usados no formulário.

Na Cloudflare, o evento genérico `Lead` e a atribuição de campanha são
registrados separadamente. Os dados identificáveis e as respostas não entram
nos payloads da Meta ou do GA4; aparecem apenas no dashboard protegido `/dash`
e no contato do LiderHub.

Os parâmetros `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e
`utm_term` seguem o método do `krob-tracking-stack`: são capturados pelo
middleware na entrada da página, persistidos em `sessions` com a chave
`_krob_sid` e relacionados ao `Lead` por `event_log.session_id`. O dashboard
faz o `LEFT JOIN` entre evento, sessão e envio do formulário, sem duplicar os
UTMs na tabela de respostas.
