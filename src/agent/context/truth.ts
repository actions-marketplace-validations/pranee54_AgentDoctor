import type { TruthLabel } from "./types.js";

export function truthLabelHelp(label: TruthLabel): string {
  switch (label) {
    case "VERIFIED":
      return "Directly supported by repository/project evidence.";
    case "INFERRED":
      return "Reasonable conclusion from available evidence but not directly established.";
    case "UNKNOWN":
      return "Cannot be determined from current project evidence.";
    case "EXTERNAL":
      return "Requires information outside the repository.";
  }
}

/**
 * Downgrade helper: never promote INFERRED/UNKNOWN to VERIFIED accidentally.
 */
export function minTruth(a: TruthLabel, b: TruthLabel): TruthLabel {
  const order: TruthLabel[] = ["VERIFIED", "INFERRED", "UNKNOWN", "EXTERNAL"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!;
}
