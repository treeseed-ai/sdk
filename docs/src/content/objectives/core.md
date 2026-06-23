---
id: objective:sdk-core
title: TreeSeed SDK Core Objective
description: TreeSeed SDK should provide the programmatic platform substrate for Treeseed content, control-plane state, graph-first context, workflow orchestration, reconciliation, hosting, package workflows, shared contracts, and TreeDX integration.
date: 2026-06-22
summary: TreeSeed SDK exists to provide the programmatic platform substrate for Treeseed content, control-plane state, graph-first context, workflow orchestration, reconciliation, hosting, package workflows, shared contracts, and TreeDX integration while preserving its package boundary.
status: live
timeHorizon: long-term
motivation: Package-local workdays need a stable north star from the README so humans and agents can plan, execute, review, and report work without drifting across package ownership boundaries.
primaryContributor: sdk-steward
relatedQuestions: []
relatedBooks: []
---

TreeSeed SDK exists to provide the programmatic platform substrate for Treeseed content, control-plane state, graph-first context, workflow orchestration, reconciliation, hosting, package workflows, shared contracts, and TreeDX integration.

This core objective is the starting direction for the TreeSeed SDK Knowledge Hub. It should influence every package-local workday, research note, implementation proposal, generated artifact, approval request, and release-readiness summary.

SDK owns portable primitives and shared contracts. It must not import from package implementations above it, own UI routes, run provider execution, serve the backend API, or encode TreeDX internals as product semantics.

Agents working in this project should keep outputs grounded in the package README, package-local source evidence, and the TreeSeed package ownership map. When a task would cross into another package's authority, the agent should describe the boundary and route the work to the correct project instead of mutating outside this hub.
