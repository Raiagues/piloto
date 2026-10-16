# Early mission conception research notes

This document records the engineering rationale behind the conception workflow used by Norte.

## Why the platform starts with framing rather than hardware

NASA systems engineering guidance starts system design by collecting and clarifying stakeholder expectations, mission objectives, constraints, design drivers, operational objectives and mission-success criteria. Needs, goals and objectives are explicitly used to align the team on the problem and its scope before they become contractual requirements or a design.

ESA's Concurrent Design Facility follows the same early-phase logic. MiCRA studies exist specifically to clarify novel mission ideas before a full conceptual design study, identifying main drivers, constraints and first trade-offs. The CDF works from a common design model that evolves as decisions are made so impacts across disciplines remain visible.

Norte therefore separates the workflow into two layers.

1. Study setup establishes the rules and context of the study.
2. The conception room explores the problem and its branches without forcing premature spacecraft choices.

## Study setup

The intermediate Study Setup page is not a questionnaire about spacecraft implementation. It captures four things that materially change how the conception work should be interpreted.

- Study intent. Problem-driven mission, technology demonstration, science/exploration or open exploration.
- Starting statement. A short description of what motivated the study. This is not treated as a formal mission description.
- Governing framework. A standard Norte early-mission framework or a project-specific custom definition model.
- Project references. Standards, templates or internal references that define how the project should be evaluated.

This follows the principle that assumptions, constraints, applicable standards and success criteria should be explicit and traceable instead of hidden in a conversation history.

## Definition progress

Progress is not treated as a generic completion percentage. The standard framework looks for evidence that the core problem, desired result, context, beneficiary, time priority and major constraints have been established. Projects can replace or extend that model with custom criteria because systems-engineering processes are expected to be tailored or customized to project size, risk and context.

A phase can only be declared validated when its mandatory criteria are actually supported by defined evidence and critical inconsistencies are resolved. Users can continue to other views while a phase remains open.

## Inconsistency studies

An inconsistency is not automatically converted into another node on the main map. Opening an inconsistency creates a focused study draft. The study keeps its own hypotheses, evidence and conclusion so alternatives can be explored without polluting the macro mission graph. Only a deliberate conclusion is promoted back into the project state.

## Project configuration and export

The client prototype stores the project as a versioned structured model. Board nodes, links, study setup, progress rules, issue studies and applied templates are kept separately inside the same project object. The UI exposes these as virtual project files so the data model already resembles the configuration-managed project structure that a future backend can persist.

The complete project can be exported as JSON. This is intended to support future templates where standards or program-specific rules define required phases, criteria and fields while leaving explicitly configurable areas editable by the user.

## Primary references

- NASA Systems Engineering Handbook, Stakeholder Expectations Definition and System Design Processes
- NASA NPR 7123.1 tailoring and customization guidance
- ESA Concurrent Design Facility and MiCRA early mission concept assessment
- ECSS tailoring guidance and ECSS Applicability Requirement Matrix
