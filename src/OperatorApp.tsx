import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { buildGraph, type StreetGraph, type StreetsFile } from "./sim/streets";
import { OperatorView } from "./ui/operator/OperatorView";

const data = (file: string) => fetch(`${import.meta.env.BASE_URL}data/${file}`).then((r) => r.json());

export function OperatorApp() {
  const [districts, setDistricts] = useState<FeatureCollection | null>(null);
  const [streets, setStreets] = useState<StreetGraph | null>(null);
  useEffect(() => {
    data("districts.geojson")
      .then(setDistricts)
      .catch(() => setDistricts(null));
    // Officer cars are optional: without the street data the race still runs, just without cars on the map.
    data("streets.json")
      .then((f: StreetsFile) => setStreets(buildGraph(f)))
      .catch(() => setStreets(null));
  }, []);
  return <OperatorView districts={districts} streets={streets} />;
}
