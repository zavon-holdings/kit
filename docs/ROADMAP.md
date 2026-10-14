# Kit roadmap

This file is the kit slice of the Zavon roadmap: contracts and vectors (contract/), Go packages (go/) and TypeScript packages (ts/packages/). Written 14 October 2026.

- The global order of work is in the admin repo, docs/roadmap/BACKLOG.md. That file is the source of truth for the order across repos. This file copies that order for the kit slices only.
- The designs are in the admin repo, docs/roadmap/ (section 5 gives the files). This file gives the scope of each slice in 1 to 3 lines. Read the plan before you build a slice.

## How to use this file

- When you continue with scheduled work in this repo, take the first slice in "Start here" (section 4). If it is done, take the next slice in the queue (section 1) that is Ready.
- Kit holds the contracts that other repos build against. A kit slice is usually the first step of an item: when the vector exists, the other repos can build against it with fakes. So kit slices seldom wait for other repos.
- Each release takes the next free kit minor. Tag kit/go and publish the TypeScript packages, then the products vendor the release.
- Kit names no product, no client and no service in its code and copy. The words come from the host.
- When a slice is done, update its status here and in admin docs/roadmap/BACKLOG.md.

Status values:
- Ready: this repo can start the slice now.
- Blocked: the slice waits for a user input, an outside party, or a shipped part.
- In progress, Done, Idea: as usual.

Dependency labels:
- Independent: kit can build and release the slice alone now.
- Needs contract: the slice needs an agreed shape from another repo first (usually a plan section that names the fields).
- Needs shipped: the slice cannot start until another repo ships its part.

Days: dd is developer-days for a conventional engineer. The split per repo is an estimate ("about"). The plan's total for the item is in brackets. Build days are about dd ÷ 12, at least 0.5 per slice.

## 1. Queue (global order, kit slices only)

| Slice | Item, plan | What ships in kit | dd | Build days | Status | Dependency | Waits for (user) |
|---|---|---|---|---|---|---|---|
| 1-kit | 1, README "Next" | @zavon/tour 1.2.0: What's new opens by itself after an absence (kit 1.14.0). | — | — | Done | — | — |
| 37-M1-kit | 37, industries.md M1 | contract touch/1: the touch object (first touch, last non-direct touch, UTM keys, landing path, referrer host, date, click IDs), allow-listed keys, lengths and ID patterns, vectors in Go and TS. | about 1 (8) | 0.5 | Ready | Independent (shape in industries.md 4.1) | Consent rule (U2, default applied) |
| 38-M7-kit | 38, industries.md M7 | contract/ai vector for reach.report.narrative. | about 0.25 (7) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent (shape in industries.md section 8) | — |
| 5-K-kit | 5, site-assistant.md K | Vectors: the web turn request and reply, effects (register, notify), error codes, and the site.chat.answer input and output. Round-trip in Go and TS. | about 1 (20–23) | 0.5 | Ready (October, API first) | Independent (shapes in site-assistant.md 2 and 2.5) | — |
| 15a-kit | 15a, designer.md S3, S4 | Kit 1.15.0: contract/ai vectors for pages.designsystem.generate, pages.design.a11y.review and pages.component.docs. | about 0.5 (7) | 0.5 | Ready (October, API first) | Independent (shapes in designer.md 7.1) | — |
| 57-C1-kit | 57, connections.md C1 | The Integrations screen component: rows with Connected, Needs attention, Not connected; Connect and Test; Reconnect and Disconnect in an actions menu; "Ask an administrator" for people without the permission. | about 1 (7) | 0.5 | Ready | Needs contract: the core connections list shape (57-C1-core) | — |
| 58-G2-kit | 58, payouts.md G2 (also 57) | go/policy explicit-only set: an action in the set matches only a statement that names it, with no wildcard. Built once by 57 or 58, whichever ships first. | about 0.5 (2) | 0.5 | Ready | Independent | — |
| 58-G3-kit | 58, payouts.md G3 | @zavon/get-paid: step definitions, validation, wire types and contract testdata for the Get paid wizard. Each app renders it with its own components. | about 1.5 (6) | 0.5 | Ready after 58-G1-core shape | Needs contract: the core fee schedule shape (58-G1-core) | — |
| 43-E1-kit | 43, industries.md E1 | contract/ai vector update for shop.catalogue.enrich v2 (Google product category). | about 0.25 (11) | 0.5 | Ready (October, API first) | Independent | — |
| 65-kit | 65, workflow-port.md section 4 | @zavon/console-ui 1.0: SectionTable, Cell, GridToolbar, RowActions, InfoTip, Pager, useUrlState, useSavedView, FiltersMenu, ViewMenu, AssigneesPicker, Avatar, ScoreLine, ScheduledMoveLine, LockBanner, Modal, Menu, ActivityFeed, CommentComposer, RecordHeader, Wizard; contract/boardquery vectors. | about 7 (10) | 1 | In progress: contract/boardquery vectors done on kit branch bands-and-crm (14 Oct); @zavon/console-ui not started | Independent (useSavedView needs the Accounts ui-settings API, 65-accounts; fake it) | — |
| 74-kit | 74, workflow-port.md 2.15 | contract/emailcta in Go and TS: the first call to action becomes the button; later ones become accent links; mailto, tel and links inside a sentence never become buttons. | about 0.5 (2) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 66-kit | 66, workflow-port.md 2.16 | contract/runs gains the actor kind participant. | about 0.5 (6) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed); actor-participant vector | Independent | — |
| 67-kit | 67, workflow-port.md 2.2 to 2.4 | contract/deadlines: due, grace, then move or check, the snooze clock rule, vectors. | about 0.5 (5) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 69-kit | 69, workflow-port.md 2.8, 2.13 | contract/waits: wait kinds, link and user modes, withdraw and expire, 410 with a reason, the 423 run_locked body with a reason and an escape. | about 1 (8) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 60-B2-kit | 60, payouts.md B2 | contract/ai vector for payouts.letter.read (booleans and the last four digits only). | about 0.25 (22) | 0.5 | Ready | Independent | — |
| 60-B4-kit | 60, payouts.md B4 | @zavon/get-paid model 3 steps (bank or mobile money account, letter upload). | about 0.5 | 0.5 | Ready after 58-G3-kit | Needs shipped: 58-G3-kit | — |
| 25-CRM2-kit | 25, crm.md CRM2 | contract/ai vectors for reach.person.brief and reach.followup.draft. | about 0.25 (10) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent (shapes in crm.md 4.2) | — |
| 70-kit | 70, workflow-port.md 2.7 | band_of(scale, value) in Go and TS with vectors (boundaries 70, 75 and 80); band editor in @zavon/workflow-ui 1.12. | about 2 (5) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 26-CRM4-kit | 26, crm.md CRM4 | contract/ai vector for reach.note.actions. | about 0.25 (7) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 27-CRM5-kit | 27, crm.md CRM5 | contract/ai vector for reach.smartlist.build (the output is a cond tree). | about 0.25 (7) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 28-CRM6-kit | 28, crm.md CRM6 | contract/ai vector for reach.import.map. | about 0.25 (10) | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 28-CRM7-kit | 28, crm.md CRM7 | contract/ai vector for reach.insights.week. | about 0.25 | 0.5 | Done on kit branch bands-and-crm, 14 Oct (not tagged, not pushed) | Independent | — |
| 73-kit | 73, workflow-port.md 1.2 | @zavon/workflow-ui 1.12: deadline and default-assignee inspectors (with the band editor from 70-kit). | about 1 (8) | 0.5 | Ready after 67-kit | Independent | — |
| 75-kit | 75, workflow-port.md | contract/esign (the name signature is taken by webhook signing); the console-ui Wizard signature steps (upload, place fields, signers, send). | about 2 (10) | 0.5 | Blocked | Independent | Legal check on the signature level (U5) |
| 15b-kit | 15b, designer.md S6 | contract/ai vectors for pages.component.generate and pages.component.variants. | about 0.25 (16) | 0.5 | Ready after 15a | Independent | — |
| 9-B1-kit | 9, site-assistant.md B1 | @zavon/workflow-ui host node kinds and edge roles for the bot Builder (send, ask, collect, condition, consent, answer, upsert, notify, register, handoff, end), loop policy, locked ids, preview slot. | about 1.5 (16) | 0.5 | Ready after 5 | Independent | — |
| 14-P7-kit | 14, whatsapp-bot-ai-sms.md P7 | The rest of the kit node kinds for bots (summaries and the kinds that 9-B1-kit does not cover). | about 6 (10) | 0.5 | Blocked | Independent | Item 14 is blocked as one item (USSD go or no-go) |

Items with no kit work: 2, 3 (the callback is live in workflow-ui 1.11), 6 to 8, 10 to 13, 15, 16 to 24, 29 to 36, 39 to 42, 44 to 56, 59, 61 to 64, 68, 71, 72. Item 4 is done. Items 76 and 77 (Silvertree portal) consume the kit contracts stepgates, deadlines, waits, boardquery, bands and emailcta.

## 2. Dependencies in detail

Independent now: almost every kit slice. The shapes are written in the plans. The kit vector is then the contract that the other repos build against.

Needs contract:
- 57-C1-kit: the list shape of core connections (57-C1-core). Agree the shape in connections.md, then build both.
- 58-G3-kit: the fee schedule and model shapes (58-G1-core).

Needs shipped:
- 60-B4-kit: 58-G3-kit.

## 3. Contracts kit provides to other repos

| Contract or package | Users | Slice |
|---|---|---|
| contract touch/1 | Pages, Shop, Reach (37) | 37-M1-kit |
| contract/ai vectors for every new AI tool | Core (copies into testdata), Reach, Pages, Shop fake cores | 5-K, 15a, 15b, 25, 26, 27, 28, 38-M7, 43-E1, 60-B2 kit slices |
| Site assistant web turn, effects and errors | Reach (5-R1), Pages (5-P1) | 5-K-kit |
| Integrations screen component | Reach, Pages, Shop (57-C1) | 57-C1-kit |
| go/policy explicit-only actions | Accounts, Reach, Pages, Shop (57, 58) | 58-G2-kit |
| @zavon/get-paid | Pages, Shop (58, 60) | 58-G3-kit, 60-B4-kit |
| @zavon/console-ui 1.0 and contract/boardquery | Accounts (65), Reach, Pages, core portal (73), CRM and payouts screens, the Silvertree portal | 65-kit |
| contract/emailcta | Core, Reach, Pages, Shop, Accounts (74) | 74-kit |
| contract/runs actor kind participant | Core (66) | 66-kit |
| contract/deadlines, contract/waits | Core (67, 69), Pages (73 replay), the Silvertree portal (76) | 67-kit, 69-kit |
| band_of with vectors | Core (70), Reach (29-CRM8, 49-L3) | 70-kit |
| @zavon/workflow-ui 1.12 | Core portal, Reach, Pages | 70-kit, 73-kit |
| contract/esign | Core (75) | 75-kit |
| Bot node kinds in workflow-ui | Reach (9-B1, 10) | 9-B1-kit, 14-P7-kit |

## 4. Start here

The October rule: work that uses the Claude API comes first, while the US$200 credit lasts. In kit, that means the vectors that the AI slices in other repos wait for.

1. 5-K-kit: the site assistant vectors (Reach 5-R1 and Pages 5-P1 wait for them).
2. 15a-kit: kit 1.15.0 vectors for the designer tools.
3. 25-CRM2-kit, then 26-CRM4-kit, 27-CRM5-kit, 28-CRM6-kit and 28-CRM7-kit as one release: the CRM tool vectors.
4. 38-M7-kit and 43-E1-kit: reach.report.narrative and the enrich v2 update.
5. 37-M1-kit: contract touch/1.

Next after these: 74-kit, 65-kit, 66-kit, 67-kit, 69-kit, 70-kit.

## 5. Plans (design details)

All in the admin repo, docs/roadmap/:
- BACKLOG.md (global order, statuses, working rules)
- ai-architecture.md (contract changes for the AI wire)
- site-assistant.md (slice K)
- workflow-port.md (section 4 for console-ui; contracts in sections 2 and 3) with workflow-port-source.md
- industries.md (touch/1 in section 4.1)
- crm.md, designer.md (tool shapes)
- payouts.md (get-paid, explicit-only actions)
- connections.md (Integrations screen)
- whatsapp-bot-ai-sms.md (node kinds)
