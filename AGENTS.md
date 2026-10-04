# Repository agent guide

## Cómo trabajar con Vitoria y Emiliano

House Ops es el sistema de Vitoria y Emiliano. Vitoria es la owner del producto
y la principal stakeholder: decide qué problema resolver, qué prioridad tiene y
si la experiencia final sirve. Emiliano es el owner técnico y puede opinar sobre
decisiones técnicas de alto impacto. Codex trabaja directamente con Vitoria y
toma las decisiones técnicas normales.

- Vitoria no necesita saber programación, Git, Docker ni Django. Puede describir
  una necesidad con sus propias palabras, mandar una captura o contar qué
  esperaba y qué ocurrió.
- Codex debe traducir esa necesidad a una solución simple, implementar el
  cambio, probarlo y dejarlo listo para que Vitoria lo use localmente.
- Codex no debe pedirle a Emiliano aprobación para botones, formularios,
  templates, tests, estructura interna o decisiones técnicas reversibles.
- Codex debe consultar a Vitoria cuando no esté claro el comportamiento,
  prioridad, texto visible o flujo que ella necesita.
- Codex debe consultar a Emiliano sólo cuando la decisión sea muy técnica,
  riesgosa o difícil de revertir: arquitectura, seguridad, datos financieros,
  migraciones delicadas, integraciones externas, credenciales o producción.
- Si una decisión técnica es segura y reversible, Codex elige la opción
  convencional y avanza. No debe frenar el trabajo esperando una opinión técnica
  que no sea necesaria.

### Conversación con Vitoria

- Usar español claro, paciente y cotidiano; explicar los términos técnicos sólo
  cuando ayuden a decidir algo.
- No pedirle código ni comandos como primera opción. Si alguna acción manual es
  inevitable, dar un único comando copiable y explicar para qué sirve.
- No exigirle que revise código. La validación principal de Vitoria es probar el
  flujo en el navegador y decir si resuelve su necesidad.
- Para un pedido claro, implementar directamente. Preguntar sólo cuando una
  suposición pueda cambiar materialmente el resultado.
- Al terminar, explicar brevemente qué cambió y dar una ruta concreta para
  probarlo: URL local, clics esperados y resultado que debería aparecer.
- Nunca presentar como listo algo que sólo pasó tests si el cambio también
  necesitaba verificarse en la aplicación real.

### Criterio de producto

Casa es una app para los gastos compartidos de Emiliano y Vitoria: facturas,
vencimientos, alquiler, pagos, reparto mensual e historial auditable. Antes de
crear un módulo, revisar si un gasto, pago, transferencia o comprobante existente
resuelve la necesidad. No reincorporar tareas, rutinas, finanzas personales ni
sincronizaciones automáticas sin un pedido explícito.

La interfaz debe priorizar lenguaje cotidiano, pocos pasos, controles grandes,
uso desde el celular y una acción principal clara. Vitoria decide si algo es
fácil de entender; Codex implementa sin agregar complejidad innecesaria.

### Flujo de cada cambio

1. Entender el resultado cotidiano que Vitoria quiere obtener.
2. Revisar la implementación, los tests y el flujo existente.
3. Elegir la solución mínima que preserve los datos y las reglas del sistema.
4. Implementar en un worktree aislado cuando haya cambios de archivos.
5. Ejecutar la validación técnica y, si corresponde, probar el flujo en
   navegador con la vista móvil.
6. Entregar a Vitoria el resultado, la forma de probarlo y cualquier limitación
   real.
7. Iterar a partir de lo que Vitoria observe usando lenguaje cotidiano.

El trabajo local es el entorno predeterminado. Codex debe ocuparse del worktree,
Docker y los comandos técnicos; Vitoria sólo debería necesitar abrir la URL y
probar. No sincronizar servicios externos, modificar producción, cambiar
credenciales ni borrar o reescribir datos sin una autorización explícita.

## Purpose and sources of truth

`House Ops` / Casa is a Next.js + TypeScript application for shared household
expenses. It uses PostgreSQL 17, Prisma, Zod, Auth.js and Tailwind. The previous
Django, Python and dbt code is retained as a historical migration/rollback source,
not as a dependency of the new runtime.

- Use `README.md` for the detailed domain model, setup, and operator workflows.
- Treat the implementation and tests as the source of truth when documentation
  is stale. Call out the mismatch and update both when it is in scope.
- Keep this file focused on durable repository guidance. Task-specific goals and
  temporary decisions belong in the task prompt, not in `AGENTS.md`.
- Preserve the existing language of the surface being changed: code identifiers
  are English, while user-facing documentation and House Ops copy are generally
  Spanish.

## Production VPS

- The production instance on this VPS is served at
  `https://casa.bordarteuniformes.com.ar`; use this domain as the canonical
  target for real health, browser, and smoke checks.
- This laptop is development only. Its `docker-compose.yml`, `home-lab-dev`,
  linked worktrees, and any old local containers are never production. Do not
  run `production-compose.sh`, production syncs, or production deploys here.
- Production deploys run on the VPS host `bordarte` through the GitHub Actions
  runner label `vps-production`; a self-hosted runner on this laptop must never
  carry a production runner label.
- The VPS runner uses a restricted `sudo` rule for only
  `scripts/deploy-production.sh`; do not grant it general root access.
- Diagnose the public domain, reverse proxy, and services behind it as one
  deployment. Local ports, Docker project names, images, and worktrees are
  supporting evidence only and must not be assumed to identify production.
- Before changing production, identify the active proxy/service path and
  deployed revision with read-only checks. Do not trigger synchronization,
  authentication, or data mutation during diagnosis unless explicitly asked.

## Architecture invariants

- Expenses are obligations, not payments. Supplier payments and transfers between
  the two household members remain separate and are explicitly recorded.
- Assign an expense to its due-date month, not its statement period. Extraordinary
  condominium expenses credit the next month's rent; no extraordinary expenses
  means no credit. Do not invent an agreed rent from banking movements.
- Calculate money in integer cents. Preserve every cent when splitting 50/50.
- PDF files live in content-addressed storage outside PostgreSQL. The database
  stores paths, hashes, sizes and traceability, never document binary contents.
- Imports are idempotent and preserve source lineage. Never infer who paid from
  an invoice alone. Imported payments with no verified payer stay unassigned.
- Explicit edits, payments and voids share a transaction with append-only audit.
  Do not silently overwrite concurrent changes or erase audit history.
- The new runtime writes public.shared\_\* tables. Legacy Bronze/Silver/Gold/raw
  tables and original documents stay untouched during migration and rollback.
  Do not run dbt, synchronization or authentication as part of normal startup.
- External downloads must remain restricted to trusted source endpoints, validate
  the response as a PDF and enforce the size limit. The web never fetches URLs
  submitted through a financial form.
- Never package credentials, invoices, .private, data or old financial archives
  into Git, screenshots, logs or container images.

## Repository map

- `src/app/`: protected pages, Server Actions and API routes.
- `src/components/`: reusable forms and responsive navigation.
- `src/lib/calculation.ts`, `money.ts`, `month.ts`: monthly sharing and exact cents.
- `src/lib/documents.ts`: PDF validation, compatible expense extraction and storage.
- `src/auth.ts`, `src/lib/session.ts`, `password.ts`: household authentication.
- `prisma/schema.prisma`, `prisma/migrations/`: additive data model and constraints.
- `scripts/import-legacy.ts`: one-time read of the frozen legacy financial snapshot.
- `scripts/import-pdf.ts`, `import-records.ts`: assisted private document imports.
- `scripts/local-setup.ts`, `migrate.ts`, `seed.ts`: isolated local startup.
- `tests-next/`, `scripts/integration-test.ts`, `browser-tests.ts`: domain, database
  migration and desktop/mobile verification with synthetic isolated databases.
- `scripts/deploy-production.sh`, Compose and CI: explicit VPS cutover and rollback.
- `src/home_lab/`, `src/house_ops/`, `dbt/`, `tests/`: preserved historical Python
  source and tests. Modify only when the requested work includes legacy behavior.

## Change guidelines

- Inspect the relevant implementation, tests and README before editing. Prefer the
  smallest coherent change that satisfies the household flow.
- Keep parsing, storage, calculations, authentication and orchestration separate.
  Avoid generic catch-all packages and unnecessary production dependencies.
- Validate financial inputs with Zod and database constraints. Add focused tests
  for money/date rules, malformed documents, authentication and duplicate imports.
- Automated tests use synthetic fixtures and isolated local databases, never live
  Gmail, Mercado Pago, SIAT or production records.
- Schema changes must be forward-compatible. Do not drop or rewrite user data as
  a side effect of startup. Legacy lineage and original PDFs must remain recoverable.
- Changes to behavior or operator commands include corresponding README updates.
- Preserve English code identifiers and everyday Spanish user-facing copy.

## Local setup and commands

Do not overwrite existing `.env` or `.env.local`. In the linked worktree:

```sh
npm install
npm run dev:setup
npm run dev
```

`dev:setup` generates an isolated `.env.local`, PostgreSQL port, Compose project,
volume and private local login instructions. The app is http://localhost:3000;
`.private/local-login.txt` contains the generated local accesses. Do not print
passwords in tool output. Keep the application running for the user's validation.

## Validation expectations

- Run `npm run typecheck`, focused Vitest tests and `npm test` for behavior changes.
- Run `npm run test:integration` for schema, importer or monetary persistence work;
  it verifies the migration against a synthetic legacy database and repeat imports.
- For visual/interaction changes, run `npm run test:e2e` and visually inspect the
  desktop/mobile synthetic previews. Passing tests alone does not prove the
  experience is ready. The test runner never uses household or production data.
- Run `npm run build`; build and smoke the container for deployment changes.
- Run `docker compose --env-file .env.example config --quiet` and the equivalent
  production example for Compose changes. Use `bash -n` on changed shell scripts.
- Run `git diff --check`. Report exactly which validations were skipped and why.
- Python tests and dbt build are relevant only when changing the archived Python
  behavior or warehouse models; they are not required to use the Next.js app.

## Sensitive data and external actions

- Never read, print, copy, or commit `.env`, `secrets/`, OAuth tokens, production
  access tokens, or files under `data/` unless the user explicitly puts a
  specific local artifact in scope. Minimize any output even then.
- Use `.env.example` and synthetic or sanitized fixtures for documentation and
  tests.
- Do not run authentication, production synchronization, report configuration,
  or other live external actions unless the user explicitly requests that action.
- Do not delete or rewrite local financial records, stored documents, database
  volumes, or credentials without explicit approval and a recovery plan.
- Keep secrets, account identifiers, personal management codes, document
  contents, and private financial values out of logs, exceptions, screenshots,
  patches, and commits.

## Git and worktree workflow

- Prefer the authenticated GitHub CLI (`gh`) for pull requests, Actions checks
  and logs, branch publication, and merges in this repository. Use a GitHub
  connector only when `gh` does not cover the required operation or the user
  explicitly requests the connector.
- For every task that will create, edit, rename, or delete repository files, work
  in a dedicated Git worktree. Read-only inspection, diagnosis, explanation, and
  status checks do not require a new worktree.
- Before editing, determine whether the current checkout is already a linked
  worktree. If it is, keep using it and do not create a nested or second worktree
  for the same task.
- When the task starts in the primary checkout:
  1. Inspect `git status` and preserve all existing user changes.
  2. Create a short, filesystem-safe task slug.
  3. Create a new branch named `codex/<slug>` and a linked worktree at
     `../worktrees/house-ops/<slug>`, based on the current `HEAD`.
  4. From the new worktree, run `scripts/init-worktree.sh` before any test,
     Compose, or application command. This installs Node dependencies and creates
     isolated `.env.local`, ports, Compose project, database volume and data paths.
     Do not copy another checkout's `.env` or run Compose with improvised
     settings.
  5. Perform every file modification and all task-specific validation from that
     worktree. Do not modify the primary checkout.
- `scripts/dev-up.sh` starts isolated PostgreSQL and forward-only Prisma migrations
  by default; add `--full` for the Next.js web server. Production snapshots are not
  available from the laptop; use local or synthetic development data.
- Choose a unique slug if the intended branch or directory already exists.
- Do not copy, stash, reset, clean, or otherwise alter uncommitted changes from
  the primary checkout unless the user explicitly asks.
- Do not commit, push, or open a pull request unless the user requests it.
- Do not automatically remove the task worktree when finished. In the final
  response, report its absolute path and branch name so it can be opened in Zed,
  reviewed, merged, or removed later.
- If the user explicitly asks to work in the current checkout, that request
  overrides this workflow for that task.

## Completion checklist

- Review `git diff` and `git status`; keep unrelated changes out of the task.
- Run the validation appropriate to the changed files.
- Summarize the behavior and guidance changed, validation results, and any
  remaining risks or skipped checks.
