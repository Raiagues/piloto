/** Where the Quetzal-1 validation documents live — never what they say.
 *
 * This manifest is deliberately free of engineering content: no entities, no
 * relations, no power figures, no expected results. It records publishers,
 * pinned revisions, URLs and integrity metadata so `scripts/seed-quetzal-
 * validation.mjs` can fetch the real files. What the engineering system is
 * must come from extracting those files, not from this repository.
 *
 * `contextPolicy` records why each source is or is not eligible for Project
 * Memory. The importer refuses `evaluation_reference` outright so benchmark
 * holdout material can never reach the extraction model.
 */

export const QUETZAL_PROJECT_ID = "quetzal1-eps-comms";
export const QUETZAL_PROJECT_NAME = "Quetzal-1";
export const QUETZAL_TEAM_ID = "team-norte-validation";
export const QUETZAL_TEAM_NAME = "Norte Validation Team";

/** Roles the importer accepts. Anything else is refused. */
export const IMPORTABLE_ROLES = Object.freeze(["project_context", "supporting_datasheet"]);

/** Hosts the controlled downloader may contact. No other host is reachable. */
export const ALLOWED_SOURCE_HOSTS = Object.freeze([
  "raw.githubusercontent.com",
  "gomspace.com",
  "www.ti.com"
]);

const HARDWARE_REVISION = "d4d1b59de384701a016a6e17353aff3c8ba64853";
const FLIGHT_SOFTWARE_REVISION = "dbfb67a2c8a7336f765e320d37a8a02e3ab4c212";
const QUETZAL_LICENSE = "CC BY-SA 4.0 — Quetzal-1 CubeSat Team, Universidad del Valle de Guatemala";
const MANUFACTURER_LICENSE = "Manufacturer copyright; retrieved from the publisher for engineering reference. Not redistributed by this repository.";

const github = (repository, revision, path) =>
  `https://raw.githubusercontent.com/Quetzal-1-CubeSat-Team/${repository}/${revision}/${path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * `tier: "core"` is the minimal real context imported by default.
 * `tier: "extended"` is verified and importable with `--tier extended`, kept
 * out of the default set only to hold the parsed-content budget down.
 * `tier: "excluded"` documents a source that was checked and deliberately
 * not imported, with the reason.
 */
export const QUETZAL_SOURCES = Object.freeze([
  {
    id: "quetzal-eps-hardware-readme",
    label: "Quetzal-1 EPS Hardware Overview",
    description: "Official EPS hardware README: harvesting, storage and distribution responsibilities, subsystem relationships and the EPS controller.",
    publisher: "Quetzal-1 CubeSat Team / Universidad del Valle de Guatemala",
    repository: "Quetzal-1-CubeSat-Team/quetzal1-hardware",
    revision: HARDWARE_REVISION,
    path: "EPS/README.md",
    sourceUrl: github("quetzal1-hardware", HARDWARE_REVISION, "EPS/README.md"),
    fileName: "quetzal1-eps-hardware-readme.md",
    expectedMimeType: "text/markdown",
    storedMimeType: "text/markdown",
    kind: "document",
    sha256: "f522f267ebb0387c602199b4a3f86960ac888a63ded9602bc1d85fb06ba5b117",
    expectedBytes: 4950,
    role: "project_context",
    tier: "core",
    priority: "P0",
    license: QUETZAL_LICENSE,
    contextPolicy: "Design evidence authored by the mission team. No flight results."
  },
  {
    id: "quetzal-eps-schematic",
    label: "Quetzal-1 EPS Schematic",
    description: "Official EPS printed circuit board schematic (PT-MIS-PCB-002_v1) released by the mission team.",
    publisher: "Quetzal-1 CubeSat Team / Universidad del Valle de Guatemala",
    repository: "Quetzal-1-CubeSat-Team/quetzal1-hardware",
    revision: HARDWARE_REVISION,
    path: "EPS/output/eps/Schematic/PT-MIS-PCB-002_v1 Schematic.pdf",
    sourceUrl: github("quetzal1-hardware", HARDWARE_REVISION, "EPS/output/eps/Schematic/PT-MIS-PCB-002_v1 Schematic.pdf"),
    fileName: "PT-MIS-PCB-002_v1-Schematic.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    sha256: "ba775415903e0a15984e74f4e3716668caa424990ff055df5adf06060946e126",
    expectedBytes: 2600375,
    role: "project_context",
    tier: "core",
    priority: "P0",
    license: QUETZAL_LICENSE,
    contextPolicy: "As-designed schematic. No on-orbit measurement."
  },
  {
    id: "quetzal-eps-flight-software-readme",
    label: "Quetzal-1 EPS Flight Software",
    description: "Official EPS flight software README: I2C sensor network, Fault Protection Boards and the OBC-to-EPS control behaviour.",
    publisher: "Quetzal-1 CubeSat Team / Universidad del Valle de Guatemala",
    repository: "Quetzal-1-CubeSat-Team/quetzal1-flight-software",
    revision: FLIGHT_SOFTWARE_REVISION,
    path: "EPS/README.md",
    sourceUrl: github("quetzal1-flight-software", FLIGHT_SOFTWARE_REVISION, "EPS/README.md"),
    fileName: "quetzal1-eps-flight-software-readme.md",
    expectedMimeType: "text/markdown",
    storedMimeType: "text/markdown",
    kind: "document",
    sha256: "4bc3ac0b822d1d0e9d6db5c4d2d2f6621ca9d4b25b1086ad3551705fd2cb37d1",
    expectedBytes: 15077,
    role: "project_context",
    tier: "core",
    priority: "P0",
    license: QUETZAL_LICENSE,
    contextPolicy: "Implementation design evidence. Describes thresholds as designed, not observed outcomes."
  },
  {
    id: "gomspace-nanocom-ax100-datasheet",
    label: "NanoCom AX100 Datasheet",
    description: "GomSpace datasheet for the NanoCom AX100 VHF/UHF transceiver flown on Quetzal-1.",
    publisher: "GomSpace A/S",
    repository: null,
    revision: "DS 1013823 3.7",
    path: "wp-content/uploads/2025/09/gs-ds-nanocom-ax100.pdf",
    sourceUrl: "https://gomspace.com/wp-content/uploads/2025/09/gs-ds-nanocom-ax100.pdf",
    fileName: "gs-ds-nanocom-ax100.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    // Publisher-hosted URLs are mutable: a changed hash is reported, not fatal.
    knownSha256: "e734a38e710a5d48b68b39cc81d921285129fe0bb7e035dd038eaba07e9a998d",
    expectedBytes: 803501,
    role: "supporting_datasheet",
    tier: "core",
    priority: "P0",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Manufacturer specification of the flown transceiver. Contains no Quetzal mission outcome."
  },
  {
    id: "quetzal-eps-bom-reference",
    label: "Quetzal-1 EPS Bill of Materials",
    description: "Official reference BOM for the EPS board (PT-PWR-EPS-002_v1), listing the parts actually populated.",
    publisher: "Quetzal-1 CubeSat Team / Universidad del Valle de Guatemala",
    repository: "Quetzal-1-CubeSat-Team/quetzal1-hardware",
    revision: HARDWARE_REVISION,
    path: "EPS/output/eps/BOM/PT-MIS-PCB-002_v1 BOM Reference-PT-PWR-EPS-002_v1.xlsx",
    sourceUrl: github("quetzal1-hardware", HARDWARE_REVISION, "EPS/output/eps/BOM/PT-MIS-PCB-002_v1 BOM Reference-PT-PWR-EPS-002_v1.xlsx"),
    fileName: "PT-MIS-PCB-002_v1-BOM-Reference.xlsx",
    expectedMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    storedMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "dataset",
    sha256: "f2f423b97e2c8ba8c15101c32fe78e584536c4d2d4fcb9743eb427dc0e2d14e9",
    expectedBytes: 72776,
    role: "project_context",
    tier: "core",
    priority: "P1",
    license: QUETZAL_LICENSE,
    contextPolicy: "As-built part list. Read through the bounded server-side spreadsheet reader."
  },
  {
    id: "ti-ina260-datasheet",
    label: "Texas Instruments INA260 Datasheet",
    description: "Precision digital current and power monitor. Populated as U1, U9 and U12 in the Quetzal-1 EPS BOM.",
    publisher: "Texas Instruments",
    repository: null,
    revision: null,
    path: "lit/ds/symlink/ina260.pdf",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/ina260.pdf",
    fileName: "ti-ina260.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    knownSha256: "5160ed4af198b093e541beb3fe5f1048f00233fa23cd4f4822391acad9f94dcf",
    expectedBytes: 762561,
    role: "supporting_datasheet",
    tier: "extended",
    priority: "P1",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Verified as U1/U9/U12 in the pinned BOM and named three times in the flight software README. Held out of the default set on measurement: adding this and TPS2551 takes the provider request from 4.6 MB to 8.4 MB and its latency from 4-33 s to 57-122 s, past the extraction timeout."
  },
  {
    id: "ti-tps2551-datasheet",
    label: "Texas Instruments TPS2551 Datasheet",
    description: "Adjustable current-limited power-distribution switch. Populated six times in the Quetzal-1 EPS BOM and used in the Fault Protection Boards.",
    publisher: "Texas Instruments",
    repository: null,
    revision: null,
    path: "lit/ds/symlink/tps2551.pdf",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/tps2551.pdf",
    fileName: "ti-tps2551.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    knownSha256: "3e5b44a7548998337c5612f8942a28d685c35a221f93a6d6051d965bbb7ea605",
    expectedBytes: 2065206,
    role: "supporting_datasheet",
    tier: "extended",
    priority: "P1",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Verified as the Fault Protection Board switch, populated six times in the pinned BOM. At 2.1 MB it is the largest optional datasheet; see the INA260 entry for the measured request-size reason it stays out of the default set."
  },
  {
    id: "ti-ina169-datasheet",
    label: "Texas Instruments INA169 Datasheet",
    description: "High-side current shunt monitor. Populated as U16, U18, U20 and U22 in the Quetzal-1 EPS BOM.",
    publisher: "Texas Instruments",
    repository: null,
    revision: null,
    path: "lit/ds/symlink/ina169.pdf",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/ina169.pdf",
    fileName: "ti-ina169.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    knownSha256: "dbb74b6cdc5431353f17b044b7d762df1f2f9049d03d2d1611a53058e570d62c",
    expectedBytes: 660145,
    role: "supporting_datasheet",
    tier: "extended",
    priority: "P1",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Verified in the pinned BOM. Held out of the default set only for the parsed-content budget."
  },
  {
    id: "ti-tps63070-datasheet",
    label: "Texas Instruments TPS63070 Datasheet",
    description: "Buck-boost converter. Verified as U11 (TPS63070RNMT) in the pinned Quetzal-1 EPS BOM, not assumed from secondary discussion.",
    publisher: "Texas Instruments",
    repository: null,
    revision: null,
    path: "lit/ds/symlink/tps63070.pdf",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/tps63070.pdf",
    fileName: "ti-tps63070.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    knownSha256: "a88ef66f3493156ff6e7da0849de0e0e1068647f2553d08c1844d4a90c5c65ef",
    expectedBytes: 1680561,
    role: "supporting_datasheet",
    tier: "extended",
    priority: "P1",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Verified in the pinned BOM. Held out of the default set only for the parsed-content budget."
  },
  {
    id: "ti-tmp100-datasheet",
    label: "Texas Instruments TMP100 Datasheet",
    description: "Digital temperature sensor documented in the Quetzal-1 EPS flight software README. Not present in the pinned EPS board BOM.",
    publisher: "Texas Instruments",
    repository: null,
    revision: null,
    path: "lit/ds/symlink/tmp100.pdf",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/tmp100.pdf",
    fileName: "ti-tmp100.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    knownSha256: "4099b7e562d9333140b60526c32908a082ef300d019266161e9a2b118e52fc29",
    expectedBytes: 661054,
    role: "supporting_datasheet",
    tier: "extended",
    priority: "P1",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Verified in the flight software README only."
  },
  {
    id: "ti-bq27441-g1-datasheet",
    label: "Texas Instruments BQ27441-G1 Datasheet",
    description: "Single-cell Li-Ion fuel gauge. The pinned EPS BOM populates BQ27441DRZR-G1A as U6.",
    publisher: "Texas Instruments",
    repository: null,
    revision: null,
    path: "lit/ds/symlink/bq27441-g1.pdf",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/bq27441-g1.pdf",
    fileName: "ti-bq27441-g1.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    knownSha256: "8779b67adfe7683f4a142d582424f5a85f66645cdd912121836e172578f301e6",
    expectedBytes: 684911,
    role: "supporting_datasheet",
    tier: "extended",
    priority: "P1",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "The pinned BOM and the flight software README name different fuel gauge part numbers (BQ27441-G1 vs BQ27741-G1). Both are kept available; neither is silently chosen."
  },
  {
    id: "ti-bq27741-g1-datasheet",
    label: "Texas Instruments BQ27741-G1 Datasheet",
    description: "Single-cell Li-Ion fuel gauge with protection, as named in the Quetzal-1 EPS flight software README.",
    publisher: "Texas Instruments",
    repository: null,
    revision: null,
    path: "lit/ds/symlink/bq27741-g1.pdf",
    sourceUrl: "https://www.ti.com/lit/ds/symlink/bq27741-g1.pdf",
    fileName: "ti-bq27741-g1.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    knownSha256: "d0739fc727ef1c977d61f1b94ace27606881ef1045093a3d0e72f36a77ede341",
    expectedBytes: 756420,
    role: "supporting_datasheet",
    tier: "extended",
    priority: "P1",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Counterpart to the BOM part number above; see that entry for the documented discrepancy."
  },
  {
    id: "microchip-atmega328p-datasheet",
    label: "Microchip ATmega328P Datasheet",
    description: "EPS microcontroller named in the Quetzal-1 hardware README and populated as U23 in the pinned BOM.",
    publisher: "Microchip Technology",
    repository: null,
    revision: "DS40002061B",
    path: "downloads/aemDocuments/documents/MCU08/ProductDocuments/DataSheets/ATmega48A-PA-88A-PA-168A-PA-328-P-DS-DS40002061B.pdf",
    sourceUrl: "https://ww1.microchip.com/downloads/aemDocuments/documents/MCU08/ProductDocuments/DataSheets/ATmega48A-PA-88A-PA-168A-PA-328-P-DS-DS40002061B.pdf",
    fileName: "atmega328p.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    expectedBytes: 33319446,
    role: "supporting_datasheet",
    tier: "excluded",
    priority: "P2",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "Verified to exist and resolve, but 33.3 MB exceeds the 4 MB per-file processing limit by a wide margin, and its register-level content adds nothing to an EPS + COMMS power architecture. Not imported."
  },
  {
    id: "azurspace-3g30a-datasheet",
    label: "AZUR SPACE 3G30A Solar Cell Datasheet",
    description: "Solar cell type named in the Quetzal-1 hardware README.",
    publisher: "AZUR SPACE Solar Power GmbH",
    repository: null,
    revision: null,
    path: "images/products/0003401-01-01_DB_3G30A.pdf",
    sourceUrl: "https://www.azurspace.com/images/products/0003401-01-01_DB_3G30A.pdf",
    fileName: "azurspace-3g30a.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    role: "supporting_datasheet",
    tier: "excluded",
    priority: "P2",
    license: MANUFACTURER_LICENSE,
    contextPolicy: "The exact URL linked from the pinned Quetzal hardware README now returns 404, and a current 2025 revision is not verifiably the unit used during Quetzal development. Solar cell details stay with the Quetzal documentation for V0."
  },
  {
    id: "joss-quetzal1-eps-paper",
    label: "JoSS 12(2) Quetzal-1 EPS paper",
    description: "Design and on-orbit performance of the Quetzal-1 EPS.",
    publisher: "Journal of Small Satellites",
    repository: null,
    revision: null,
    path: "storage/2023/05/Final-Aguilar-Nadalini-Design-and-On-Orbit-Performance-of-the-Electrical-Power-System-for-the-Quetzal-1-CubeSat.pdf",
    sourceUrl: "https://jossonline.com/storage/2023/05/Final-Aguilar-Nadalini-Design-and-On-Orbit-Performance-of-the-Electrical-Power-System-for-the-Quetzal-1-CubeSat.pdf",
    fileName: "joss-quetzal1-eps.pdf",
    expectedMimeType: "application/pdf",
    storedMimeType: "application/pdf",
    kind: "document",
    role: "evaluation_reference",
    tier: "excluded",
    priority: "evaluator-only",
    license: "Journal of Small Satellites",
    contextPolicy: "REFUSED BY THE IMPORTER. Its on-orbit performance sections are the evaluator's holdout answers. Attaching it to Project Memory would leak the benchmark."
  }
]);

export function sourcesForTier(tier = "core", sources = QUETZAL_SOURCES) {
  const tiers = tier === "extended" ? ["core", "extended"] : ["core"];
  return sources.filter((source) => tiers.includes(source.tier));
}

export function findSource(id) {
  return QUETZAL_SOURCES.find((source) => source.id === id) ?? null;
}

/** Deterministic artifact id, so re-running the importer updates in place. */
export function artifactIdForSource(sourceId) {
  return `quetzal-src-${sourceId}`;
}
