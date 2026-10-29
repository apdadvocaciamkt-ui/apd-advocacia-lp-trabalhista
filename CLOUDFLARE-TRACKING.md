# APD — tracking isolado na Cloudflare

Este repositório continua compatível com a implantação existente na Vercel e
também contém uma implantação independente para Cloudflare Pages + D1.

## Recursos Cloudflare

- Projeto Pages: `apd-landing-tracking`
- Banco D1: `apd-landing-tracking-db`
- Binding obrigatório: `DB`
- Dashboard protegido: `/dash`

Os recursos preexistentes `dashboard-apd`, `dashboard-apd-cron`, `apd-db` e
`disparos` não fazem parte desta implantação e não devem ser alterados.

## Fluxo

1. O middleware cria cookies first-party e registra sessão, UTMs, `fbclid`,
   `gclid`, página de entrada e referenciador no D1.
2. `PageView` é enviado ao Pixel e ao endpoint `/tracker` com o mesmo
   `event_id`, permitindo deduplicação na Meta. PageViews não entram na tabela
   de eventos para reduzir gravações.
3. Cliques de WhatsApp e a conclusão do formulário geram um evento `Lead`
   deduplicado entre navegador e servidor.
4. As respostas do formulário são gravadas em
   `benefit_form_submissions` e relacionadas ao lead pelo `event_id`.
5. O dashboard `/dash` mostra leads, atribuição, saúde do tracking e, no caso
   do formulário, as quatro respostas.

## Privacidade

As respostas sobre saúde e família permanecem somente no D1 privado e no
dashboard autenticado. Elas não são incluídas em `dataLayer`, Meta Pixel,
Meta CAPI, GA4 ou Google Ads. O formulário não coleta nome, telefone, e-mail,
CPF, laudos ou documentos.

## Variáveis do Pages

Obrigatória:

- `DASH_KEY`: chave aleatória para abrir `/dash`.

Ativam integrações server-side quando as credenciais oficiais forem
fornecidas:

- `META_PIXEL_ID`
- `META_ACCESS_TOKEN`
- `GA4_MEASUREMENT_ID`
- `GA4_API_SECRET`

Sem os pares completos, o D1, a atribuição e o dashboard continuam
funcionando; o envio server-side correspondente aparece como `skipped`.

## Desenvolvimento local

O arquivo `wrangler.toml` é local e ignorado pelo Git. As migrations ficam em
`migrations/`; a migration `0016_apd_benefit_form_submissions.sql` é exclusiva
do formulário da APD.
